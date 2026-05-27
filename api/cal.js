/**
 * Vercel Serverless Function — Cal.com API 中繼層
 * 環境變數：CAL_API_KEY, CAL_USERNAME
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

  const token = apiKey.startsWith("cal_") ? apiKey : "cal_live_" + apiKey;

  try {
    // ══ GET ══
    if (req.method === "GET") {
      const { action, eventTypeId, startTime, endTime } = req.query;

      // debug
      if (action === "debug") {
        const r = await fetch(
          CAL_API_BASE + "/event-types?username=" + encodeURIComponent(calUsername),
          { headers: { "Authorization": "Bearer " + token, "cal-api-version": "2024-06-14" } }
        );
        return res.status(200).json({ status: r.status, raw: await r.json() });
      }

      // 取得方案
      if (action === "eventTypes") {
        const r = await fetch(
          CAL_API_BASE + "/event-types?username=" + encodeURIComponent(calUsername),
          { headers: { "Authorization": "Bearer " + token, "cal-api-version": "2024-06-14" } }
        );
        const data = await r.json();

        let raw = [];
        if (Array.isArray(data.data)) raw = data.data;
        else if (data.data && Array.isArray(data.data.eventTypes)) raw = data.data.eventTypes;
        else if (data.data && Array.isArray(data.data.eventTypeGroups))
          raw = data.data.eventTypeGroups.flatMap(g => g.eventTypes || []);

        const realUsername = (raw.length > 0 && raw[0].users && raw[0].users[0])
          ? raw[0].users[0].username : calUsername;

        const eventTypes = raw
          .filter(et => {
            if (et.hidden) return false;
            const slug = (et.slug || "").toLowerCase();
            return !slug.includes("checking") && !slug.includes("test");
          })
          .map(et => ({
            id: et.id, slug: et.slug, title: et.title,
            length: et.length || et.lengthInMinutes,
            description: et.description || "", realUsername
          }));

        return res.status(200).json({ eventTypes });
      }

      // 取得時段（2024-09-04 版本，用 eventTypeId + start/end）
      if (action === "slots") {
        if (!eventTypeId || !startTime || !endTime)
          return res.status(400).json({ error: "缺少參數" });

        const url = CAL_API_BASE + "/slots"
          + "?eventTypeId=" + encodeURIComponent(eventTypeId)
          + "&start=" + encodeURIComponent(startTime)
          + "&end=" + encodeURIComponent(endTime);

        const r = await fetch(url, {
          headers: { "Authorization": "Bearer " + token, "cal-api-version": "2024-09-04" }
        });
        return res.status(200).json(await r.json());
      }

      return res.status(400).json({ error: "未知 action" });
    }

    // ══ POST：建立預約 ══
    if (req.method === "POST") {
      const body = req.body;
      if (!body || body.action !== "createBooking")
        return res.status(400).json({ error: "未知 action" });

      // 最簡 payload，只放 Cal.com 文件明確要求的欄位
      const payload = {
        eventTypeId: Number(body.eventTypeId),
        start: body.startTime,
        metadata: {},
        attendee: {
          name: body.name,
          email: body.email,
          timeZone: "Asia/Taipei",
          language: "zh-TW"
        }
      };

      // 電話號碼轉國際格式（09xxxxxxxx → +8869xxxxxxxx）
      if (body.phone) {
        const phone = body.phone.trim().replace(/[\s\-]/g, "");
        const intlPhone = phone.startsWith("+") ? phone
          : phone.startsWith("09") ? "+886" + phone.slice(1)
          : phone.startsWith("0") ? "+886" + phone.slice(1)
          : "+" + phone;

        payload.bookingFieldsResponses = { attendeePhoneNumber: intlPhone };
        payload.attendee.phoneNumber = intlPhone;
      }

      // lineUserId 傳入 bookingFieldsResponses，Make 用來發客戶通知
      if (body.lineUserId) {
        payload.bookingFieldsResponses = payload.bookingFieldsResponses || {};
        payload.bookingFieldsResponses.lineUserId = body.lineUserId;
      }

      console.log("Booking payload:", JSON.stringify(payload));

      const r = await fetch(CAL_API_BASE + "/bookings", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json",
          "cal-api-version": "2024-08-13"
        },
        body: JSON.stringify(payload)
      });

      const data = await r.json();
      console.log("Booking response:", r.status, JSON.stringify(data));

      if (!r.ok) return res.status(r.status).json({ error: "預約失敗", detail: data });
      return res.status(200).json({ success: true, booking: data.data });
    }

    return res.status(405).json({ error: "不支援的方法" });

  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "伺服器錯誤", message: err.message });
  }
};