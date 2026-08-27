/**
 * Vercel Function — 訪客點擊追蹤中繼
 * 前端點方案/加購時呼叫，轉發到 Google Apps Script 寫入試算表
 *
 * 環境變數：
 *   TRACK_WEBHOOK_URL   Google Apps Script 發布的 Web App 網址
 *
 * 前端呼叫方式（POST）：
 *   { lineUserId, action: "方案"|"加購", itemName, planName }
 */

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "僅接受 POST" });
  }

  const webhookUrl = process.env.TRACK_WEBHOOK_URL;
  if (!webhookUrl) {
    // 未設定追蹤網址時，靜默成功（不影響預約流程）
    return res.status(200).json({ ok: false, skipped: "TRACK_WEBHOOK_URL 未設定" });
  }

  try {
    const body = req.body || {};

    // 台灣時間字串
    const now = new Date();
    const tw = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const timeStr = tw.getUTCFullYear() + "-"
      + String(tw.getUTCMonth() + 1).padStart(2, "0") + "-"
      + String(tw.getUTCDate()).padStart(2, "0") + " "
      + String(tw.getUTCHours()).padStart(2, "0") + ":"
      + String(tw.getUTCMinutes()).padStart(2, "0") + ":"
      + String(tw.getUTCSeconds()).padStart(2, "0");

    const record = {
      time: timeStr,
      lineUserId: body.lineUserId || "",
      action: body.action || "",       // "方案" 或 "加購"
      itemName: body.itemName || "",    // 點的方案名 或 加購名
      planName: body.planName || ""     // 點加購時，所屬的方案名
    };

    // 轉發到 Apps Script（不等太久，避免拖慢前端）
    const r = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record)
    });

    if (!r.ok) {
      console.error("Apps Script 回應非 200:", r.status);
      return res.status(200).json({ ok: false, status: r.status });
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    // 追蹤失敗不能影響使用者，一律回 200
    console.error("Track error:", err.message);
    return res.status(200).json({ ok: false, error: err.message });
  }
};