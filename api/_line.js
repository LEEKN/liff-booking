/**
 * 共用工具：LINE 推播 + 時間格式化
 * 被 webhook.js 與 reminder.js 共用
 * （檔名以底線開頭，Vercel 不會把它當成獨立 API 端點）
 */

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

const CAL_API_BASE_FOR_TPL = "https://api.cal.com/v2";

/**
 * 讀取通知訊息模板
 *
 * 模板存放：Cal.com 一個隱藏方案，slug 含 "notify-template" 或名稱含 "_設定_通知模板"
 * 該方案的 Description 用區塊格式：
 *
 *   [新預約-店主]
 *   🔔 新預約通知
 *   📋 {方案}
 *   ...
 *
 *   [預約確認-客人]
 *   ...
 *
 * 回傳 { "新預約-店主": "...", "預約確認-客人": "...", ... }
 * 讀取失敗回傳 null（呼叫端會改用內建預設）
 */
async function loadTemplates(calApiKey, calUsername) {
  try {
    const token = calApiKey.startsWith("cal_") ? calApiKey : "cal_live_" + calApiKey;
    const r = await fetch(
      CAL_API_BASE_FOR_TPL + "/event-types?username=" + encodeURIComponent(calUsername),
      { headers: { "Authorization": "Bearer " + token, "cal-api-version": "2024-06-14" } }
    );
    if (!r.ok) return null;
    const data = await r.json();

    let list = [];
    if (Array.isArray(data.data)) list = data.data;
    else if (data.data && Array.isArray(data.data.eventTypes)) list = data.data.eventTypes;
    else if (data.data && Array.isArray(data.data.eventTypeGroups))
      list = data.data.eventTypeGroups.flatMap(g => g.eventTypes || []);

    // 找模板方案：slug 含 notify-template 或 title 含 通知模板
    const tpl = list.find(et => {
      const slug = (et.slug || "").toLowerCase();
      const title = et.title || "";
      return slug.indexOf("notify-template") !== -1 || title.indexOf("通知模板") !== -1;
    });

    if (!tpl || !tpl.description) return null;
    return parseTemplateBlocks(tpl.description);
  } catch (err) {
    console.error("讀取模板失敗:", err.message);
    return null;
  }
}

/**
 * 解析模板 Description 成區塊
 * [區塊名] 以下到下一個 [ 之前的內容為該區塊
 */
function parseTemplateBlocks(description) {
  // 去 HTML
  const plain = description
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\\\[/g, "[")
    .replace(/\\\]/g, "]");

  const blocks = {};
  // 用 [區塊名] 切分
  const re = /\[([^\]]+)\]/g;
  let matches = [];
  let m;
  while ((m = re.exec(plain)) !== null) {
    matches.push({ name: m[1].trim().replace(/\\/g, ""), start: m.index, contentStart: m.index + m[0].length });
  }

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = matches[i + 1];
    const end = next ? next.start : plain.length;
    const content = plain.substring(cur.contentStart, end).replace(/^\n+|\n+$/g, "");
    blocks[cur.name] = content;
  }

  return Object.keys(blocks).length ? blocks : null;
}

/**
 * 把模板字串裡的 {變數} 代入實際值
 * vars 例：{ 方案:"經典指壓", 時間:"6/1 14:00", 加購:"牛角加強", ... }
 * 特殊處理：{加購} 若為空，該行整行移除（避免留下空的「➕ 加購：」）
 */
function renderTemplate(tpl, vars) {
  let text = tpl;

  // 先處理「加購」這種可能為空、要整行移除的變數
  const lineRemoveIfEmpty = ["加購", "備註", "提醒", "信箱"];
  text = text.split("\n").filter(line => {
    for (const key of lineRemoveIfEmpty) {
      if (line.indexOf("{" + key + "}") !== -1) {
        // 該行含這個變數，若值為空則移除整行
        if (!vars[key]) return false;
      }
    }
    return true;
  }).join("\n");

  // 代入所有變數
  Object.keys(vars).forEach(function(key) {
    var val = vars[key] == null ? "" : String(vars[key]);
    text = text.split("{" + key + "}").join(val);
  });

  return text;
}

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

  // 開始 / 結束時間（相容 startTime/endTime 與 start/end 兩種格式）
  const startTime = bk.startTime || bk.start || "";
  const endTime = bk.endTime || bk.end || "";

  // 時長（分鐘）：先取明確欄位，取不到再用起訖時間相減
  let length = bk.length || bk.lengthInMinutes || bk.duration
    || bk.eventType?.length || bk.eventType?.lengthInMinutes || 0;
  if (!length && startTime && endTime) {
    length = Math.round((new Date(endTime) - new Date(startTime)) / 60000);
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

  // 加購資訊（建立預約時寫進 metadata）
  let addons = "";
  if (bk.metadata && bk.metadata.addons) addons = bk.metadata.addons;

  // 備註（建立預約時寫進 metadata）
  let note = "";
  if (bk.metadata && bk.metadata.note) note = bk.metadata.note;

  // 客人 email：只取建立預約時存的 customerEmail（客人真正填的）
  // fallback 店家信箱不會存進這裡，所以不會誤顯示
  let email = "";
  if (bk.metadata && bk.metadata.customerEmail) email = bk.metadata.customerEmail;

  return { title, startTime, length, name, lineUserId, phone, addons, note, email };
}

module.exports = { pushLine, toTaiwanTime, extractBooking, loadTemplates, renderTemplate };