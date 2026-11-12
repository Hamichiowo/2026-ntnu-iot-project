# 2026 NTNU IoT：智慧衣夾

以 [soraimahiro/MAPS-server](https://github.com/soraimahiro/MAPS-server) 為基礎，加入單一智慧衣夾的原始資料收集與顯示。上游說明保留於 [docs/MAPS-UPSTREAM.md](docs/MAPS-UPSTREAM.md)。

目前只做：**ESP32 → MQTT → server 加收到時間 → PostgreSQL → 網頁數值與曲線**。
不需要先設定乾布基準、歸零或校正；目前不換算重量、電阻、電容，也不預測乾燥時間。

## 啟動網站

需要 Docker Desktop（啟動 Linux containers）。在 repository 根目錄執行：

```powershell
# 建立 .env、產生 MQTT 密碼，並印出 ESP32 與 MAPS 盒子要填的設定（macOS/Linux: ./scripts/setup.sh）
# .env 不會上傳 GitHub
.\scripts\setup.ps1
docker compose up -d --build
.\scripts\setup.ps1 check   # 確認 MQTT 帳密正確、列出被拒絕的裝置
```

- 智慧衣夾：http://localhost:8088
- 原有空氣盒子：http://localhost:8088/air
- MQTT：這台電腦的區域網路 IP，預設 port 1883
- MQTT 帳號、密碼都必須在 `.env` 設定（範本帳號為 `clothes`），沒設定時服務不會啟動。**ESP32 與 MAPS 盒子都必須使用同一組帳密**，否則 broker 會拒絕連線。帳密流程、所有 topic 與 TLS 設定見 [docs/MQTT.md](docs/MQTT.md)。
- 換展示場地：開機後長按 ESP32 GPIO0 約 3 秒，手機連上設定熱點、開啟 `192.168.4.1` 即可換 Wi-Fi 與 MQTT，不需重新燒錄。使用本機 broker 時，電腦與 ESP32 需能互通，防火牆需允許 TCP 1883；ESP32 的 broker 不能填 localhost。

這版沿用上游展示用認證機制，適合受信任的本機展示網路。若需要讓外網裝置透過 port forwarding 連線，可以啟用 8883 TLS（見 [docs/MQTT.md](docs/MQTT.md#6-tls-與-port-forwarding8883)）。ESP32 只能驗證公開 CA（例如 Let's Encrypt）簽發的網域憑證；用自簽憑證時，ESP32 只能留在區網連 1883。

## ESP32 快速設定

程式位於 [firmware/esp32-s3](firmware/esp32-s3)，使用 **ESP-IDF 6.1**，不是 Arduino sketch。

首次燒錄後可用手機熱點配網；Wi-Fi 與 MQTT 設定會保存到板子的 NVS，斷電仍保留。也可將 `main/app_config.example.h` 複製成 `main/app_config.h`，填入初始設定；已保存的 NVS 設定優先，實際設定檔已加入 gitignore。
完整接線、編譯與燒錄步驟見 [韌體操作說明](firmware/esp32-s3/README.md)。

遠端 broker 可啟用 `APP_MQTT_TLS 1`、設定 port 8883，韌體會校時並驗證伺服器憑證。改送遠端後，請使用對應的遠端網站觀察資料；本機儀表板不會自動同步遠端資料。設定方式見韌體操作說明的「遠端 MQTT TLS」。

## MQTT 約定

Topic：`clothes/raw`。每秒一筆，QoS 0、retain=false，斷線不補傳歷史資料。

```json
{"hx711_raw":86042,"ads1115_raw":7799,"touch_raw":31875}
```

| 欄位 | 內容 |
| --- | --- |
| hx711_raw | HX711 原始有號計數，不是 g |
| ads1115_raw | ADS1115 A0 原始有號 ADC 計數，不是 V 或 Ω |
| touch_raw | ESP32-S3 GPIO10 touch 原始計數，不是 pF |

讀取失敗的欄位傳 `null`，不能以 0 假裝讀取成功。ESP32 不傳時間，server 在收到訊息時加上 UTC timestamp。只接受這三個欄位、合法整數範圍或 null。

這版針對一個夾子，請勿讓多個真實裝置或模擬器同時發佈到同一個 topic。

## 網頁與資料庫

首頁顯示三個原始值、server 收到時間與歷史曲線：可選最近 5 分鐘、15 分鐘、1 小時、6 小時、24 小時，或自訂開始／結束時間（台北時間，一次最多 24 小時；自訂範圍不自動更新）。超過 10 秒沒新資料會提示；null 與資料中斷會讓曲線斷開。

資料存在獨立 `clothes_raw` 表；server 啟動時自動建立表與索引，也附上 `db/migrations/001_clothes_raw.sql`。原有空氣資料表與 MQTT topics 保留。

- `GET /api/v1/clothes/latest`：最新一筆、資料年齡、MQTT 狀態。
- `GET /api/v1/clothes/history?start=<ISO時間>&end=<ISO時間>&limit=5000`：時間範圍內資料，按時間遞增；最多查 24 小時；資料超過 limit 筆時，改回傳每 `bucket_seconds` 秒的平均值，讓整段範圍都看得到（全為 null 的區間仍為 null）。
- `GET /api/v1/clothes/export?start=<ISO時間>&end=<ISO時間>`：下載時間範圍內的原始資料 CSV（不平均，UTF-8 含 BOM，Excel 可直接開）；start、end 皆必填，最長 7 天。欄位：`time_taipei,timestamp_utc,hx711_raw,ads1115_raw,touch_raw,air_temp_c,air_humi_pct`，讀取失敗的值為空白。儀表板「匯出 CSV」區可手動填起訖時間，或在曲線上按住拖曳選取時段後直接下載。
- 空氣盒子溫溼度：`/clothes/latest`、`/clothes/history` 會附上 `air`，CSV 的 `air_temp_c`、`air_humi_pct` 取「該筆衣夾資料當下或之前、5 分鐘內最近一筆」空氣盒子讀值，超過 5 分鐘沒有讀值則留空。預設配對最近有回報的空氣盒子，可用 `.env` 的 `CLOTHES_AIRBOX_ID` 指定；儀表板也能從下拉選單選擇目前連線中的空氣盒子（記在該瀏覽器）。API 可加 `?airbox=<device_id>` 指定，`GET /api/v1/clothes/airboxes` 列出所有空氣盒子與是否連線（5 分鐘內有回報）。
- DB 無法讀取時回傳 503，不以假資料或記憶體資料冒充成功。

PostgreSQL 使用 Docker volume，重新啟動會保留資料。不要執行 `docker compose down -v`，那會刪除本專案的資料 volume。

## 沒有板子時測試

以下會寫入**模擬資料**，只在展示用資料庫執行，開始正式實驗前停止模擬器並使用獨立資料庫。

```powershell
docker compose exec -T -e SIM_COUNT=60 app bun scripts/publish-clothes.ts
```

發送 60 筆後自動結束；首頁應出現三條曲線。這不是硬體實測。

```powershell
docker compose exec -T app bun test
python tools/smoke_clothes.py   # clothes/raw
python tools/smoke_maps.py      # MAPS/<id>/online、status、sensor
```

smoke 測試會寫測試讀值，驗證 MQTT、DB、API；clothes 測試另外會重啟本專案 app，檢查重啟後資料仍保存，以及斷線提示。請在沒有真實裝置發送的展示環境執行，測試資料會保留。執行前先把 `tools/config.example.json` 複製成 `tools/config.json`，填入網址與帳密（不會讀 `.env`），見 [tools/README.md](tools/README.md)。

## 專案結構

- `firmware/esp32-s3/`：感測器與 MQTT 韌體
- `app/src/clothes/`：驗證、存檔與接收處理
- `app/src/routes/clothes.ts`：查詢 API
- `web/src/views/ClothesView.vue`：raw data 儀表板
- `db/migrations/`：資料表
- `tools/smoke_clothes.py`：Docker 整合驗證

後續如需校正、材質或乾燥預測，可由 server 使用保存的 raw data 加上實驗標註實作。
