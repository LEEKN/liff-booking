/**
 * Vercel Serverless Function — Cal.com API 中繼層
 * 環境變數：CAL_API_KEY, CAL_USERNAME
 */

const CAL_API_BASE = "https://api.cal.com/v2";

/**
 * 解析 Event Type 的 Description，分離「服務說明」與「加購清單」
 *
 * 格式範例：
 *   針對肌肉的緊繃與僵硬，進行大面積的放鬆處理。
 *
 *   [加購]
 *   牛角加強|30|700|請於現場告知加強部位
 *   牛角眼額|10|200|
 *
 * 回傳 { desc: "服務說明", addons: [{name, minutes, price, note}] }
 */
function parseDescription(description) {
  if (!description) return { desc: "", addons: [] };

  // 去除 HTML 標籤與 Markdown 反引號
  const plain = description
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/`/g, "");

  const marker = plain.indexOf("[加購]");
  if (marker === -1) {
    return { desc: plain.trim(), addons: [] };
  }

  const desc = plain.substring(0, marker).trim();
  const addonBlock = plain.substring(marker + "[加購]".length);

  const addons = [];
  addonBlock.split("\n").forEach(line => {
    const t = line.trim();
    if (!t) return;
    const parts = t.split("|");
    if (parts.length < 2) return;

    const name = (parts[0] || "").trim();
    const minutes = parseInt((parts[1] || "0").trim(), 10);
    const price = parseInt((parts[2] || "0").trim(), 10);
    const note = (parts[3] || "").trim();

    if (!name || isNaN(minutes)) return;
    addons.push({
      name,
      minutes: minutes,
      price: isNaN(price) ? 0 : price,
      note
    });
  });

  return { desc, addons };
}

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
            const title = et.title || "";
            // 過濾測試方案與設定用方案（通知模板）
            if (slug.includes("checking") || slug.includes("test")) return false;
            if (slug.includes("notify-template") || title.indexOf("通知模板") !== -1) return false;
            if (title.indexOf("_設定") === 0) return false;
            return true;
          })
          .map(et => {
            const parsed = parseDescription(et.description || "");
            return {
              id: et.id, slug: et.slug, title: et.title,
              length: et.length || et.lengthInMinutes,
              lengthOptions: et.lengthInMinutesOptions || null,
              description: parsed.desc,
              addons: parsed.addons,
              realUsername
            };
          });

        return res.status(200).json({ eventTypes });
      }

      // ── 設定方案的可選時長（繞過網頁下拉選單的預設清單限制）──
      // 用法：/api/cal?action=setDurations&eventTypeId=123&durations=60,70,90,100&key=你的REMINDER_KEY
      if (action === "setDurations") {
        const adminKey = process.env.REMINDER_KEY;
        if (!adminKey || req.query.key !== adminKey) {
          return res.status(401).json({ error: "未授權：需帶正確的 key 參數" });
        }
        if (!eventTypeId || !req.query.durations) {
          return res.status(400).json({ error: "缺少參數：eventTypeId, durations" });
        }

        const list = String(req.query.durations)
          .split(",")
          .map(s => parseInt(s.trim(), 10))
          .filter(n => !isNaN(n) && n > 0);

        if (!list.length) {
          return res.status(400).json({ error: "durations 格式錯誤，範例：60,70,90,100" });
        }

        // 預設時長：取最小值（等於未加購的原始時長）
        const defaultLen = Math.min.apply(null, list);

        const r = await fetch(CAL_API_BASE + "/event-types/" + encodeURIComponent(eventTypeId), {
          method: "PATCH",
          headers: {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
            "cal-api-version": "2024-06-14"
          },
          body: JSON.stringify({
            lengthInMinutes: defaultLen,
            lengthInMinutesOptions: list
          })
        });

        const data = await r.json();
        if (!r.ok) {
          return res.status(r.status).json({ error: "設定失敗", detail: data });
        }
        return res.status(200).json({
          ok: true,
          eventTypeId: Number(eventTypeId),
          defaultLength: defaultLen,
          options: list,
          message: "已設定可選時長"
        });
      }

      // 取得時段（2024-09-04 版本，用 eventTypeId + start/end）
      // duration：可變時長方案指定本次要查的總時長（含加購）
      if (action === "slots") {
        if (!eventTypeId || !startTime || !endTime)
          return res.status(400).json({ error: "缺少參數" });

        let url = CAL_API_BASE + "/slots"
          + "?eventTypeId=" + encodeURIComponent(eventTypeId)
          + "&start=" + encodeURIComponent(startTime)
          + "&end=" + encodeURIComponent(endTime);

        // 有指定時長就帶上（可變時長 event type 用）
        if (req.query.duration) {
          url += "&duration=" + encodeURIComponent(req.query.duration);
        }

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

      // 可變時長：加購後的總時長
      if (body.lengthInMinutes) {
        payload.lengthInMinutes = Number(body.lengthInMinutes);
      }

      // 加購資訊寫進 metadata，供通知訊息使用
      if (body.addons) {
        payload.metadata.addons = String(body.addons).slice(0, 500);
      }
      if (body.totalPrice) {
        payload.metadata.totalPrice = String(body.totalPrice);
      }

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

      // lineUserId 傳入 bookingFieldsResponses，webhook.js / reminder.js 用來發客戶通知
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