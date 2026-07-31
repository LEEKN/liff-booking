# 格林經絡工作室 — LINE 線上預約系統

自建 LIFF 預約界面，顧客全程在 LINE 內完成預約，不接觸 Cal.com 原生頁面。
通知系統由 Vercel Functions 處理，已取代 Make。

## 系統架構

```
顧客 (LINE)
    │
    ▼
LIFF 頁面 (index.html)
    │  取得 LINE User ID → 顯示方案 / 日曆 / 表單
    ▼
Vercel Functions (api/)
    ├── cal.js        查方案、查時段、建立預約（中繼 Cal.com API）
    ├── webhook.js    接收 Cal.com 預約事件 → 即時推播 LINE 給雙方
    ├── reminder.js   每天定時掃隔天預約 → 推播提醒（Cron）
    └── _line.js      LINE 推播共用工具
    │
    ▼
Cal.com（預約引擎 + Google 日曆同步）
```

## 檔案說明

| 檔案 | 用途 |
|------|------|
| `index.html` | 前端預約界面（抹茶主題） |
| `vercel.json` | 路由設定 + Cron 排程 |
| `api/cal.js` | 查方案 / 查時段 / 建立預約 |
| `api/webhook.js` | 接收 Cal.com Webhook，即時通知雙方 |
| `api/reminder.js` | 每天 20:00（台灣）提醒隔天預約 |
| `api/_line.js` | LINE 推播與時間格式化共用工具 |

## 環境變數（Vercel）

| 變數 | 用途 |
|------|------|
| `CAL_API_KEY` | Cal.com API Key（設為 Never expires） |
| `CAL_USERNAME` | Cal.com 完整帳號名稱（含後綴） |
| `LINE_CHANNEL_TOKEN` | LINE Messaging API Channel Access Token |
| `OWNER_LINE_USER_ID` | 店主 LINE User ID（接收通知） |

## 通知設計

| 時機 | 觸發來源 | 客人 | 店主 |
|------|---------|------|------|
| 預約當下 | `webhook.js` | 預約確認 | 新預約通知 |
| 前一天 20:00 | `reminder.js`（Cron） | 各自提醒 | 彙整總覽（一則） |

## Cal.com Webhook 設定

- Subscriber URL：`https://<your-vercel-url>/api/webhook`
- Trigger：`BOOKING_CREATED`

## 測試方式

- 手動測試提醒：`https://<your-vercel-url>/api/reminder?test=1`
- 完整流程：手機 LINE 開啟 LIFF 連結走一次預約

## 免費額度上限

月處理量約 100 筆，瓶頸為 LINE Messaging API 免費版 200 則 Push/月。
