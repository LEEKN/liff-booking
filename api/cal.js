const CAL_API_BASE = "https://api.cal.com/v2";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const apiKey = process.env.CAL_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "CAL_API_KEY 未設定" });

  const headers = {
    "Authorization": "Bearer " + apiKey,
    "Content-Type": "application/json",
    "cal-api-version": "2024-08-13"
  };

  try {
    if (req.method === "GET") {
      const { action, eventTypeId, startTime, endTime } = req.query;

      // ── debug：看原始回傳結構 ──
      if (action === "debug") {
        const r = await fetch(CAL_API_BASE + "/event-types", { headers });
        const raw = await r.json();
        return res.status(200).json({ status: r.status, raw });
      }

      // ── 取得方案 ──
      if (action === "eventTypes") {
        const r = await fetch(CAL_API_BASE + "/event-types", { headers });
        const data = await r.json();

        // Cal.com v2 可能的結構：
        // 1. data.data.eventTypeGroups[].eventTypes[]
        // 2. data.data[]  (直接陣列)
        // 3. data.eventTypes[]
        let eventTypes = [];

        if (data.data) {
          if (Array.isArray(data.data)) {
            // 直接陣列
            eventTypes = data.data;
          } else if (data.data.eventTypeGroups) {
            // 群組結構
            eventTypes = data.data.eventTypeGroups
              .flatMap(function(g) { return g.eventTypes || []; });
          } else if (data.data.eventTypes) {
            eventTypes = data.data.eventTypes;
          }
        } else if (Array.isArray(data.eventTypes)) {
          eventTypes = data.eventTypes;
        } else if (Array.isArray(data)) {
          eventTypes = data;
        }

        const result = eventTypes.map(function(et) {
          return {
            id: et.id,
            slug: et.slug,
            title: et.title,
            length: et.length,
            description: et.description || ""
          };
        });

        return res.status(200).json({ eventTypes: result });
      }

      // ── 取得時段 ──
      if (action === "slots") {
        if (!eventTypeId || !startTime || !endTime) {
          return res.status(400).json({ error: "缺少參數" });
        }
        const url = CAL_API_BASE + "/slots/available"
          + "?eventTypeId=" + eventTypeId
          + "&startTime=" + encodeURIComponent(startTime)
          + "&endTime=" + encodeURIComponent(endTime);
        const r = await fetch(url, { headers });
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
        startTime: body.startTime,
        attendee: {
          name: body.name,
          email: body.email,
          timeZone: "Asia/Taipei",
          language: "zh-TW"
        },
        responses: {
          name: body.name,
          email: body.email,
          lineUserId: body.lineUserId || ""
        }
      };

      if (body.phone) {
        payload.attendee.phoneNumber = body.phone;
        payload.responses.phone = body.phone;
      }

      const r = await fetch(CAL_API_BASE + "/bookings", {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload)
      });

      const data = await r.json();
      if (!r.ok) {
        return res.status(r.status).json({ error: data.message || "預約失敗", detail: data });
      }
      return res.status(200).json({ success: true, booking: data.data });
    }

    return res.status(405).json({ error: "不支援的方法" });

  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "伺服器錯誤", message: err.message });
  }
};