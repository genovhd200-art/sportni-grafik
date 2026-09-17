#!/usr/bin/env node
/**
 * Тегли програмата за N дни напред и я записва в docs/data/events.json.
 *
 * Работи с два източника, избира се автоматично според наличния ключ:
 *   API_FOOTBALL_KEY  -> v3.football.api-sports.io  (повече турнири, вкл. Първа лига)
 *   FOOTBALL_DATA_KEY -> api.football-data.org/v4   (безплатен, само големите първенства)
 *
 * Часовете се преобразуват в българско време. Мачовете, чийто час още не е
 * потвърден от лигата, се маркират с provisional:true.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { volleyball, basketball } from "./other-sports.mjs";
import { fromSportsDB } from "./sportsdb.mjs";
import { fromFootballData } from "./football-data.mjs";
import { ROOT, TZ, toSofia, sleep, pad } from "./lib.mjs";

const OUT = path.join(ROOT, "docs", "data", "events.json");

const AF_KEY = process.env.API_FOOTBALL_KEY || "";
const FD_KEY = process.env.FOOTBALL_DATA_KEY || "";

const cfg = JSON.parse(await fs.readFile(path.join(ROOT, "config", "leagues.json"), "utf8"));
const LEAGUES = cfg.leagues.filter(l => l.enabled);
const DAYS = Number(process.env.DAYS_AHEAD) || cfg.daysAhead || 31;
const WATCH = (cfg._teamsOfInterest?.names || []).map(s => s.toLowerCase());

/* ---------- помощни ---------- */
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

async function getJSON(url, headers, label) {
  const r = await fetch(url, { headers });
  if (r.status === 429) throw new Error(`${label}: изчерпан лимит на заявките (429)`);
  if (!r.ok) throw new Error(`${label}: HTTP ${r.status} ${r.statusText}`);
  const j = await r.json();
  // API-Football връща 200 с обяснение в errors, когато планът не стига
  if (j.errors && !Array.isArray(j.errors) && Object.keys(j.errors).length)
    console.warn(`  ! ${label}: ${JSON.stringify(j.errors)}`);
  return j;
}

function weightFor(league, home, away) {
  const h = (home || "").toLowerCase(), a = (away || "").toLowerCase();
  if (WATCH.some(w => h.includes(w) || a.includes(w))) return 3;
  return league.weight || 1;
}

/* ---------- източник: API-Football ---------- */
async function fromApiFootball(from, to) {
  const H = { "x-apisports-key": AF_KEY };
  const B = "https://v3.football.api-sports.io";
  const out = [];

  for (const lg of LEAGUES) {
    let id = lg.afId;
    if (!id) {
      const q = new URLSearchParams({ search: lg.search });
      if (lg.country && lg.country !== "World") q.set("country", lg.country);
      const res = await getJSON(`${B}/leagues?${q}`, H, `търсене «${lg.search}»`);
      const hit = (res.response || []).find(x =>
        x.seasons?.some(s => s.current)) || (res.response || [])[0];
      if (!hit) { console.warn(`  ! ${lg.name}: не е намерен в API-Football, пропускам`); continue; }
      id = hit.league.id;
      console.log(`  · ${lg.name} -> id ${id} (${hit.league.name})`);
    }
    const season = new Date(from).getUTCMonth() >= 6
      ? new Date(from).getUTCFullYear() : new Date(from).getUTCFullYear() - 1;
    const q = new URLSearchParams({ league: id, season, from, to, timezone: TZ });
    const res = await getJSON(`${B}/fixtures?${q}`, H, lg.name);
    for (const f of res.response || []) {
      const t = toSofia(f.fixture.date);
      if (!t) continue;
      const home = f.teams.home.name, away = f.teams.away.name;
      out.push({
        source: "api-football",
        extId: `af-${f.fixture.id}`,
        date: t.date, time: t.time, sport: lg.sport,
        comp: lg.name, title: `${home} – ${away}`,
        p: weightFor(lg, home, away),
        venue: f.fixture.venue?.name || "",
        round: f.league?.round || "",
        provisional: f.fixture.status?.short === "TBD",
      });
    }
    console.log(`  ✓ ${lg.name}: ${(res.response || []).length} мача`);
    await sleep(250);
  }
  return out;
}

/* ---------- ръчни събития ---------- */
/** Всичко в config/manual-events.json се долепя към изтеглените (волейбол,
 *  тенис, моторни спортове и каквото друго редакцията добави на ръка). */
async function manualEvents() {
  try {
    const raw = await fs.readFile(path.join(ROOT, "config", "manual-events.json"), "utf8");
    const arr = JSON.parse(raw);
    console.log(`  ✓ ръчни събития: ${arr.length}`);
    return arr.map((e, i) => ({ ...e, source: "manual", extId: e.extId || `man-${i}-${e.date}-${e.time}` }));
  } catch { return []; }
}

/** Каквото е хванал седмичният скрейпър — Първа лига, евротурнири, F1. */
async function weeklyEvents() {
  try {
    const arr = JSON.parse(await fs.readFile(path.join(ROOT, "config", "weekly-events.json"), "utf8"));
    console.log(`  ✓ седмично изтеглени: ${arr.length} събития`);
    return arr;
  } catch { return []; }
}

/** Тенисът, уловен от scripts/tennis-scrape.mjs при предишната стъпка. */
async function tennisEvents() {
  try {
    const arr = JSON.parse(await fs.readFile(path.join(ROOT, "config", "tennis-events.json"), "utf8"));
    console.log(`  ✓ тенис: ${arr.length} събития`);
    return arr.map(e => ({ ...e, source: "tennis-scrape" }));
  } catch { return []; }
}

/* ---------- главно ---------- */
const today = process.env.FROM_DATE ? new Date(process.env.FROM_DATE + "T12:00:00Z") : new Date();
const from = iso(today);
const to = iso(new Date(today.getTime() + DAYS * 864e5));

console.log(`Програма ${from} → ${to} (${DAYS} дни)`);

let events = [];
try {
  // football-data.org дава пълната програма за сезона безплатно, затова е пръв.
  // API-Football остава резервен (и се ползва за другите спортове по-долу).
  if (FD_KEY) {
    console.log("Футбол от: football-data.org");
    events = await fromFootballData(LEAGUES, from, to, FD_KEY, cfg._teamsOfInterest?.names || []);
  }
  else if (AF_KEY) { console.log("Футбол от: API-Football"); events = await fromApiFootball(from, to); }
  else {
    console.error("Няма ключ. Задай FOOTBALL_DATA_KEY или API_FOOTBALL_KEY.");
    process.exit(1);
  }
} catch (e) {
  console.error("Тегленето се провали:", e.message);
  console.error("Запазвам предишния events.json, за да не остане страницата празна.");
  process.exit(1);
}

/* другите спортове — същият ключ, различни поддомейни */
if (AF_KEY) {
  try {
    const oc = JSON.parse(await fs.readFile(path.join(ROOT, "config", "other-sports.json"), "utf8"));
    if (oc.volleyball?.enabled) events = events.concat(await volleyball(AF_KEY, from, oc.volleyball.daysAhead || DAYS, oc.volleyball));
    if (oc.basketball?.enabled) events = events.concat(await basketball(AF_KEY, from, oc.basketball.daysAhead || DAYS, oc.basketball));
  } catch (e) { console.warn("Другите спортове се пропуснаха:", e.message); }
}

/* TheSportsDB — Първа лига, евротурнирите, купите */
try {
  const sc = JSON.parse(await fs.readFile(path.join(ROOT, "config", "sportsdb-leagues.json"), "utf8"));
  if (sc.enabled) {
    console.log("Допълва от: TheSportsDB");
    events = events.concat(await fromSportsDB(sc.leagues, from, to, cfg._teamsOfInterest?.names || []));
  }
} catch (e) { console.warn("TheSportsDB се пропусна:", e.message); }

events = events.concat(await weeklyEvents());
events = events.concat(await tennisEvents());
events = events.concat(await manualEvents());
events.sort((a, b) => a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date));

const payload = {
  generatedAt: new Date().toISOString(),
  from, to, timezone: TZ,
  count: events.length,
  events,
};

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(payload, null, 1), "utf8");
console.log(`\nЗаписани ${events.length} събития в docs/data/events.json`);
