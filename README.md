# 格林經絡工作室 — LINE 線上預約系統

自建 LIFF 預約界面，顧客全程在 LINE 內完成預約，不接觸 Cal.com 原生頁面。
方案、加購、通知訊息、提醒時間皆可在後台自行調整，多數不需改動程式碼。

---

## 目錄

- [系統架構](#系統架構)
- [檔案說明](#檔案說明)
- [環境變數](#環境變數)
- [日常維護：哪些要碰 GitHub](#日常維護哪些要碰-github)
- [加購系統](#加購系統)
- [可變時長設定（setDurations）](#可變時長設定setdurations)
- [通知訊息模板](#通知訊息模板)
- [定時提醒（外部排程）](#定時提醒外部排程)
- [API 端點總覽](#api-端點總覽)
- [測試方式](#測試方式)
- [常見問題排錯](#常見問題排錯)
- [免費額度上限](#免費額度上限)

---

## 系統架構

```
顧客 (LINE)
    │  點預約連結
    ▼
LIFF 頁面 (index.html)  ──  取得 LINE User ID、顯示方案/加購/日曆/表單
    │
    ▼
Vercel Functions (api/)
    ├── cal.js        查方案、查時段、建立預約、設定時長（中繼 Cal.com API）
    ├── webhook.js    接收 Cal.com 預約事件 → 即時推播 LINE 給雙方
    ├── reminder.js   定時掃隔天預約 → 推播提醒（由外部排程器觸發）
    └── _line.js      LINE 推播、時間格式化、模板系統（共用工具）
    │
    ▼
Cal.com（預約引擎）── 同步 Google 日曆、儲存方案/加購/模板設定
    │
    ▼
cron-job.org（外部排程）── 每天定時呼叫 reminder
```

---

## 檔案說明

| 檔案 | 用途 |
|------|------|
| `index.html` | 前端預約界面（抹茶主題，LOGO 已內嵌） |
| `vercel.json` | 路由設定 |
| `api/cal.js` | 查方案 / 查時段 / 建立預約 / 設定可變時長 |
| `api/webhook.js` | 接收 Cal.com Webhook，即時通知雙方 |
| `api/reminder.js` | 掃隔天預約發提醒（外部排程觸發） |
| `api/_line.js` | LINE 推播、時間格式化、通知模板系統（共用，檔名底線開頭＝私有） |

> ⚠️ `_line.js` 的**底線不可省略**。少了底線，`webhook.js` 與 `reminder.js` 會因 `require("./_line")` 失敗而回傳 500。

---

## 環境變數

Vercel → Settings → Environment Variables，需設定以下變數（皆勾 Production + Preview）：

| 變數 | 用途 | 必要 |
|------|------|:---:|
| `CAL_API_KEY` | Cal.com API Key（**務必設為 Never expires**） | ✅ |
| `CAL_USERNAME` | Cal.com 完整帳號名稱（含後綴，如 `xxx-eur7wq`） | ✅ |
| `LINE_CHANNEL_TOKEN` | LINE Messaging API Channel Access Token | ✅ |
| `OWNER_LINE_USER_ID` | 店主 LINE User ID（接收店主通知） | ✅ |
| `REMINDER_KEY` | 保護 reminder 與 setDurations 端點的密鑰（純英數字） | ✅ |

> 🚨 任何環境變數修改後，都要 **Redeploy** 才生效：Deployments → 最新一筆 → ⋯ → Redeploy。

---

## 日常維護：哪些要碰 GitHub

系統設計盡量讓日常調整不碰程式碼。對照表：

| 想做的事 | 在哪裡做 | 碰 GitHub |
|---------|---------|:--------:|
| 新增 / 刪除 / 修改服務方案 | Cal.com 後台 | ❌ |
| 改方案名稱、說明、營業時段 | Cal.com 後台 | ❌ |
| 新增 / 修改 / 刪除加購 | Cal.com 方案的 Description | ❌ |
| 設定加購需要的時長選項 | 瀏覽器開 setDurations 網址 | ❌ |
| 改通知訊息文字 | Cal.com 的「通知模板」方案 | ❌ |
| 改提醒時間 | cron-job.org 後台 | ❌ |
| 改程式邏輯、版面、功能 | GitHub | ✅ |

**結論**：日常營運幾乎不用碰 GitHub。只有改動系統邏輯或版面時才需要。

---

## 加購系統

### 運作原理

加購清單寫在**各主服務自己的 Cal.com Description** 裡，前端讀取後在該方案下方長出可複選的加購按鈕。勾選加購會即時重算總時長，並以總時長查詢可用時段（確保時段正確佔用）。

### Description 加購格式

在方案的 Description 中，用 `[加購]` 標記分隔「服務說明」與「加購清單」：

```
針對肌肉的緊繃與僵硬，進行大面積的放鬆處理。

[加購]
牛角加強|30|700|請於現場告知加強部位
牛角眼額|10|200|
```

**規則：**

- `[加購]` 以上是正常服務說明，照常顯示給顧客
- `[加購]` 以下每行一個加購，用 `|` 分成四段：

  ```
  名稱 | 加時(分鐘) | 加價(元) | 備註(可留空)
  ```

- 備註留空時，最後一個 `|` 後面不寫即可
- 沒有 `[加購]` 區塊的方案，就不會顯示加購按鈕

### 顧客端效果

```
○ 經典指壓（全身）              60 分鐘
   針對肌肉的緊繃與僵硬...
   ┌ 加購選項（可複選）
   │ ☑ 牛角加強      +30min +700元
   │ ☑ 牛角眼額      +10min +200元
   │ ─────────────────────
   │ 總時長 100 分鐘　加購金額 +900 元
   │ 📌 牛角加強：請於現場告知加強部位
   └
```

加購為**可複選**、單次可加多種。勾選後總時長、金額即時更新，備註自動顯示。

### 新增一個加購的完整步驟

1. Cal.com → 該方案 → Description → 在 `[加購]` 區塊加一行（如 `精油加強|20|500|`）
2. 因為新加購改變了可能的總時長，需更新該方案的可選時長 → 見 setDurations 章節
3. 存檔，前端自動生效

> 只改**價格**不用動時長；改**加時分鐘數**才需要重設 setDurations。

---

## 可變時長設定（setDurations）

### 為什麼需要

加購會改變預約總時長（如經典指壓 60min + 牛角加強 30min = 90min）。Cal.com 需要事先知道某方案「有哪些可能時長」，才能正確查詢與佔用時段。

Cal.com 網頁的「可預約的時間長度」下拉選單只有預設數字（缺 70、100 等），所以用 API 端點設定任意時長。

### 使用方式

瀏覽器開啟（替換 `方案ID`、`時長清單`、`密鑰`）：

```
https://<your-vercel-url>/api/cal?action=setDurations&eventTypeId=方案ID&durations=60,70,90,100&key=你的REMINDER_KEY
```

成功回傳：

```json
{"ok":true,"eventTypeId":123,"defaultLength":60,"options":[60,70,90,100],"message":"已設定可選時長"}
```

### 各方案該設定的時長

以加購「牛角加強 +30」「牛角眼額 +10」為例，列出所有組合的總時長：

| 主服務 | 原時長 | durations 參數 | 涵蓋組合 |
|--------|:---:|:---:|---|
| 經典指壓60 | 60 | `60,70,90,100` | 原味/+眼額/+加強/+兩者 |
| 經典指壓90 | 90 | `90,100,120,130` | 同上邏輯 |
| 體刷90 | 90 | `90,100,120,130` | 同上 |
| 牛角背部60 | 60 | `60,70` | 只能加眼額 |

> **注意**：setDurations 會整組覆蓋原設定，所以要一次列出所有需要的數字（含原始時長）。清單中最小值會自動設為預設時長（＝未加購的原始時長）。
> `方案ID` 可從 `?action=debug` 端點查得。

---

## 通知訊息模板

### 運作原理

通知訊息（新預約、預約確認、提醒）的文字模板存在 **Cal.com 的一個隱藏方案**，程式讀取後代入變數發送。客戶改訊息只需編輯這個方案，不碰 GitHub。讀取失敗時自動使用內建預設訊息。

### 設定步驟

1. Cal.com → Event Types → 建立新方案
2. 名稱填 `_設定_通知模板`（或 slug 含 `notify-template`）
3. **設為 Hidden**（顧客看不到，程式也會過濾）
4. Description 貼入模板（見下方範本）
5. 存檔

### 模板語法

用 `[區塊名]` 分隔三種通知，各區塊內用 `{變數}` 插入動態內容：

```
[新預約-店主]
🔔 新預約通知

📋 {方案}
{加購}
📅 {時間}
⏱ {時長} 分鐘
👤 {姓名}
📱 {電話}

[預約確認-客人]
✅ 預約確認

感謝您的預約！

📋 {方案}
{加購}
📅 {時間}
⏱ {時長} 分鐘

屆時期待為您服務 💆
如需取消或改期，請直接回覆訊息。

[提醒-客人]
🔔 預約提醒

提醒您明天的預約：

📋 {方案}
{加購}
📅 {時間}
⏱ {時長} 分鐘

期待為您服務 💆
```

### 可用變數

| 變數 | 代入內容 | 適用區塊 |
|------|---------|---------|
| `{方案}` | 服務名稱 | 全部 |
| `{加購}` | 加購資訊（無加購時**該行自動消失**） | 全部 |
| `{時間}` | 預約時間（台灣時間） | 全部 |
| `{時長}` | 總時長（分鐘） | 全部 |
| `{姓名}` | 顧客姓名 | 新預約-店主 |
| `{電話}` | 顧客電話 | 新預約-店主 |

### 三個區塊的用途

| 區塊名 | 何時發送 | 發給誰 |
|--------|---------|--------|
| `[新預約-店主]` | 預約成立當下 | 店主 |
| `[預約確認-客人]` | 預約成立當下 | 顧客 |
| `[提醒-客人]` | 前一天定時 | 顧客 |

> 店主的「隔天預約彙整」通知目前為固定格式，不走模板。

### 容錯機制

- **讀不到模板**（方案不存在、格式錯誤）→ 自動用內建預設訊息，系統不中斷
- **`{加購}` 空值** → 該行自動移除，不會留下空的「➕ 加購：」
- 客戶改壞模板也不會讓通知失效，只會回到預設文字

### 改訊息的方式

Cal.com → 打開 `_設定_通知模板` → 編輯 Description → 存檔。**不需 Redeploy、不碰 GitHub**，下一筆預約即生效。

---

## 定時提醒（外部排程）

### 為什麼用外部排程

Vercel 免費版 Cron 每天限一次、且時間有 1 小時彈性窗，改時間要動 `vercel.json`（需 push GitHub）。改用 **cron-job.org** 後，提醒時間在網頁後台調整，不碰 GitHub，且可設一天多次。

### 設定方式

1. 前往 cron-job.org 註冊登入
2. Create cronjob，填入：

   | 欄位 | 值 |
   |------|-----|
   | Title | 預約前一天提醒 |
   | URL | `https://<your-vercel-url>/api/reminder?key=你的REMINDER_KEY` |
   | Schedule | 自訂時間（可設台灣時區） |

3. 儲存

### 改提醒時間

cron-job.org → 該任務 → EDIT → 改 Schedule → 儲存。**不碰 GitHub。**
若要多次提醒（如前一天 + 當天早上），新增第二個 cronjob 即可。

### reminder 的觸發驗證

`reminder.js` 支援三種觸發來源：

- 外部排程器：網址帶 `?key=REMINDER_KEY`
- Vercel 內建 Cron：帶 `Authorization: Bearer {CRON_SECRET}`
- 手動測試：`?test=1`（僅在未設 REMINDER_KEY 時可用）

---

## API 端點總覽

| 端點 | 方法 | 用途 |
|------|:---:|------|
| `/api/cal?action=eventTypes` | GET | 取得方案清單（前端用） |
| `/api/cal?action=slots&eventTypeId=X&duration=Y&startTime=&endTime=` | GET | 查時段（duration 為含加購總時長） |
| `/api/cal?action=debug` | GET | 檢視 Cal.com 原始回傳（含真實 username、方案 ID） |
| `/api/cal?action=setDurations&eventTypeId=X&durations=&key=` | GET | 設定方案可選時長（需 key） |
| `/api/cal` | POST | 建立預約（帶 lengthInMinutes、加購資訊） |
| `/api/webhook` | POST | 接收 Cal.com 預約事件，推播通知 |
| `/api/reminder?key=` | GET | 掃隔天預約發提醒（外部排程呼叫） |
| `/api/reminder?test=1` | GET | 手動測試提醒 |

---

## 測試方式

### 端點健康檢查

用瀏覽器開啟，確認皆非 404：

| 網址 | 預期回傳 |
|------|---------|
| `/api/cal?action=debug` | JSON，含方案資料 |
| `/api/cal?action=eventTypes` | JSON，方案清單 |
| `/api/webhook` | `{"error":"僅接受 POST"}` |
| `/api/reminder?test=1` | `{"ok":true,"count":...}` |

### 完整流程

1. 手機 LINE 開啟 LIFF 連結（電腦瀏覽器因非 LINE 環境會失敗）
2. 選方案 → 勾加購 → 選日期時段 → 填資料 → 確認
3. 店主收到「新預約通知」、顧客收到「預約確認」
4. 確認通知內容符合模板、加購資訊正確
5. Google 日曆出現對應時長的預約

### Cal.com Webhook 設定

- Subscriber URL：`https://<your-vercel-url>/api/webhook`
- Trigger：`BOOKING_CREATED`

---

## 常見問題排錯

### 部署類

| 錯誤 | 原因 | 解法 |
|------|------|------|
| push 後 Vercel 沒更新 | GitHub App 授權未含此 repo | GitHub → Settings → Applications → Vercel → Repository access 加入 repo |
| 端點回傳 404 | 檔案未部署 | 確認檔案在 GitHub；特別檢查 `_line.js` 底線 |
| Function crashed (500) | `require("./_line")` 失敗 | 確認 `_line.js` 檔名有底線 |

### API 類

| 錯誤 | 原因 | 解法 |
|------|------|------|
| 目前沒有可預約的方案 | CAL_USERNAME 填短帳號 | 用 `?action=debug` 確認完整 username → 更新 → Redeploy |
| API error 500 | CAL_API_KEY 未設或已過期 | 確認 Key 有效且設為 Never expires |

### 加購 / 時長類

| 錯誤 | 原因 | 解法 |
|------|------|------|
| 勾加購後日曆變空白 | 該方案沒設對應總時長 | 用 setDurations 補上該總時長 |
| 加購按鈕沒出現 | Description 格式錯誤 | 確認有 `[加購]` 標記，每行用豎線分四段 |
| 加購時段沒正確佔用 | duration 未帶或時長沒設 | 確認 setDurations 已設、前端有帶 duration |

### 通知類

| 錯誤 | 原因 | 解法 |
|------|------|------|
| 完全沒收到通知 | Cal.com Webhook 未指向 Vercel | 確認 Subscriber URL 為 `/api/webhook` |
| 只收到店主通知 | 顧客 lineUserId 未取得 | 確認 Event Type 有 lineUserId 隱藏欄位 |
| 收不到 Push | 未加官方帳號好友 | 用個人 LINE 加官方帳號 |
| 訊息還是舊格式 | 模板方案名稱/slug 未被偵測 | 確認名稱含「通知模板」或 slug 含 `notify-template` |
| reminder 未授權 | key 與 REMINDER_KEY 不符 | 確認兩邊密鑰一致、純英數字、無 URL 編碼問題 |

### Cal.com API 版本對照

系統對不同端點用不同 API 版本，這是 Cal.com 設計特性：

| 端點 | cal-api-version | 注意事項 |
|------|:---:|------|
| `/v2/event-types`（查詢 / 更新時長） | 2024-06-14 | 需帶 username |
| `/v2/slots` | 2024-09-04 | 用 eventTypeId + start/end + duration |
| `/v2/bookings` | 2024-08-13 | 需含 metadata、電話放 bookingFieldsResponses |

---

## 免費額度上限

| 元件 | 免費額度 | 每筆預約消耗 | 月處理上限 |
|------|---------|:---:|:---:|
| Cal.com | 無限 | — | — |
| Vercel | Hobby 方案 | — | — |
| cron-job.org | 無限次觸發 | — | — |
| **LINE Messaging API** | **200 則 Push/月** | 約 3–4 則 | **約 50–60 筆** |

> **瓶頸在 LINE。** 每筆預約消耗：預約確認 2 則（店主+客人）＋ 前一天提醒 1–2 則。
> 超過規模時，優先升級 LINE Messaging API 方案。

---

## 安全備註

- 所有密鑰（API Key、Token）只存在 Vercel 環境變數，**絕不寫進程式碼**
- `REMINDER_KEY` 保護 reminder 與 setDurations 端點，避免被外部亂觸發
- 建議 Cal.com、Vercel、LINE Developers 三個帳號都開啟兩步驗證（2FA）
- GitHub repo 可為 Private，Vercel 一樣能連 Private repo 部署

---

*系統：格林經絡工作室 LINE 線上預約系統*
*文件版本：v3.0（加購 + 模板 + 外部排程）*