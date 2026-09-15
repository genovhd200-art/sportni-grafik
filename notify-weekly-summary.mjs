#!/usr/bin/env node
/**
 * Кратко резюме от неделната проверка до РЕДАКТОРСКИЯ Telegram чат.
 *
 * Чете docs/data/weekly-check.json (оставен от scripts/weekly-check.mjs)
 * и праща едно съобщение: колко нови събития са влезли, колко часа са се
 * променили, колко са отпаднали.
 *
 * Къде отива:
 *   1) secret EDITOR_CHAT_ID, ако е зададен
 *   2) иначе editorChatId от config/people.json
 *
 * Проба, без да се праща нищо:
 *   DRY_RUN=1 node scripts/notify-weekly-summary.mjs
 */
import { readJSON } from "./lib.mjs";

const TOKEN = process.env.TELEGRAM_TOKEN;
const DRY = process.env.DRY_RUN === "1";

const ppl = (await readJSON("config/people.json", {})) || {};
const CHAT = process.env.EDITOR_CHAT_ID || ppl.editorChatId || "";

const rep = await readJSON("docs/data/weekly-check.json", null);
if (!rep) {
  console.log("Няма docs/data/weekly-check.json — проверката не е минала. Нищо за пращане.");
  process.exit(0);
}

const t = rep.totals || {};
const esc = s => String(s).replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
const дума = (n, one, few) => `${n} ${n === 1 ? one : few}`;

const lines = [];
lines.push(`🗓 <b>Проверка на програмата за ${rep.window.from} – ${rep.window.to}</b>`);
lines.push("");
lines.push(`➕ Нови: <b>${t.added ?? 0}</b>`);
lines.push(`🕒 Променен час или дата: <b>${t.moved ?? 0}</b>`);
lines.push(`➖ Отпаднали: <b>${t.dropped ?? 0}</b>`);
lines.push(`✍️ Ръчни, непипнати: ${t.manualUntouched ?? 0}`);

const failed = (rep.sources || []).filter(s => !s.ok);
if (failed.length) {
  lines.push("");
  lines.push("⚠️ <b>Източници без отговор:</b>");
  for (const s of failed) lines.push(`   · ${esc(s.name)} — ${esc(s.error || "неизвестна грешка")}`);
}

/* По три примера от най-важните две категории — да се види за какво става дума. */
if ((rep.moved || []).length) {
  lines.push("");
  lines.push("<b>Преместени:</b>");
  for (const m of rep.moved.slice(0, 5))
    lines.push(`   · ${esc(m.title)} — ${m.was.date} ${m.was.time} → <b>${m.now.date} ${m.now.time}</b>`);
  if (rep.moved.length > 5) lines.push(`   · … и още ${rep.moved.length - 5}`);
}
if ((rep.added || []).length) {
  lines.push("");
  lines.push("<b>Нови:</b>");
  for (const e of rep.added.slice(0, 5))
    lines.push(`   · ${e.date} ${e.time} — ${esc(e.title)} <i>(${esc(e.comp)})</i>`);
  if (rep.added.length > 5) lines.push(`   · … и още ${rep.added.length - 5}`);
}

lines.push("");
lines.push(`Пълният отчет: <code>reports/${rep.runDate}.md</code>`);

const text = lines.join("\n");

if (DRY) {
  console.log("--- DRY RUN, до " + (CHAT || "(няма chat id)") + " ---\n");
  console.log(text.replace(/<[^>]+>/g, ""));
  process.exit(0);
}
if (!TOKEN) { console.error("Липсва TELEGRAM_TOKEN."); process.exit(1); }
if (!CHAT) {
  console.log("Няма редакторски chat id (EDITOR_CHAT_ID или editorChatId в config/people.json).");
  console.log("Резюмето не е изпратено — това не е грешка, само настройката липсва.");
  process.exit(0);
}

const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ chat_id: CHAT, text, parse_mode: "HTML", disable_web_page_preview: true }),
});
const j = await r.json();
if (!j.ok) {
  console.error(`Telegram отказа: ${j.description}`);
  if (/chat not found|blocked/i.test(j.description || ""))
    console.error("→ Редакторът трябва да е писал поне веднъж на бота (или ботът да е добавен в групата).");
  process.exit(1);
}
console.log(`Резюмето е изпратено до ${CHAT}.`);
console.log(`Нови ${t.added} · преместени ${t.moved} · отпаднали ${t.dropped}`);
