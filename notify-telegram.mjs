#!/usr/bin/env node
/**
 * Праща на всеки автор какво го чака в смяната — по Telegram.
 *
 * Чете:
 *   docs/data/events.json    програмата (пълни се автоматично)
 *   config/assignments.json  разпределението (сваля се от дъската с бутона
 *                            „Публикувай разпределението“ и се качва тук)
 *   config/people.json       кой автор на кой chat id отговаря
 *
 * Два режима, задават се в people.json → mode:
 *   "before-shift"  половин час преди всяка смяна (по подразбиране)
 *   "morning"       едно съобщение сутрин с целия ден
 *   "both"          и двете
 *
 * За да не праща по два пъти, пази изпратеното в config/notify-state.json.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { ROOT } from "./lib.mjs";
const TZ = "Europe/Sofia";
const TOKEN = process.env.TELEGRAM_TOKEN;
const DRY = process.env.DRY_RUN === "1";

if (!TOKEN && !DRY) { console.error("Липсва TELEGRAM_TOKEN."); process.exit(1); }

const read = async (p, fb) => {
  try { return JSON.parse(await fs.readFile(path.join(ROOT, p), "utf8")); }
  catch { return fb; }
};

const feed = await read("docs/data/events.json", { events: [] });
const asg = await read("config/assignments.json", { authors: {}, assign: {}, custom: {} });
const ppl = await read("config/people.json", { mode: "before-shift", leadMinutes: 30, people: [] });
const state = await read("config/notify-state.json", {});

const PEOPLE = (ppl.people || []).filter(p => p.enabled !== false && p.chatId);
if (!PEOPLE.length) {
  console.log("Няма настроени хора в config/people.json — нищо за пращане.");
  process.exit(0);
}

/* ---------- време ---------- */
const now = new Date();
const fmt = (d, o) => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, ...o }).format(d);
const today = fmt(now, { year: "numeric", month: "2-digit", day: "2-digit" });
const nowMin = (() => {
  const [h, m] = fmt(now, { hour: "2-digit", minute: "2-digit", hour12: false }).split(":");
  return (+h) * 60 + (+m);
})();
const mins = t => { const p = String(t || "0:0").split(":"); return (+p[0]) * 60 + (+p[1] || 0); };
const pad = n => String(n).padStart(2, "0");
const hhmm = m => pad(Math.floor((m % 1440) / 60)) + ":" + pad(m % 60);

const DURATION = { fut: 115, vol: 110, bas: 110, ten: 150, mot: 120, oth: 90 };
const durationOf = e => (/тренировка|квалификац|спринт/i.test(e.title) ? 70 : (DURATION[e.sport] || 90));
const endMins = e => mins(e.time) + durationOf(e);

/* ---------- събития + разпределение ---------- */
const EV = {};
for (const e of feed.events || []) EV[e.extId] = e;
for (const c of Object.values(asg.custom || {})) EV[c.id] = c;

function eventsFor(authorId, date) {
  return Object.entries(asg.assign || {})
    .filter(([, v]) => v.authorId === authorId)
    .map(([id]) => EV[id]).filter(e => e && e.date === date)
    .sort((a, b) => mins(a.time) - mins(b.time));
}

const esc = s => String(s).replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));

function listLines(list) {
  return list.map(e => {
    const lead = e.p === 3 ? "🔴 " : "";
    const star = e.p === 3 ? " <b>(водещо)</b>" : "";
    return `${lead}<b>${e.time}</b>  ${esc(e.title)}${star}\n     <i>${esc(e.comp)}</i> · край ~${hhmm(endMins(e))}`;
  }).join("\n");
}

async function send(chatId, text) {
  if (DRY) { console.log(`\n--- до ${chatId} ---\n${text.replace(/<[^>]+>/g, "")}`); return true; }
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML",
                           disable_web_page_preview: true }),
  });
  const j = await r.json();
  if (!j.ok) {
    console.warn(`  ! ${chatId}: ${j.description}`);
    if (/chat not found|blocked/i.test(j.description || ""))
      console.warn("    → човекът трябва да напише поне веднъж на бота.");
    return false;
  }
  return true;
}

/* ---------- главно ---------- */
const mode = ppl.mode || "before-shift";
const lead = ppl.leadMinutes ?? 30;
const window = ppl.windowMinutes ?? 45;   // толерантност към закъснения на Actions
let sent = 0;

console.log(`Сега е ${hhmm(nowMin)} на ${today}. Режим: ${mode}.`);

for (const person of PEOPLE) {
  const author = Object.values(asg.authors || {})
    .find(a => a.name && a.name.trim().toLowerCase() === String(person.name).trim().toLowerCase());
  if (!author) { console.log(`  · ${person.name}: няма такъв автор в разпределението`); continue; }

  const todays = eventsFor(author.id, today);
  const shifts = (author.shifts || {})[today] || [];

  /* сутрешен обзор */
  if (mode === "morning" || mode === "both") {
    const key = `morning:${today}:${person.chatId}`;
    const hour = ppl.morningHour ?? 8;
    if (!state[key] && nowMin >= hour * 60 && nowMin < hour * 60 + window) {
      const head = shifts.length
        ? `Смяната ти днес: <b>${shifts.map(s => s.s + "–" + s.e).join(", ")}</b>`
        : "Днес нямаш смяна в графика.";
      const body = todays.length
        ? `\n\nИмаш <b>${todays.length}</b> ${todays.length === 1 ? "събитие" : "събития"}:\n\n${listLines(todays)}`
        : "\n\nНяма разпределени събития.";
      if (await send(person.chatId, `☀️ <b>Добро утро!</b>\n${head}${body}`)) {
        state[key] = true; sent++;
      }
    }
  }

  /* половин час преди смяната */
  if (mode === "before-shift" || mode === "both") {
    for (const sh of shifts) {
      const start = mins(sh.s);
      const fire = start - lead;
      const key = `shift:${today}:${person.chatId}:${sh.s}`;
      if (state[key]) continue;
      if (nowMin < fire || nowMin >= fire + window) continue;

      const inShift = todays.filter(e => {
        const en = endMins(e), st = mins(e.time), a = mins(sh.s);
        let b = mins(sh.e); if (b <= a) b += 1440;
        return (en >= a && en <= b) || (st >= a && st <= b);
      });
      const body = inShift.length
        ? `Имаш <b>${inShift.length}</b> ${inShift.length === 1 ? "събитие" : "събития"}:\n\n${listLines(inShift)}`
        : "Нямаш разпределени събития за тази смяна.";
      const lead3 = inShift.filter(e => e.p === 3).length;
      const tail = lead3 ? `\n\n⚠️ ${lead3} от тях ${lead3 === 1 ? "е водещо" : "са водещи"}.` : "";
      if (await send(person.chatId,
          `⏰ <b>Смяната ти започва в ${sh.s}</b>\n\n${body}${tail}`)) {
        state[key] = true; sent++;
      }
    }
  }
}

/* чистене на стари ключове, за да не расте файлът */
for (const k of Object.keys(state)) {
  const d = k.split(":")[1];
  if (d && d < today) delete state[k];
}

if (!DRY) await fs.writeFile(path.join(ROOT, "config", "notify-state.json"),
  JSON.stringify(state, null, 1), "utf8");
console.log(`\nИзпратени съобщения: ${sent}`);
