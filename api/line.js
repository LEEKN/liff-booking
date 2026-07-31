/**
 * 共用工具：LINE 推播 + 時間格式化
 * 被 webhook.js 與 reminder.js 共用
 * （檔名以底線開頭，Vercel 不會把它當成獨立 API 端點）
 */

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

/**
 * 推播 LINE 訊息給指定對象
 * @param {string} to       - 對象的 LINE User ID
 * @param {string} text     - 訊息內容
 * @param {string} token    - LINE Channel Access Token
 * @returns {Promise<{ok:boolean, status:number, body:string}>}
 */
async function pushLine(to, text, token) {
  if (!to || !token) {
    return { ok: false, status: 0, body: "缺少 to 或 token" };
  }

  try {
    const r = await fetch(LINE_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token
      },
      body: JSON.stringify({
        to: to,
        messages: [{ type: "text", text: text }]
      })
    });

    const body = await r.text();
    if (!r.ok) {
      console.error("LINE push failed:", r.status, body);
    }
    return { ok: r.ok, status: r.status, body };
  } catch (err) {
    console.error("LINE push error:", err.message);
    return { ok: false, status: 0, body: err.message };
  }
}

/**
 * 將 UTC ISO 時間字串轉為台灣時間顯示
 * @param {string} isoStr - 例如 "2026-06-01T06:00:00.000Z"
 * @returns {{date:string, time:string, weekday:string, full:string}}
 */
function toTaiwanTime(isoStr) {
  const d = new Date(isoStr);
  // 轉台灣時間（UTC+8）
  const tw = new Date(d.getTime() + 8 * 60 * 60 * 1000);

  const yyyy = tw.getUTCFullYear();
  const mm = String(tw.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(tw.getUTCDate()).padStart(2, "0");
  const hh = String(tw.getUTCHours()).padStart(2, "0");
  const min = String(tw.getUTCMinutes()).padStart(2, "0");

  const weekNames = ["日", "一", "二", "三", "四", "五", "六"];
  const weekday = weekNames[tw.getUTCDay()];

  return {
    date: `${yyyy}-${mm}-${dd}`,
    time: `${hh}:${min}`,
    weekday: `週${weekday}`,
    full: `${mm}/${dd}（週${weekday}）${hh}:${min}`
  };
}

/**
 * 從 Cal.com 預約物件中安全取出常用欄位
 * 兼容 webhook payload 與 API 查詢兩種來源的格式差異
 */
function extractBooking(bk) {
  // 服務名稱
  const title = bk.title || bk.eventType?.title || bk.type || "預約";

  // 開始時間
  const startTime = bk.startTime || bk.start || "";

  // 時長（分鐘）
  let length = bk.length || bk.eventType?.length || 0;
  if (!length && bk.startTime && bk.endTime) {
    length = Math.round((new Date(bk.endTime) - new Date(bk.startTime)) / 60000);
  }

  // 客人姓名
  let name = "";
  if (bk.attendees && bk.attendees[0]) name = bk.attendees[0].name;
  else if (bk.responses?.name?.value) name = bk.responses.name.value;
  else if (bk.bookingFieldsResponses?.name) name = bk.bookingFieldsResponses.name;
  else if (bk.name) name = bk.name;

  // 客人 LINE User ID
  let lineUserId = "";
  if (bk.responses?.lineUserId?.value) lineUserId = bk.responses.lineUserId.value;
  else if (bk.bookingFieldsResponses?.lineUserId) lineUserId = bk.bookingFieldsResponses.lineUserId;
  else if (bk.metadata?.lineUserId) lineUserId = bk.metadata.lineUserId;

  // 客人電話
  let phone = "";
  if (bk.attendees && bk.attendees[0] && bk.attendees[0].phoneNumber) phone = bk.attendees[0].phoneNumber;
  else if (bk.responses?.attendeePhoneNumber?.value) phone = bk.responses.attendeePhoneNumber.value;
  else if (bk.bookingFieldsResponses?.attendeePhoneNumber) phone = bk.bookingFieldsResponses.attendeePhoneNumber;

  return { title, startTime, length, name, lineUserId, phone };
}

module.exports = { pushLine, toTaiwanTime, extractBooking };