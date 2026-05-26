/**
 * Vercel Serverless Function — Cal.com API 中繼層
 *
 * 環境變數（Vercel Dashboard → Settings → Environment Variables）：
 *   CAL_API_KEY      Cal.com API Key（原始字串，不含 cal_live_ 前綴）
 *   CAL_USERNAME     Cal.com 帳號名稱（例如 tomisacat）
 */

const CAL_API_BASE = "https://api.cal.com/v2";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const apiKey      = process.env.CAL_API_KEY;
  const calUsername = process.env.CAL_USERNAME;

  if (!apiKey)      return res.status(500).json({ error: "CAL_API_KEY 未設定" });
  if (!calUsername) return res.status(500).json({ error: "CAL_USERNAME 未設定" });

  // Cal.com v2 需要 cal_live_ 前綴
  const token = apiKey.startsWith("cal_") ? apiKey : "cal_live_" + apiKey;

  const headers = {
    "Authorization": "Bearer " + token,
    "Content-Type": "application/json",
    "cal-api-version": "2024-06-14"
  };

  try {
    if (req.method === "GET") {
      const { action, eventSlug, startTime, endTime } = req.query;

      // ── debug：看原始回傳 ──
      if (action === "debug") {
        const r = await fetch(
          CAL_API_BASE + "/event-types?username=" + encodeURIComponent(calUsername),
          { headers }
        );
        const raw = await r.json();
        return res.status(200).json({ status: r.status, raw });
      }

      // ── 取得所有方案 ──
      if (action === "eventTypes") {
        const r = await fetch(
          CAL_API_BASE + "/event-types?username=" + encodeURIComponent(calUsername),
          { headers }
        );
        const data = await r.json();

        // v2 with 2024-06-14: data.data 為陣列
        let raw = [];
        if (Array.isArray(data.data)) {
          raw = data.data;
        } else if (data.data && Array.isArray(data.data.eventTypes)) {
          raw = data.data.eventTypes;
        } else if (data.data && Array.isArray(data.data.eventTypeGroups)) {
          raw = data.data.eventTypeGroups.flatMap(function(g) {
            return g.eventTypes || [];
          });
        }

        const eventTypes = raw.map(function(et) {
          return {
            id:          et.id,
            slug:        et.slug,
            title:       et.title,
            length:      et.length || et.lengthInMinutes,
            description: et.description || ""
          };
        });

        return res.status(200).json({ eventTypes });
      }

      // ── 取得可用時段 ──
      if (action === "slots") {
        if (!eventSlug || !startTime || !endTime) {
          return res.status(400).json({ error: "缺少參數：eventSlug, startTime, endTime" });
        }

        // Cal.com v2 slots 用 username + eventSlug，不用 eventTypeId
        const url = CAL_API_BASE + "/slots"
          + "?username=" + encodeURIComponent(calUsername)
          + "&eventSlug=" + encodeURIComponent(eventSlug)
          + "&startTime=" + encodeURIComponent(startTime)
          + "&endTime="   + encodeURIComponent(endTime);

        const r    = await fetch(url, { headers });
        const data = await r.json();
        return res.status(200).json(data);
      }

      return res.status(400).json({ error: "未知 action" });
    }

    // ── 建立預約 ──
    if (req.method === "POST") {
      const body = req.body;
      if (!body || body.action !== "createBooking") {
        return res.status(400).json({ error: "未知 action" });
      }

      const payload = {
        eventTypeId: Number(body.eventTypeId),
        startTime:   body.startTime,
        attendee: {
          name:     body.name,
          email:    body.email,
          timeZone: "Asia/Taipei",
          language: "zh-TW"
        },
        responses: {
          name:        body.name,
          email:       body.email,
          lineUserId:  body.lineUserId || ""
        }
      };

      if (body.phone) {
        payload.attendee.phoneNumber = body.phone;
        payload.responses.phone      = body.phone;
      }

      const r    = await fetch(CAL_API_BASE + "/bookings", {
        method:  "POST",
        headers: headers,
        body:    JSON.stringify(payload)
      });
      const data = await r.json();

      if (!r.ok) {
        return res.status(r.status).json({
          error:  data.message || "預約失敗",
          detail: data
        });
      }
      return res.status(200).json({ success: true, booking: data.data });
    }

    return res.status(405).json({ error: "不支援的方法" });

  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "伺服器錯誤", message: err.message });
  }
};