#!/usr/bin/env node
/**
 * Кратко съобщение до РЕДАКТОРСКИЯ Telegram чат след нощното попълване.
 *
 * Чете docs/data/fill-report.json и праща само ако има за какво:
 * добавени събития, нов тенис за проверка или паднал източник.
 * Накрая — линкове към Sofascore по дни, за ръчна сверка.
 *
 * Къде отива: secret EDITOR_CHAT_ID, иначе editorChatId от config/people.json.
 *
 * Проба, без да се праща нищо:
 *   DRY_RUN=1 node scripts/notify-fill-summary.mjs
 */
import { readJSON } from "./lib.mjs";

const TOKEN = process.env.TELEGRAM_TOKEN;
const DRY = process.env.DRY_RUN === "1";

const ppl = (await readJSON("config/people.json", {})) || {};
const CHAT = process.env.EDITOR_CHAT_ID || ppl.editorChatId || "";

const rep = await readJSON("docs/data/fill-report.json", null);
if (!rep) { console.log("Няма docs/data/fill-report.json. Нищо за пращане."); process.exit(0); }

const t = rep.totals || {};
const failed = (rep.sources || []).filter(s => !s.ok);
if (!t.added && !t.tennisNew && !failed.length && !DRY) {
  console.log("Нищо ново и всички източници са отговорили — не безпокоя редактора.");
  process.exit(0);
}

const esc = s => String(s).replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
const DAY = ["нд", "пн", "вт", "ср", "чт", "пт", "сб"];
const bg = d => `${DAY[new Date(d + "T12:00:00Z").getUTCDay()]} ${d.slice(8)}.${d.slice(5, 7)}`;
const ICON = { football: "⚽", basketball: "🏀", volleyball: "🏐", tennis: "🎾", motorsport: "🏎" };

const L = [];
L.push(`🌙 <b>Нощно попълване · ${bg(rep.window.from)} – ${bg(rep.window.to)}</b>`);
L.push("");
L.push(`➕ Добавени липсващи: <b>${t.added ?? 0}</b>`);
if (t.tennisNew || t.tennisPending)
  L.push(`🎾 Тенис за проверка: <b>${t.tennisNew ?? 0}</b> нови · ${t.tennisPending ?? 0} чакат общо`);

if ((rep.added || []).length) {
  L.push("");
  for (const e of rep.added.slice(0, 12))
    L.push(`   · ${bg(e.date)} ${e.time} — ${esc(e.title)} <i>(${esc(e.comp)})</i>`);
  if (rep.added.length > 12) L.push(`   · … и още ${rep.added.length - 12}`);
}

if ((rep.tennisNew || []).length) {
  L.push("");
  L.push("<b>Тенис — провери и одобри в config/tennis-candidates.json:</b>");
  for (const e of rep.tennisNew.slice(0, 8))
    L.push(`   · ${bg(e.date)} ${e.time} — ${esc(e.title)} <i>(${esc(e.comp)})</i>`);
}

if (failed.length) {
  L.push("");
  L.push("⚠️ <b>Източници без отговор:</b>");
  for (const s of failed) L.push(`   · ${esc(s.name)} — ${esc(s.error || "неизвестна грешка")}`);
}

if ((rep.sofascore || []).length) {
  L.push("");
  L.push("🔎 <b>Ръчна сверка в Sofascore:</b>");
  for (const d of rep.sofascore)
    L.push(`   ${bg(d.date)}: ` + d.links.map(l => `<a href="${esc(l.url)}">${ICON[l.sport] || l.sport}</a>`).join(" "));
}

const text = L.join("\n");

if (DRY) {
  console.log("--- DRY RUN, до " + (CHAT || "(няма chat id)") + " ---\n");
  console.log(text.replace(/<[^>]+>/g, ""));
  process.exit(0);
}
if (!TOKEN) { console.error("Липсва TELEGRAM_TOKEN."); process.exit(1); }
if (!CHAT) {
  console.log("Няма редакторски chat id (EDITOR_CHAT_ID или editorChatId в config/people.json). Не е изпратено.");
  process.exit(0);
}

const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ chat_id: CHAT, text, parse_mode: "HTML", disable_web_page_preview: true }),
});
const j = await r.json();
if (!j.ok) { console.error(`Telegram отказа: ${j.description}`); process.exit(1); }
console.log(`Изпратено до ${CHAT}: добавени ${t.added}, тенис ${t.tennisNew}.`);
