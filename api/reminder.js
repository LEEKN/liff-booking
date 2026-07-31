/**
 * Vercel Function — 每天定時提醒（Cron Job）
 * 掃描「明天」的所有預約，客人各自提醒 + 店主彙整一則
 *
 * 環境變數：
 *   CAL_API_KEY          Cal.com API Key
 *   LINE_CHANNEL_TOKEN   LINE Messaging API Token
 *   OWNER_LINE_USER_ID   店主 LINE User ID
 *   CRON_SECRET          Vercel 自動產生，用來驗證 cron 來源
 *
 * 由 vercel.json 的 crons 設定觸發：
 *   台灣晚上 8 點 = UTC 12 點 → schedule: "0 12 * * *"
 *
 * 也可手動測試：GET https://你的vercel網址/api/reminder?test=1
 */

const { pushLine, toTaiwanTime, extractBooking } = require("./_line");

const CAL_API_BASE = "https://api.cal.com/v2";

module.exports = async function handler(req, res) {
  const apiKey     = process.env.CAL_API_KEY;
  const lineToken  = process.env.LINE_CHANNEL_TOKEN;
  const ownerId    = process.env.OWNER_LINE_USER_ID;
  const cronSecret = process.env.CRON_SECRET;

  if (!apiKey)    return res.status(500).json({ error: "CAL_API_KEY 未設定" });
  if (!lineToken) return res.status(500).json({ error: "LINE_CHANNEL_TOKEN 未設定" });
  if (!ownerId)   return res.status(500).json({ error: "OWNER_LINE_USER_ID 未設定" });

  // ── 驗證來源：只允許 Vercel Cron 或帶正確 secret 的測試 ──
  const isTest = req.query && req.query.test === "1";
  const authHeader = req.headers["authorization"] || "";
  const cronOk = cronSecret && authHeader === "Bearer " + cronSecret;

  if (!cronOk && !isTest) {
    return res.status(401).json({ error: "未授權" });
  }

  const token = apiKey.startsWith("cal_") ? apiKey : "cal_live_" + apiKey;

  try {
    // ── 計算「明天」的台灣時間範圍，轉為 UTC ──
    // 台灣明天 00:00 = UTC 今天 16:00；台灣明天 23:59 = UTC 明天 15:59
    const now = new Date();
    const twNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    // 台灣明天 00:00:00
    const twTomorrowStart = new Date(Date.UTC(
      twNow.getUTCFullYear(), twNow.getUTCMonth(), twNow.getUTCDate() + 1, 0, 0, 0
    ));
    // 台灣明天 23:59:59
    const twTomorrowEnd = new Date(Date.UTC(
      twNow.getUTCFullYear(), twNow.getUTCMonth(), twNow.getUTCDate() + 1, 23, 59, 59
    ));
    // 轉回 UTC（減 8 小時）
    const utcStart = new Date(twTomorrowStart.getTime() - 8 * 60 * 60 * 1000).toISOString();
    const utcEnd   = new Date(twTomorrowEnd.getTime() - 8 * 60 * 60 * 1000).toISOString();

    console.log("查詢明天預約範圍:", utcStart, "~", utcEnd);

    // ── 查詢 Cal.com 預約 ──
    const url = CAL_API_BASE + "/bookings"
      + "?afterStart=" + encodeURIComponent(utcStart)
      + "&beforeEnd=" + encodeURIComponent(utcEnd)
      + "&status=upcoming"
      + "&sortStart=asc";

    const r = await fetch(url, {
      headers: {
        "Authorization": "Bearer " + token,
        "cal-api-version": "2024-08-13"
      }
    });

    const data = await r.json();
    if (!r.ok) {
      console.error("查詢預約失敗:", r.status, JSON.stringify(data));
      return res.status(200).json({ ok: false, error: "查詢預約失敗", detail: data });
    }

    // 取出預約清單
    let bookings = [];
    if (Array.isArray(data.data)) bookings = data.data;
    else if (data.data && Array.isArray(data.data.bookings)) bookings = data.data.bookings;

    // ── 程式端二次過濾：確保只留「明天」的預約 ──
    // （Cal.com 的 afterStart/beforeEnd 參數在部分情況不穩定，這裡做保險）
    const startMs = new Date(utcStart).getTime();
    const endMs = new Date(utcEnd).getTime();
    bookings = bookings.filter(bk => {
      const s = bk.startTime || bk.start;
      if (!s) return false;
      const ms = new Date(s).getTime();
      return ms >= startMs && ms <= endMs;
    });

    console.log("明天預約筆數:", bookings.length);

    // ── 沒有預約：只通知店主「明天無預約」（選填，可省一則）──
    if (bookings.length === 0) {
      // 為了省 LINE 額度，無預約時不發送。若想收到「明天沒預約」通知，取消下方註解。
      // await pushLine(ownerId, "📋 明天沒有預約。", lineToken);
      return res.status(200).json({ ok: true, count: 0, message: "明天無預約，未發送" });
    }

    // ── 整理每筆預約 ──
    const parsed = bookings.map(bk => {
      const info = extractBooking(bk);
      const tw = info.startTime ? toTaiwanTime(info.startTime) : null;
      return { ...info, tw };
    });

    // ── 1. 逐筆提醒客人 ──
    let customerSent = 0;
    for (const bk of parsed) {
      if (!bk.lineUserId) continue;

      const timeStr = bk.tw ? bk.tw.full : "（時間未知）";
      const msg =
        "🔔 預約提醒\n" +
        "\n" +
        "提醒您明天的預約：\n" +
        "\n" +
        "📋 " + bk.title + "\n" +
        "📅 " + timeStr + "\n" +
        "⏱ " + (bk.length || "?") + " 分鐘\n" +
        "\n" +
        "期待為您服務 💆\n" +
        "如需取消或改期，請直接回覆訊息。";

      const result = await pushLine(bk.lineUserId, msg, lineToken);
      if (result.ok) customerSent++;
    }

    // ── 2. 店主彙整通知（一則列出全部）──
    const tomorrowDate = parsed[0]?.tw?.date || "";
    const lines = parsed.map(bk => {
      const time = bk.tw ? bk.tw.time : "??:??";
      return time + "  " + (bk.name || "未提供") + "  " + bk.title + " " + (bk.length || "?") + "min";
    });

    const ownerMsg =
      "📋 明天預約總覽（" + tomorrowDate + "）\n" +
      "共 " + parsed.length + " 筆\n" +
      "\n" +
      lines.join("\n");

    const ownerResult = await pushLine(ownerId, ownerMsg, lineToken);

    console.log("客人提醒:", customerSent, "/ 店主彙整:", ownerResult.ok);

    return res.status(200).json({
      ok: true,
      count: parsed.length,
      customerSent,
      ownerSent: ownerResult.ok
    });

  } catch (err) {
    console.error("Reminder error:", err);
    return res.status(200).json({ ok: false, error: err.message });
  }
};