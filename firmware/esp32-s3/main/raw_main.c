#include <stdio.h>
#include <assert.h>
#include <stdlib.h>
#include <stdint.h>
#include <stdbool.h>
#include <stdarg.h>
#include <string.h>
#include <math.h>
#include <sys/time.h>
#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "driver/touch_sens.h"
#include "driver/usb_serial_jtag.h"
#include "esp_rom_sys.h"
#include "esp_timer.h"
#include "esp_sleep.h"
#include "nvs_flash.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_netif_sntp.h"
#include "esp_crt_bundle.h"
#include "network_setup.h"
#include "app_config.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#ifndef APP_MQTT_TLS
#define APP_MQTT_TLS 0
#endif
#ifndef APP_SNTP_SERVER
#define APP_SNTP_SERVER "pool.ntp.org"
#endif

// Reporting cadence. APP_REPORT_PERIOD_MS replaces the old 1 s APP_SAMPLE_PERIOD_MS, so an
// existing app_config.h that still says 1000 does not turn deep sleep into a 1 s loop.
#ifndef APP_REPORT_PERIOD_MS
#define APP_REPORT_PERIOD_MS 60000
#endif
#ifndef APP_TOUCHED_PERIOD_MS
#define APP_TOUCHED_PERIOD_MS 10000
#endif
#ifndef APP_DEEP_SLEEP
#define APP_DEEP_SLEEP 1
#endif
_Static_assert(APP_REPORT_PERIOD_MS >= 5000 && APP_TOUCHED_PERIOD_MS >= 5000, "report periods must be at least 5 s");

#define DT GPIO_NUM_4
#define SCK GPIO_NUM_5
#define HX_BURST 10              // conversions per report; their median is sent
#define HX_SETTLE_US 450000      // HX711 output settles about 400 ms after power-up (10 SPS)
#define TOUCHED_SPREAD 1000      // burst spread (counts) above this = clip is being handled
#define CALM_REPORTS 3           // steady reports needed to leave the touched cadence
#define NET_WAIT_MS 12000        // Wi-Fi + MQTT per wake; a full channel scan can take a few seconds
#define PUBLISH_WAIT_MS 3000

// Kept in RTC memory across deep sleep (cleared on power-on).
RTC_DATA_ATTR static int64_t due_us;      // wall-clock time the next report is due
RTC_DATA_ATTR static uint8_t calm_left;   // >0 while using the touched cadence
static portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
static i2c_master_dev_handle_t ads;
static touch_sensor_handle_t touch_sensor;
static touch_channel_handle_t touch_channel;

static void touch_init(void)
{
    touch_sensor_sample_config_t sample = TOUCH_SENSOR_V2_DEFAULT_SAMPLE_CONFIG(
        500, TOUCH_VOLT_LIM_L_0V5, TOUCH_VOLT_LIM_H_2V2);
    touch_sensor_config_t config = TOUCH_SENSOR_DEFAULT_BASIC_CONFIG(1, &sample);
    ESP_ERROR_CHECK(touch_sensor_new_controller(&config, &touch_sensor));
    touch_channel_config_t channel = {
        .active_thresh = {2000},
        .charge_speed = TOUCH_CHARGE_SPEED_7,
        .init_charge_volt = TOUCH_INIT_CHARGE_VOLT_DEFAULT,
    };
    // On ESP32-S3 touch channel 10 maps to GPIO10.
    ESP_ERROR_CHECK(touch_sensor_new_channel(touch_sensor, 10, &channel, &touch_channel));
    ESP_ERROR_CHECK(touch_sensor_enable(touch_sensor));
    for (int i = 0; i < 3; i++)
        ESP_ERROR_CHECK(touch_sensor_trigger_oneshot_scanning(touch_sensor, 1000));
}

static esp_err_t touch_average(double *value, int samples)
{
    double sum = 0;
    for (int i = 0; i < samples; i++) {
        esp_err_t err = touch_sensor_trigger_oneshot_scanning(touch_sensor, 100);
        if (err != ESP_OK) return err;
        uint32_t raw;
        err = touch_channel_read_data(touch_channel, TOUCH_CHAN_DATA_TYPE_RAW, &raw);
        if (err != ESP_OK) return err;
        if (raw == 0 || raw >= 0x3fffff) return ESP_ERR_INVALID_RESPONSE;
        sum += raw;
    }
    *value = sum / samples;
    return ESP_OK;
}

static void ads_init(void)
{
    i2c_master_bus_handle_t bus;
    i2c_master_bus_config_t config = {
        .i2c_port = I2C_NUM_0,
        .sda_io_num = GPIO_NUM_8,
        .scl_io_num = GPIO_NUM_9,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    ESP_ERROR_CHECK(i2c_new_master_bus(&config, &bus));
    i2c_device_config_t device = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = 0x48,
        .scl_speed_hz = 100000,
    };
    ESP_ERROR_CHECK(i2c_master_bus_add_device(bus, &device, &ads));
}

static esp_err_t ads_read(int16_t *raw)
{
    // OS=start, MUX=A0-GND, PGA=+/-4.096V, single-shot, 128 SPS, comparator off.
    const uint8_t start[] = { 1, 0xc3, 0x83 };
    esp_err_t err = i2c_master_transmit(ads, start, sizeof(start), 100);
    if (err != ESP_OK) return err;
    int64_t deadline = esp_timer_get_time() + 150000;
    uint8_t reg = 1, bytes[2];
    do {
        vTaskDelay(pdMS_TO_TICKS(10));
        err = i2c_master_transmit_receive(ads, &reg, 1, bytes, 2, 100);
        if (err != ESP_OK) return err;
        if (bytes[0] & 0x80) break;
        if (esp_timer_get_time() >= deadline) return ESP_ERR_TIMEOUT;
    } while (true);
    reg = 0;
    err = i2c_master_transmit_receive(ads, &reg, 1, bytes, 2, 100);
    if (err == ESP_OK) *raw = (int16_t)(((uint16_t)bytes[0] << 8) | bytes[1]);
    return err;
}

static void output(const char *fmt, ...)
{
    char buffer[256];
    va_list args;
    va_start(args, fmt);
    vsnprintf(buffer, sizeof(buffer), fmt, args);
    va_end(args);
    usb_serial_jtag_write_bytes(buffer, strlen(buffer), pdMS_TO_TICKS(100));
}

static bool read_raw(int32_t *result)
{
    int64_t deadline = esp_timer_get_time() + 150000;
    while (gpio_get_level(DT)) {
        if (esp_timer_get_time() > deadline) return false;
        vTaskDelay(1);
    }
    uint32_t bits = 0;
    // Keep clock high pulses short: an interrupt must not accidentally power down HX711.
    portENTER_CRITICAL(&mux);
    for (int i = 0; i < 24; i++) {
        gpio_set_level(SCK, 1);
        esp_rom_delay_us(1);
        bits = (bits << 1) | gpio_get_level(DT);
        gpio_set_level(SCK, 0);
        esp_rom_delay_us(1);
    }
    // Pulse 25 selects channel A, gain 128 for the next conversion.
    gpio_set_level(SCK, 1);
    esp_rom_delay_us(1);
    gpio_set_level(SCK, 0);
    portEXIT_CRITICAL(&mux);
    *result = (bits & 0x800000) ? (int32_t)(bits | 0xff000000) : (int32_t)bits;
    return true;
}

static int compare_i32(const void *a, const void *b)
{
    int32_t x = *(const int32_t *)a, y = *(const int32_t *)b;
    return (x > y) - (x < y);
}

// Noise filter: median of a burst of conversions. Single bad reads (near-zero glitches,
// one-sample spikes) cannot move a median. *spread is the range without the lowest and
// highest value, so one glitch does not look like someone touching the clip either.
static bool hx_burst(int32_t *median, int32_t *spread)
{
    int32_t values[HX_BURST];
    int count = 0;
    for (int tries = 0; tries < HX_BURST * 2 && count < HX_BURST; tries++) {
        int32_t value;
        if (read_raw(&value) && value != 8388607 && value != -8388608) values[count++] = value;
    }
    if (count < 3) return false;
    qsort(values, count, sizeof(values[0]), compare_i32);
    *median = count % 2 ? values[count / 2]
        : (int32_t)(((int64_t)values[count / 2 - 1] + values[count / 2]) / 2);
    *spread = values[count - 2] - values[1];
    return true;
}

// Median of three ADS1115 conversions.
static bool ads_median(int16_t *result)
{
    int16_t values[3];
    int count = 0;
    for (int i = 0; i < 3; i++) {
        int16_t value;
        if (ads_read(&value) == ESP_OK && value != INT16_MAX && value != INT16_MIN) values[count++] = value;
    }
    if (!count) return false;
    for (int i = 1; i < count; i++)
        for (int j = i; j > 0 && values[j - 1] > values[j]; j--) {
            int16_t swap = values[j]; values[j] = values[j - 1]; values[j - 1] = swap;
        }
    *result = values[count / 2];
    return true;
}

// System time keeps running through deep sleep, so the schedule survives it.
static int64_t wall_us(void)
{
    struct timeval now;
    gettimeofday(&now, NULL);
    return (int64_t)now.tv_sec * 1000000LL + now.tv_usec;
}

void app_main(void)
{
    uint32_t wake = esp_sleep_get_wakeup_causes();
    bool by_timer = wake & BIT(ESP_SLEEP_WAKEUP_TIMER), by_button = wake & BIT(ESP_SLEEP_WAKEUP_EXT1);
    if (!by_timer && !by_button) { due_us = 0; calm_left = 0; }  // power-on or reset: start fresh
    usb_serial_jtag_driver_config_t usb = { .tx_buffer_size=2048, .rx_buffer_size=256 };
    ESP_ERROR_CHECK(usb_serial_jtag_driver_install(&usb));
    ESP_ERROR_CHECK(nvs_flash_init());
    gpio_config_t input = {.pin_bit_mask=1ULL << DT, .mode=GPIO_MODE_INPUT,
                           .pull_up_en=GPIO_PULLUP_ENABLE};
    gpio_config_t clock = {.pin_bit_mask=1ULL << SCK, .mode=GPIO_MODE_OUTPUT};
    ESP_ERROR_CHECK(gpio_config(&input));
    ESP_ERROR_CHECK(gpio_config(&clock));
    gpio_set_level(SCK, 0);
    gpio_hold_dis(SCK);  // SCK low again: HX711 wakes from power-down and starts settling
    int64_t hx_on_us = esp_timer_get_time();
    network_setup_init(by_button, by_timer || by_button);  // Wi-Fi connects while we measure
    ads_init();
    touch_init();
    if (!by_timer)
        output("\r\nRAW telemetry: HX711 GPIO4/5, ADS SDA8/SCL9, touch GPIO10; every %d s (touched %d s)\r\n",
               APP_REPORT_PERIOD_MS / 1000, APP_TOUCHED_PERIOD_MS / 1000);
    if (!due_us) due_us = wall_us();
    for (;;) {
        int64_t settle = HX_SETTLE_US - (esp_timer_get_time() - hx_on_us);
        if (settle > 0) vTaskDelay(pdMS_TO_TICKS(settle / 1000 + 1));
        int32_t hx, spread = 0;
        int16_t adc;
        double touch;
        char json[160], hx_text[24]="null", ads_text[24]="null", touch_text[24]="null";
        if (hx_burst(&hx, &spread)) snprintf(hx_text, sizeof(hx_text), "%ld", (long)hx);
        if (ads_median(&adc)) snprintf(ads_text, sizeof(ads_text), "%d", adc);
        if (touch_average(&touch, 4) == ESP_OK)
            snprintf(touch_text, sizeof(touch_text), "%.0f", touch);
        snprintf(json, sizeof(json),
                 "{\"hx711_raw\":%s,\"ads1115_raw\":%s,\"touch_raw\":%s}",
                 hx_text, ads_text, touch_text);
        // Someone handling the clip: measure again soon until the weight is steady.
        if (spread > TOUCHED_SPREAD) calm_left = CALM_REPORTS;
        else if (calm_left) calm_left--;
        output("%s spread=%ld%s\r\n", json, (long)spread, calm_left ? " touched" : "");
        if (!network_publish_wait(json, NET_WAIT_MS, PUBLISH_WAIT_MS))
            output("NET report not sent (Wi-Fi/MQTT unavailable)\r\n");

        int64_t period = (calm_left ? APP_TOUCHED_PERIOD_MS : APP_REPORT_PERIOD_MS) * 1000LL;
        int64_t now = wall_us();
        due_us += period;
        // Re-anchor after an overrun or a clock jump (e.g. the first SNTP sync).
        if (due_us < now + 500000 || due_us > now + period) due_us = now + period;
        // Stay awake while the setup hotspot is in use, GPIO0 is held, or a PC is attached
        // over USB (serial monitor / "setup" command); the cadence is the same either way.
        if (APP_DEEP_SLEEP && network_sleep_allowed() && !usb_serial_jtag_is_connected()) {
            network_prepare_sleep();
            // HX711 powers down while SCK stays high (> 60 us); hold it high through sleep.
            gpio_set_level(SCK, 1);
            gpio_hold_en(SCK);
            int64_t left = due_us - wall_us();
            ESP_ERROR_CHECK(esp_sleep_enable_timer_wakeup(left > 100000 ? left : 100000));
            ESP_ERROR_CHECK(network_enable_button_wakeup());
            esp_deep_sleep_start();
        }
        gpio_set_level(SCK, 1);  // also power the HX711 down between reports while awake
        while (wall_us() < due_us) vTaskDelay(pdMS_TO_TICKS(100));
        gpio_set_level(SCK, 0);
        hx_on_us = esp_timer_get_time();
    }
}
