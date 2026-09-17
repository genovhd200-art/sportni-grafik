#!/usr/bin/env node
/**
 * Тенис — търси мачове с българско участие, като отваря страниците с истински
 * браузър (Playwright) вътре в GitHub Actions. Безплатно за публични хранилища.
 *
 * Защо браузър: тенис сайтовете връщат празен шаблон и дърпат данните с
 * JavaScript след това. Обикновено сваляне на HTML не вижда нищо.
 *
 * Две мрежи за хващане, работят едновременно:
 *   1) МРЕЖОВА — прихваща JSON-ите, които самата страница си зарежда.
 *      Не зависи от дизайна; чупи се само ако им се смени бекендът.
 *   2) ТЕКСТОВА — чете видимия текст и търси имената.
 *      Резервен вариант, ако JSON-ите са неразпознаваеми.
 *
 * Ако не намери нищо, записва диагностика в tennis-debug/ — снимка на екрана,
 * видимия текст и уловените JSON-и. Прати ги и се оправя.
 *
 * Резултатът се записва в config/tennis-events.json и се долепя автоматично
 * при следващото теглене на програмата.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { ROOT } from "./lib.mjs";
const CFG = JSON.parse(await fs.readFile(path.join(ROOT, "config", "tennis.json"), "utf8"));
/* TENNIS_OUT: дневното попълване иска находките в отделен файл, за да минат
   през проверка, вместо направо в програмата. Тогава enabled не се гледа. */
const REVIEW = !!process.env.TENNIS_OUT;
const OUT = REVIEW ? path.resolve(process.env.TENNIS_OUT) : path.join(ROOT, "config", "tennis-events.json");
const DEBUG_DIR = path.join(ROOT, "tennis-debug");
const TZ = "Europe/Sofia";

if (!CFG.enabled && !REVIEW) { console.log("Тенисът е изключен в config/tennis.json."); process.exit(0); }

const { chromium } = await import("playwright").catch(() => {
  console.error("Playwright липсва. В работния процес се инсталира автоматично.");
  process.exit(1);
});

const PLAYERS = CFG.players || [];
const SURNAMES = PLAYERS.map(p => p.sur.toLowerCase());
const bgName = sur => (PLAYERS.find(p => p.sur.toLowerCase() === sur) || {}).bg;
const weightOf = sur => (PLAYERS.find(p => p.sur.toLowerCase() === sur) || {}).w || 2;

const todayISO = () => new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
const hit = txt => SURNAMES.filter(s => txt.toLowerCase().includes(s));

/* ---------- обхождане ---------- */
const captured = [];      // уловените JSON-и
const pages = [];         // видимият текст на всяка страница

async function visit(browser, src) {
  const page = await browser.newPage({
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    locale: "en-US",
  });
  page.on("response", async res => {
    try {
      const ct = res.headers()["content-type"] || "";
      if (!ct.includes("json")) return;
      const body = await res.text();
      if (body.length < 40 || body.length > 3_000_000) return;
      if (hit(body).length) captured.push({ url: res.url(), body });
    } catch {}
  });
  try {
    console.log("  → " + src.url);
    await page.goto(src.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(src.waitMs || 6000);
    if (src.waitFor) await page.waitForSelector(src.waitFor, { timeout: 15000 }).catch(() => {});
    const text = (await page.innerText("body")).replace(/\s+/g, " ");
    pages.push({ name: src.name, url: src.url, text });
    const found = hit(text);
    console.log(`    текст ${text.length} знака, съвпадения: ${found.join(", ") || "няма"}`);
    if (!found.length) {
      await fs.mkdir(DEBUG_DIR, { recursive: true });
      await page.screenshot({ path: path.join(DEBUG_DIR, src.name + ".png"), fullPage: false });
    }
  } catch (e) {
    console.warn("    ! " + e.message.split("\n")[0]);
  } finally { await page.close(); }
}

/* ---------- изваждане от видимия текст ---------- */
/* Търси ред от вида "… Фамилия … 14:30 …" около името. */
function fromText() {
  const out = [];
  for (const p of pages) {
    for (const sur of hit(p.text)) {
      const re = new RegExp("(.{0,120})" + sur + "(.{0,120})", "gi");
      let m;
      while ((m = re.exec(p.text))) {
        const ctx = (m[1] + sur + m[2]);
        const time = (ctx.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/) || [])[0];
        const vs = ctx.match(/([A-Z][\w.'-]+(?:\s[A-Z][\w.'-]+)?)\s*(?:vs\.?|-|–|v\.)\s*([A-Z][\w.'-]+(?:\s[A-Z][\w.'-]+)?)/);
        out.push({
          sur, time: time || null,
          title: vs ? `${vs[1]} – ${vs[2]}` : null,
          context: ctx.trim().slice(0, 180), source: p.name,
        });
        if (out.length > 200) break;
      }
    }
  }
  return out;
}

/* ---------- изваждане от уловените JSON-и ---------- */
function walk(node, cb, depth = 0) {
  if (!node || depth > 8) return;
  if (Array.isArray(node)) return node.forEach(n => walk(n, cb, depth + 1));
  if (typeof node === "object") { cb(node); Object.values(node).forEach(v => walk(v, cb, depth + 1)); }
}
function fromJson() {
  const out = [];
  for (const c of captured) {
    let data; try { data = JSON.parse(c.body); } catch { continue; }
    walk(data, obj => {
      const flat = JSON.stringify(obj);
      if (flat.length > 4000) return;
      const found = hit(flat);
      if (!found.length) return;
      const date = obj.date || obj.startDate || obj.matchDate || obj.scheduledDate ||
                   obj.startTime || obj.startTimestamp;
      const name = obj.tournamentName || obj.tournament?.name || obj.eventName ||
                   obj.event?.name || obj.competition || null;
      out.push({ sur: found[0], rawDate: date ?? null, tournament: name, obj, url: c.url });
    });
  }
  return out;
}

/* ---------- главно ---------- */
const sources = (CFG.sources || []).filter(s => s.enabled !== false);
if (!sources.length) {
  console.error("Няма зададени източници в config/tennis.json → sources[].");
  process.exit(0);
}

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
console.log(`Тенис: обхождам ${sources.length} страници, следя ${PLAYERS.length} състезатели.`);
for (const s of sources) await visit(browser, s);
await browser.close();

const jsonHits = fromJson();
const textHits = fromText();
console.log(`\nУловени JSON-и с българско име: ${captured.length}`);
console.log(`Съвпадения от JSON: ${jsonHits.length} · от текст: ${textHits.length}`);

/* Превръщане в събития. Датата е днешната, освен ако JSON-ът не дава друга —
   форматите са различни при всеки сайт, затова е нарочно консервативно. */
const today = todayISO();
const seen = new Set(), events = [];
for (const h of [...jsonHits, ...textHits]) {
  const bg = bgName(h.sur) || h.sur;
  let date = today, time = h.time || "00:00";
  if (h.rawDate) {
    const d = new Date(typeof h.rawDate === "number" ? h.rawDate * 1000 : h.rawDate);
    if (!isNaN(d)) {
      const s = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit",
        day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
      [date, time] = s.split(" ");
    }
  }
  const title = h.title || `${bg} — мач`;
  const key = date + time + title;
  if (seen.has(key)) continue;
  seen.add(key);
  events.push({
    extId: "ten-" + Buffer.from(key).toString("base64url").slice(0, 20),
    date, time, sport: "ten",
    comp: h.tournament || "Тенис",
    title, p: weightOf(h.sur),
    note: (h.context || "").slice(0, 90),
    provisional: !h.time && !h.rawDate,
  });
}

/* Диагностиката се пише ВИНАГИ — по нея се дооправя четенето на полетата. */
await fs.mkdir(DEBUG_DIR, { recursive: true });
await fs.writeFile(path.join(DEBUG_DIR, "pages.txt"),
  pages.map(p => `### ${p.name} — ${p.url}\n${p.text.slice(0, 20000)}`).join("\n\n"), "utf8");
await fs.writeFile(path.join(DEBUG_DIR, "captured.json"),
  JSON.stringify(captured.map(c => ({ url: c.url, body: c.body.slice(0, 30000) })), null, 1), "utf8");

if (!events.length) {
  console.log("\nНищо не се хвана. Диагностиката е в tennis-debug/.");
  console.log("Старият tennis-events.json остава непокътнат.");
  process.exit(0);
}

await fs.writeFile(OUT, JSON.stringify(events, null, 1), "utf8");
console.log(`\n✓ Записани ${events.length} тенис събития в ${path.relative(ROOT, OUT)}`);
events.slice(0, 10).forEach(e => console.log(`   ${e.date} ${e.time}  ${e.comp} · ${e.title}`));
