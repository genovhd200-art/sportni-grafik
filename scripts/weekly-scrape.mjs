#!/usr/bin/env node
/**
 * Седмично изтегляне на турнирите, които никой безплатен API не покрива —
 * Първа лига, Лига Европа, Лигата на конференциите, Купа на България.
 *
 * Отваря страниците с истински браузър в GitHub Actions и вади от видимия
 * текст редове от вида:
 *      20:30  Лудогорец - Левски
 * като помни последната срещната дата над тях.
 *
 * Насочен е към сайтове, които НЕ блокират адресите на GitHub: официални
 * сайтове на лиги, български медии, Уикипедия. Големите агрегатори
 * (Sofascore, Flashscore, ATP) отговарят с „you have been blocked“ и затова
 * ги няма тук.
 *
 * Резултатът отива в config/weekly-events.json и се долепя при всяко теглене.
 * При всяко пускане се записва диагностика в weekly-debug/.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { ROOT } from "./lib.mjs";
const CFG = JSON.parse(await fs.readFile(path.join(ROOT, "config", "weekly-sources.json"), "utf8"));
const OUT = path.join(ROOT, "config", "weekly-events.json");
const DEBUG = path.join(ROOT, "weekly-debug");
const TZ = "Europe/Sofia";

if (!CFG.enabled) { console.log("Седмичното изтегляне е изключено."); process.exit(0); }

const { chromium } = await import("playwright").catch(() => {
  console.error("Playwright липсва."); process.exit(1);
});

const pad = n => String(n).padStart(2, "0");
const nowSofia = () => new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));

/* ---------- месеци на български и латиница ---------- */
const MONTHS = {
  "януари":1,"февруари":2,"март":3,"април":4,"май":5,"юни":6,"юли":7,
  "август":8,"септември":9,"октомври":10,"ноември":11,"декември":12,
  "january":1,"february":2,"march":3,"april":4,"may":5,"june":6,"july":7,
  "august":8,"september":9,"october":10,"november":11,"december":12,
};

/** Търси дата в парче текст. Разпознава 20.09, 20.09.2026, „20 септември“. */
function findDate(chunk, defYear) {
  let m = chunk.match(/\b(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{4}|\d{2}))?\b/);
  if (m) {
    const d = +m[1], mo = +m[2];
    let y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : defYear;
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) return `${y}-${pad(mo)}-${pad(d)}`;
  }
  m = chunk.match(new RegExp("\\b(\\d{1,2})\\s+(" + Object.keys(MONTHS).join("|") + ")\\b", "i"));
  if (m) {
    const d = +m[1], mo = MONTHS[m[2].toLowerCase()];
    if (d >= 1 && d <= 31 && mo) return `${defYear}-${pad(mo)}-${pad(d)}`;
  }
  return null;
}

/* ---------- обхождане ---------- */
async function scrape(browser, src, defYear) {
  const page = await browser.newPage({
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    locale: "bg-BG",
  });
  const found = [];
  let text = "";
  try {
    console.log(`  → ${src.name}: ${src.url}`);
    await page.goto(src.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(src.waitMs || 6000);
    text = await page.innerText("body");

    if (/you have been blocked|access denied|attention required/i.test(text)) {
      console.warn("    ! страницата ни блокира — пропускам");
      await fs.mkdir(DEBUG, { recursive: true });
      await page.screenshot({ path: path.join(DEBUG, src.name + "-blocked.png") });
      return { events: [], text, blocked: true };
    }

    /* Ред по ред: пази последната видяна дата, лови „HH:MM  A - B“. */
    const lines = text.split("\n").map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    let curDate = null;
    const pair = /^(?:.*?\s)?([01]?\d|2[0-3]):([0-5]\d)\s+(.{2,45}?)\s*(?:-|–|—|vs\.?|срещу)\s*(.{2,45})$/i;

    for (const line of lines) {
      const d = findDate(line, defYear);
      if (d && line.length < 60) { curDate = d; continue; }
      const m = line.match(pair);
      if (!m) continue;
      const home = m[3].trim(), away = m[4].trim();
      if (!home || !away) continue;
      if (/^\d+$/.test(home) || /^\d+$/.test(away)) continue;   // резултати, не отбори
      found.push({
        date: curDate || d,
        time: `${pad(+m[1])}:${m[2]}`,
        title: `${home} – ${away}`,
      });
    }
    console.log(`    текст ${text.length} знака · намерени ${found.length} двойки`);
  } catch (e) {
    console.warn("    ! " + e.message.split("\n")[0]);
  } finally { await page.close(); }
  return { events: found, text, blocked: false };
}

/* ---------- главно ---------- */
const today = nowSofia();
const defYear = today.getFullYear();
const from = `${defYear}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
const horizon = new Date(today.getTime() + (CFG.daysAhead || 31) * 864e5);
const to = `${horizon.getFullYear()}-${pad(horizon.getMonth() + 1)}-${pad(horizon.getDate())}`;

const sources = (CFG.sources || []).filter(s => s.enabled !== false);
console.log(`Седмично изтегляне ${from} → ${to} · ${sources.length} източника`);

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const all = [], dumps = [];
for (const src of sources) {
  const r = await scrape(browser, src, defYear);
  dumps.push({ name: src.name, url: src.url, blocked: r.blocked, text: r.text.slice(0, 15000) });
  for (const e of r.events) {
    if (!e.date || e.date < from || e.date > to) continue;
    all.push({
      source: "weekly-scrape",
      extId: "wk-" + Buffer.from(src.name + e.date + e.time + e.title).toString("base64url").slice(0, 22),
      date: e.date, time: e.time, sport: src.sport || "fut",
      comp: src.comp, title: e.title,
      p: src.weight || 2, venue: "", round: "", provisional: false,
    });
  }
}
await browser.close();

/* Отборите от списъка стават водещи. */
const WATCH = (CFG.teamsOfInterest || []).map(s => s.toLowerCase());
for (const e of all)
  if (WATCH.some(w => e.title.toLowerCase().includes(w))) e.p = 3;

/* Махане на повторения. */
const seen = new Set(), events = [];
for (const e of all) {
  const k = e.date + e.time + e.title.toLowerCase();
  if (seen.has(k)) continue;
  seen.add(k); events.push(e);
}
events.sort((a, b) => a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date));

await fs.mkdir(DEBUG, { recursive: true });
await fs.writeFile(path.join(DEBUG, "pages.txt"),
  dumps.map(d => `### ${d.name}${d.blocked ? " [БЛОКИРАН]" : ""} — ${d.url}\n${d.text}`).join("\n\n"), "utf8");

if (!events.length) {
  console.log("\nНищо не се хвана. Виж weekly-debug/pages.txt — качва се като файл в Actions.");
  console.log("Старият weekly-events.json остава непокътнат.");
  process.exit(0);
}

await fs.writeFile(OUT, JSON.stringify(events, null, 1), "utf8");
console.log(`\n✓ Записани ${events.length} събития в config/weekly-events.json`);
const byComp = {};
events.forEach(e => byComp[e.comp] = (byComp[e.comp] || 0) + 1);
Object.entries(byComp).forEach(([c, n]) => console.log(`   ${c}: ${n}`));
events.slice(0, 8).forEach(e => console.log(`   ${e.date} ${e.time}  ${e.title}`));
