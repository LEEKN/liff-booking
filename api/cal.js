/**
 * Vercel Edge Function — Cal.com API 中繼層
 * 路徑：api/cal.js
 *
 * 用途：保管 CAL_API_KEY，前端不直接接觸 API Key
 *
 * 環境變數（在 Vercel Dashboard → Settings → Environment Variables 設定）：
 *   CAL_API_KEY  — Cal.com API Key（Settings → Developer → API Keys）
 *
 * 支援的查詢：
 *   GET /api/cal?action=eventTypes               取得所有 Event Type
 *   GET /api/cal?action=slots&eventTypeId=X&startTime=ISO&endTime=ISO  取得可用時段
 *   POST /api/cal  body: { action:"createBooking", ...bookingData }    建立預約
 */

const CAL_API_BASE = "https://api.cal.com/v2";

export default async function handler(req, res) {
  // ── CORS（允許同域與 LIFF 環境呼叫） ──
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const apiKey = process.env.CAL_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "CAL_API_KEY 未設定" });
  }

  const headers = {
    "Authorization": `cal_live_${apiKey}`,
    "Content-Type": "application/json",
    "cal-api-version": "2024-08-13"
  };

  try {
    // ── GET 請求 ──
    if (req.method === "GET") {
      const { action, eventTypeId, startTime, endTime, username } = req.query;

      // 取得所有 Event Types
      if (action === "eventTypes") {
        const url = `${CAL_API_BASE}/event-types`;
        const r = await fetch(url, { headers });
        const data = await r.json();

        // 過濾並整理回傳格式
        const eventTypes = (data.data?.eventTypeGroups || [])
          .flatMap(g => g.eventTypes || [])
          .map(et => ({
            id: et.id,
            slug: et.slug,
            title: et.title,
            length: et.length,
            description: et.description || "",
            price: et.price || 0,
            currency: et.currency || "twd"
          }));

        return res.status(200).json({ eventTypes });
      }

      // 取得可用時段
      if (action === "slots") {
        if (!eventTypeId || !startTime || !endTime) {
          return res.status(400).json({ error: "缺少必要參數：eventTypeId, startTime, endTime" });
        }
        const url = `${CAL_API_BASE}/slots/available?eventTypeId=${eventTypeId}&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`;
        const r = await fetch(url, { headers });
        const data = await r.json();
        return res.status(200).json(data);
      }

      return res.status(400).json({ error: "未知的 action" });
    }

    // ── POST 請求：建立預約 ──
    if (req.method === "POST") {
      const body = req.body;

      if (body.action !== "createBooking") {
        return res.status(400).json({ error: "未知的 action" });
      }

      const {
        eventTypeId,
        startTime,
        name,
        email,
        phone,
        lineUserId,
        timeZone = "Asia/Taipei",
        language = "zh-TW"
      } = body;

      const bookingPayload = {
        eventTypeId: Number(eventTypeId),
        startTime,
        attendee: {
          name,
          email,
          phoneNumber: phone || undefined,
          timeZone,
          language
        },
        metadata: {},
        responses: {
          name,
          email,
          phone: phone || undefined,
          lineUserId: lineUserId || ""
        }
      };

      const r = await fetch(`${CAL_API_BASE}/bookings`, {
        method: "POST",
        headers,
        body: JSON.stringify(bookingPayload)
      });

      const data = await r.json();

      if (!r.ok) {
        console.error("Cal.com booking error:", data);
        return res.status(r.status).json({ error: data.message || "預約建立失敗", detail: data });
      }

      return res.status(200).json({ success: true, booking: data.data });
    }

    return res.status(405).json({ error: "不支援的請求方法" });

  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "伺服器錯誤", message: err.message });
  }
}
