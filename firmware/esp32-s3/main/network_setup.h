#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"

// woke_by_button: this boot is a deep-sleep wake caused by pressing GPIO0, so holding it
// counts toward the 3 s setup press right away. woke_from_sleep: skip the boot banner.
void network_setup_init(bool woke_by_button, bool woke_from_sleep);
bool network_ready(void);
// Waits up to network_ms for Wi-Fi + MQTT, publishes with QoS 1 and waits up to ack_ms for
// the broker's acknowledgement, so the report is delivered before the board sleeps.
bool network_publish_wait(const char *json, int network_ms, int ack_ms);
// False while the setup hotspot is open or requested, a settings test runs, GPIO0 is held,
// or there are no usable settings.
bool network_sleep_allowed(void);
void network_prepare_sleep(void);
esp_err_t network_enable_button_wakeup(void);
