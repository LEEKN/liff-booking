/**
 * Vercel Function — 接收 Cal.com Webhook，即時推播 LINE 通知
 * 取代 Make 的即時通知流程
 *
 * 環境變數：
 *   LINE_CHANNEL_TOKEN   LINE Messaging API Channel Access Token
 *   OWNER_LINE_USER_ID   店主的 LINE User ID（接收商家通知）
 *   CAL_WEBHOOK_SECRET   （選填）Cal.com Webhook 簽章密鑰，用來驗證來源
 *
 * Cal.com Webhook 設定：
 *   Subscriber URL: https://你的vercel網址/api/webhook
 *   Triggers: BOOKING_CREATED（必選），可加 BOOKING_CANCELLED
 */

const crypto = require("crypto");
const { pushLine, toTaiwanTime, extractBooking, loadTemplates, renderTemplate } = require("./_line");

module.exports = async function handler(req, res) {
  // 只接受 POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "僅接受 POST" });
  }

  const lineToken   = process.env.LINE_CHANNEL_TOKEN;
  const ownerId     = process.env.OWNER_LINE_USER_ID;
  const webhookSecret = process.env.CAL_WEBHOOK_SECRET;

  if (!lineToken) return res.status(500).json({ error: "LINE_CHANNEL_TOKEN 未設定" });
  if (!ownerId)   return res.status(500).json({ error: "OWNER_LINE_USER_ID 未設定" });

  try {
    // ── 選填：驗證 Cal.com 簽章，防止外部偽造 ──
    if (webhookSecret) {
      const signature = req.headers["x-cal-signature-256"];
      const rawBody = JSON.stringify(req.body);
      const expected = crypto
        .createHmac("sha256", webhookSecret)
        .update(rawBody)
        .digest("hex");

      if (signature !== expected) {
        console.error("Webhook 簽章驗證失敗");
        return res.status(401).json({ error: "簽章驗證失敗" });
      }
    }

    const body = req.body;
    const triggerEvent = body.triggerEvent || "";
    const payload = body.payload || {};

    console.log("Webhook received:", triggerEvent);

    // 只處理預約建立事件
    if (triggerEvent !== "BOOKING_CREATED") {
      return res.status(200).json({ ok: true, skipped: triggerEvent });
    }

    // 取出預約資訊
    const bk = extractBooking(payload);
    const tw = bk.startTime ? toTaiwanTime(bk.startTime) : null;
    const timeStr = tw ? tw.full : "（時間未知）";

    // 讀取自訂模板（存在 Cal.com 隱藏方案；讀不到就用內建預設）
    let templates = null;
    if (process.env.CAL_API_KEY && process.env.CAL_USERNAME) {
      templates = await loadTemplates(process.env.CAL_API_KEY, process.env.CAL_USERNAME);
    }

    // 可代入模板的變數
    const vars = {
      "方案": bk.title,
      "加購": bk.addons ? "➕ 加購：" + bk.addons : "",
      "時間": timeStr,
      "時長": (bk.length || "?"),
      "姓名": bk.name || "未提供",
      "電話": bk.phone || "未提供"
    };

    // 內建預設訊息（模板讀不到時的後備）
    const addonLine = bk.addons ? "➕ 加購：" + bk.addons + "\n" : "";
    const defaultOwner =
      "🔔 新預約通知\n\n📋 " + bk.title + "\n" + addonLine +
      "📅 " + timeStr + "\n⏱ " + (bk.length || "?") + " 分鐘\n" +
      "👤 " + (bk.name || "未提供") + "\n📱 " + (bk.phone || "未提供");
    const defaultCustomer =
      "✅ 預約確認\n\n感謝您的預約！\n\n📋 " + bk.title + "\n" + addonLine +
      "📅 " + timeStr + "\n⏱ " + (bk.length || "?") + " 分鐘\n\n" +
      "屆時期待為您服務 💆\n如需取消或改期，請直接回覆訊息。";

    // ── 1. 通知店主 ──
    const ownerMsg = (templates && templates["新預約-店主"])
      ? renderTemplate(templates["新預約-店主"], vars)
      : defaultOwner;

    const ownerResult = await pushLine(ownerId, ownerMsg, lineToken);

    // ── 2. 通知客人（如果有 lineUserId）──
    let customerResult = { ok: false, body: "無 lineUserId" };
    if (bk.lineUserId) {
      const customerMsg = (templates && templates["預約確認-客人"])
        ? renderTemplate(templates["預約確認-客人"], vars)
        : defaultCustomer;

      customerResult = await pushLine(bk.lineUserId, customerMsg, lineToken);
    }

    console.log("Owner push:", ownerResult.ok, "Customer push:", customerResult.ok);

    return res.status(200).json({
      ok: true,
      owner: ownerResult.ok,
      customer: customerResult.ok
    });

  } catch (err) {
    console.error("Webhook error:", err);
    // 即使出錯也回 200，避免 Cal.com 一直重試
    return res.status(200).json({ ok: false, error: err.message });
  }
};