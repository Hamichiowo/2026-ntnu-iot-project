#pragma once

// ===== Initial defaults only; saved phone setup in NVS takes precedence =====
// Use 2.4 GHz Wi-Fi. Blank settings + no saved NVS => phone setup hotspot.
// After boot hold GPIO0 for 3 seconds; connect to Clothes-Setup-xxxx and open 192.168.4.1.
// Hotspot password (WPA2, 8-63 chars). Also printed over USB (115200); USB command: setup + Enter.
#define APP_SETUP_AP_PASSWORD "12345678"
#define APP_WIFI_SSID       ""
#define APP_WIFI_PASSWORD   ""

// Broker IP/hostname reachable FROM the ESP32, not localhost or Docker's mosquitto.
#define APP_MQTT_HOST       ""
#define APP_MQTT_PORT       1883
#define APP_MQTT_TLS        0  // Set 1 for TLS (normally port 8883); CA bundle + hostname verified.
#define APP_MQTT_USERNAME   ""  // Empty = no username
#define APP_MQTT_PASSWORD   ""
#define APP_MQTT_TOPIC      "clothes/raw"

// TLS needs network time to validate the broker certificate. No time is added to payloads.
#define APP_SNTP_SERVER     "pool.ntp.org"
// One report (median of 10 HX711 conversions) every APP_REPORT_PERIOD_MS, deep sleep in between.
// While the clip is being handled the board checks again every APP_TOUCHED_PERIOD_MS.
// QoS 1, retain=false, no historical replay. APP_DEEP_SLEEP 0 keeps the board awake (same cadence).
// The board never sleeps while a PC is attached over USB, the setup hotspot is open, or GPIO0 is held.
#define APP_REPORT_PERIOD_MS  60000
#define APP_TOUCHED_PERIOD_MS 10000
#define APP_DEEP_SLEEP        1
