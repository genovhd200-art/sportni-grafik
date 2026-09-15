#!/usr/bin/env node
/**
 * НЕДЕЛНА ПРОВЕРКА НА СЕДМИЧНАТА ПРОГРАМА
 *
 * Пуска се в неделя вечер и отговаря на един въпрос: програмата в дъската
 * съвпада ли с това, което казват източниците за идната седмица.
 *
 *   1) тегли понеделник–неделя от вързаните източници
 *   2) сравнява с docs/data/events.json и прави отчет:
 *        · нови събития, които ги няма в таблицата
 *        · събития с променен час или дата
 *        · събития в таблицата, които вече ги няма в източника
 *   3) записва отчета в docs/data/weekly-check.json и reports/ГГГГ-ММ-ДД.md
 *   4) влива новите и поправените в docs/data/events.json, без да пипа
 *      ръчно добавените и без да трие ръчните редакции
 *
 * ИЗТОЧНИЦИ (и само те):
 *   · football-data.org      FOOTBALL_DATA_KEY      големите първенства + ШЛ
 *   · TheSportsDB            SPORTSDB_KEY           Първа лига, ЛЕ, ЛК, купите
 *   · собственият лайвскор   без ключ               sportni-novini.bg/livescore
 *
 * Sofascore и Flashscore НЕ се пипат: условията им забраняват автоматично
 * извличане, а Cloudflare бездруго блокира адресите на GitHub Actions.
 *
 * Променливи на средата:
 *   FORCE=1         пуска се пак, дори вече да е минал днес
 *   SKIP_SCRAPE=1   без браузъра (за проба на локална машина без Playwright)
 *   REMOVE_DROPPED=1 маха отпадналите от таблицата, вместо да ги маркира
 *   WEEK_FROM=ГГГГ-ММ-ДД  ръчен прозорец (за проба); краят е +6 дни
 */
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  ROOT, TZ, sofiaToday, sofiaClock, nextWeekWindow, addDays,
  readJSON, writeJSON, matchKey,
} from "./lib.mjs";
import { fromFootballData } from "./football-data.mjs";
import { fromSportsDB } from "./sportsdb.mjs";

const STATE_FILE = "config/weekly-check-state.json";
const EVENTS_FILE = "docs/data/events.json";
const REPORT_JSON = "docs/data/weekly-check.json";

const FORCE = process.env.FORCE === "1";
const SKIP_SCRAPE = process.env.SKIP_SCRAPE === "1";
const REMOVE_DROPPED = process.env.REMOVE_DROPPED === "1";

/* Източниците, които пълнят таблицата автоматично. Всичко останало
   (най-вече source:"manual") е на редакцията и не се пипа. */
const AUTO_SOURCES = new Set([
  "football-data", "api-football", "thesportsdb", "weekly-scrape",
  "api-volleyball", "api-basketball", "api-formula1", "tennis-scrape", "seed",
]);

/* Полетата, които източникът притежава. Всичко друго в един запис —
   бележки, ръчно вдигната тежест, каквото редакцията е добавила — оцелява
   при вливането. */
const SOURCE_FIELDS = ["date", "time", "comp", "title", "venue", "round", "provisional"];

/* ---------- 1. вече минал ли е днес ---------- */
const today = sofiaToday();
const state = (await readJSON(STATE_FILE, {})) || {};

if (state.lastRun === today && !FORCE) {
  console.log(`Проверката вече е минала днес (${today} в ${state.lastRunAt || "?"}). Излизам.`);
  console.log("За повторно пускане: FORCE=1 или ръчно от Actions.");
  process.exit(0);
}

/* ---------- 2. прозорецът ---------- */
const from = process.env.WEEK_FROM || nextWeekWindow(today).from;
const to = addDays(from, 6);
console.log(`Неделна проверка · днес ${today} ${sofiaClock()}`);
console.log(`Прозорец: ${from} → ${to} (понеделник–неделя, ${TZ})\n`);

const cfg = await readJSON("config/leagues.json", { leagues: [] });
const WATCH = cfg._teamsOfInterest?.names || [];
const sourceLog = [];

const note = (name, ok, count, error) => {
  sourceLog.push({ name, ok, count, error: error || null });
  console.log(ok ? `  = ${name}: ${count} събития` : `  ! ${name}: ${error}`);
};

/* ---------- 3. тегленето ---------- */
let fresh = [];

/* 3а. football-data.org */
if (process.env.FOOTBALL_DATA_KEY) {
  console.log("football-data.org:");
  try {
    const rows = await fromFootballData(
      (cfg.leagues || []).filter(l => l.enabled && l.fd),
      from, to, process.env.FOOTBALL_DATA_KEY, WATCH);
    fresh = fresh.concat(rows);
    note("football-data", true, rows.length);
  } catch (e) { note("football-data", false, 0, e.message); }
} else {
  note("football-data", false, 0, "няма FOOTBALL_DATA_KEY");
}

/* 3б. TheSportsDB */
const sdb = await readJSON("config/sportsdb-leagues.json", { enabled: false, leagues: [] });
if (sdb.enabled) {
  console.log("\nTheSportsDB:");
  try {
    const rows = await fromSportsDB(sdb.leagues, from, to, WATCH);
    fresh = fresh.concat(rows);
    note("thesportsdb", true, rows.length);
  } catch (e) { note("thesportsdb", false, 0, e.message); }
} else {
  note("thesportsdb", false, 0, "изключен в config/sportsdb-leagues.json");
}

/* 3в. собственият лайвскор, през scripts/weekly-scrape.mjs */
if (SKIP_SCRAPE) {
  note("weekly-scrape", false, 0, "пропуснат (SKIP_SCRAPE=1)");
} else {
  console.log("\nСобствен лайвскор (weekly-scrape.mjs):");
  try {
    await run("node", ["scripts/weekly-scrape.mjs"]);
    const rows = ((await readJSON("config/weekly-events.json", [])) || [])
      .filter(e => e.date >= from && e.date <= to);
    fresh = fresh.concat(rows);
    note("weekly-scrape", true, rows.length);
  } catch (e) { note("weekly-scrape", false, 0, e.message); }
}

function run(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: "inherit" });
    p.on("error", rej);
    p.on("close", c => c === 0 ? res() : rej(new Error(`излезе с код ${c}`)));
  });
}

/* Едно и също събитие може да дойде от два източника — оставяме първото. */
{
  const seen = new Set();
  fresh = fresh.filter(e => {
    const k = matchKey(e);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}
console.log(`\nОт източниците: ${fresh.length} събития в прозореца.`);

/* ПРЕДПАЗИТЕЛ. Ако всички източници са мълчали, всяко събитие в таблицата
   излиза „отпаднало“ и програмата се изтрива. По-добре нищо, отколкото това:
   излизаме с грешка, за да светне Actions, и не пипаме events.json. */
if (!fresh.length) {
  const why = sourceLog.filter(s => !s.ok).map(s => `${s.name}: ${s.error}`).join("; ");
  console.error("\nНито един източник не върна събития за прозореца.");
  console.error(why || "(без обяснение)");
  console.error("Таблицата остава непокътната. Проверете ключовете и пуснете пак.");
  await writeJSON(REPORT_JSON, {
    generatedAt: new Date().toISOString(), runDate: today, timezone: TZ,
    window: { from, to }, sources: sourceLog, failed: true,
    totals: { fromSources: 0, inTable: null, added: 0, moved: 0, dropped: 0, manualUntouched: null },
    added: [], moved: [], dropped: [],
  });
  process.exit(1);
}

/* ---------- 4. сравнението ---------- */
const feed = (await readJSON(EVENTS_FILE, null)) ||
  { generatedAt: null, timezone: TZ, events: [] };
const table = feed.events || [];

const inWindow = e => e.date >= from && e.date <= to;
const isAuto = e => AUTO_SOURCES.has(e.source);

/* Търсачки: първо по extId, после по отбори — преместен мач пази отборите,
   но при скрейпнатите extId се сменя заедно с часа. */
const byExtId = new Map(), byKey = new Map();
for (const e of table) {
  if (e.extId) byExtId.set(e.extId, e);
  if (inWindow(e)) byKey.set(matchKey(e), e);
}
const find = ev => byExtId.get(ev.extId) || byKey.get(matchKey(ev));

const added = [], moved = [], dropped = [];
const matchedExisting = new Set();

for (const ev of fresh) {
  const old = find(ev);
  if (!old) { added.push(ev); continue; }
  matchedExisting.add(old);

  if (old.source === "manual" || old.locked) continue;     // ръчното е свещено

  if (old.date !== ev.date || old.time !== ev.time) {
    moved.push({
      extId: old.extId, title: old.title, comp: old.comp, sport: old.sport,
      was: { date: old.date, time: old.time },
      now: { date: ev.date, time: ev.time },
      what: old.date !== ev.date ? (old.time !== ev.time ? "дата и час" : "дата") : "час",
    });
  }
}

for (const old of table) {
  if (!inWindow(old)) continue;
  if (old.source === "manual" || old.locked) continue;
  if (!isAuto(old)) continue;
  if (matchedExisting.has(old)) continue;
  dropped.push({
    extId: old.extId, title: old.title, comp: old.comp,
    sport: old.sport, date: old.date, time: old.time, source: old.source,
  });
}

const manualInWindow = table.filter(e => inWindow(e) && (e.source === "manual" || e.locked)).length;

/* ---------- 5. вливането ---------- */
let events = table.slice();

/* Какво казва източникът за всеки преместен запис. */
const freshByExtId = new Map(fresh.map(e => [e.extId, e]));
const freshByKey = new Map(fresh.map(e => [matchKey(e), e]));
const movedIds = new Set(moved.map(m => m.extId));

events = events.map(old => {
  if (!movedIds.has(old.extId)) return old;
  const ev = freshByExtId.get(old.extId) || freshByKey.get(matchKey(old));
  if (!ev) return old;
  const upd = { ...old };
  for (const f of SOURCE_FIELDS) if (ev[f] !== undefined) upd[f] = ev[f];
  return upd;   // p, note и всичко ръчно добавено остават каквито са били
});

events = events.concat(added);

if (dropped.length) {
  const gone = new Set(dropped.map(d => d.extId));
  events = REMOVE_DROPPED
    ? events.filter(e => !gone.has(e.extId))
    : events.map(e => gone.has(e.extId) ? { ...e, dropped: true, droppedAt: today } : e);
}

events.sort((a, b) => a.date === b.date ? String(a.time).localeCompare(b.time)
                                        : String(a.date).localeCompare(b.date));

/* ---------- 6. записване ---------- */
const report = {
  generatedAt: new Date().toISOString(),
  runDate: today,
  timezone: TZ,
  window: { from, to },
  sources: sourceLog,
  totals: {
    fromSources: fresh.length,
    inTable: table.filter(inWindow).length,
    added: added.length,
    moved: moved.length,
    dropped: dropped.length,
    manualUntouched: manualInWindow,
  },
  added: added.map(e => ({
    extId: e.extId, date: e.date, time: e.time,
    sport: e.sport, comp: e.comp, title: e.title, source: e.source,
  })),
  moved,
  dropped,
  droppedHandling: REMOVE_DROPPED ? "махнати от таблицата" : "маркирани с dropped:true",
};

await writeJSON(REPORT_JSON, report);
await writeJSON(EVENTS_FILE, {
  ...feed,
  generatedAt: new Date().toISOString(),
  timezone: TZ,
  count: events.length,
  lastWeeklyCheck: today,
  events,
});
await writeJSON(STATE_FILE, {
  lastRun: today,
  lastRunAt: sofiaClock(),
  lastWindow: { from, to },
  lastTotals: report.totals,
});

/* ---------- 7. отчетът на български ---------- */
const bg = d => {
  const names = ["неделя", "понеделник", "вторник", "сряда", "четвъртък", "петък", "събота"];
  const x = new Date(d + "T12:00:00Z");
  return `${names[x.getUTCDay()]}, ${d.slice(8)}.${d.slice(5, 7)}`;
};
const L = [];
L.push(`# Проверка на седмичната програма — ${today}`);
L.push("");
L.push(`**Прозорец:** ${from} → ${to} (понеделник–неделя, часовете са в българско време)`);
L.push("");
L.push("| | брой |");
L.push("|---|---|");
L.push(`| От източниците | ${fresh.length} |`);
L.push(`| В таблицата за тази седмица | ${table.filter(inWindow).length} |`);
L.push(`| **Нови** | **${added.length}** |`);
L.push(`| **Променен час или дата** | **${moved.length}** |`);
L.push(`| **Отпаднали** | **${dropped.length}** |`);
L.push(`| Ръчни, непипнати | ${manualInWindow} |`);
L.push("");
L.push("## Източници");
L.push("");
for (const s of sourceLog)
  L.push(`- ${s.ok ? "✅" : "⚠️"} **${s.name}** — ${s.ok ? s.count + " събития" : s.error}`);
L.push("");

L.push(`## Нови събития (${added.length})`);
L.push("");
if (!added.length) L.push("_Няма._");
else {
  L.push("| Ден | Час | Турнир | Събитие | Източник |");
  L.push("|---|---|---|---|---|");
  for (const e of added)
    L.push(`| ${bg(e.date)} | ${e.time} | ${e.comp} | ${e.title} | ${e.source} |`);
}
L.push("");

L.push(`## Променен час или дата (${moved.length})`);
L.push("");
if (!moved.length) L.push("_Няма._");
else {
  L.push("| Събитие | Турнир | Беше | Стана | Какво |");
  L.push("|---|---|---|---|---|");
  for (const m of moved)
    L.push(`| ${m.title} | ${m.comp} | ${m.was.date} ${m.was.time} | ${m.now.date} ${m.now.time} | ${m.what} |`);
}
L.push("");

L.push(`## Отпаднали от източника (${dropped.length})`);
L.push("");
if (!dropped.length) L.push("_Няма._");
else {
  L.push(REMOVE_DROPPED
    ? "Махнати са от таблицата."
    : "Останали са в таблицата с `dropped: true` — прегледай ги и ги махни на ръка, ако наистина ги няма.");
  L.push("");
  L.push("| Ден | Час | Турнир | Събитие |");
  L.push("|---|---|---|---|");
  for (const d of dropped)
    L.push(`| ${bg(d.date)} | ${d.time} | ${d.comp} | ${d.title} |`);
}
L.push("");
L.push("---");
L.push("");
L.push("_Ръчно добавените (`source: \"manual\"`) и заключените (`locked: true`) не се пипат._");
L.push("_Отчетът е машинен — преди ефир сверявай съмнителните часове с официалния сайт на турнира._");
L.push("");

const reportDir = path.join(ROOT, "reports");
await fs.mkdir(reportDir, { recursive: true });
await fs.writeFile(path.join(reportDir, `${today}.md`), L.join("\n"), "utf8");

console.log(`\nНови ${added.length} · преместени ${moved.length} · отпаднали ${dropped.length}`);
console.log(`Отчет: ${REPORT_JSON} и reports/${today}.md`);
