#pragma once
#include <stdbool.h>

// Call after a report was delivered. On a cold boot it confirms the running image (cancelling the
// bootloader's rollback) and tells the server which image runs. Then it reads the retained update
// command, if any; for a different image it downloads it, switches to it and restarts.
void ota_after_report(bool cold_boot);
