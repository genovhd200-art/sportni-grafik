#!/usr/bin/env node
/**
 * ДНЕВНО ПОПЪЛВАНЕ НА ПРОПУСНАТОТО
 *
 * Пуска се всеки ден около 03:30 българско време и прави едно нещо:
 * добавя в docs/data/events.json събитията от следените турнири, които
 * ЛИПСВАТ. Нищо не мести, нищо не трие, ръчното не го пипа.
 *
 *   прозорец:  от днес до неделя; в неделя — идната седмица (пон–нед)
 *   турнири:   config/fill.json
 *   отчет:     docs/data/fill-report.json (+ Telegram до редактора)
 *
 * ИЗТОЧНИЦИ (всички легални, без Sofascore и Flashscore):
 *   · football-data.org      FOOTBALL_DATA_KEY   големите първенства + ШЛ
 *   · TheSportsDB            SPORTSDB_KEY / 123  купите, ЛЕ, ЛК, Първа лига,
 *                                                МЛС, НБА, НБЛ, Формула 2
 *   · EuroLeague API         без ключ            Евролига, Еврокъп
 *   · Jolpica                без ключ            Формула 1, всички сесии
 *   · БФВ / DataProject      без ключ            българският волейбол
 *   · api-sports.io          API_FOOTBALL_KEY    НБА и волейбол за днес/утре
 *   · тенис                  одобрените от config/tennis-candidates.json
 *
 * Всичко добавено оттук е със source:"fill" (оригиналът е във via). Така
 * неделната проверка не го брои за „отпаднало“, а дневното теглене
 * (fetch-fixtures.mjs) не го изтрива.
 *
 * Променливи на средата:
 *   FORCE=1          пуска се пак, дори вече да е минал днес, и в който и да е час
 *   DRY_RUN=1        само отчет, без да пише нищо
 *   FILL_FROM=ГГГГ-ММ-ДД, FILL_TO=ГГГГ-ММ-ДД   ръчен прозорец
 *   TENNIS_FOUND=път  JSON от tennis-scrape.mjs с нови кандидати за тенис
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  ROOT, TZ, sofiaToday, sofiaClock, addDays, readJSON, writeJSON, matchKey,
} from "./lib.mjs";
import { fromFootballData } from "./football-data.mjs";
import { fromSportsDBWindow } from "./sportsdb.mjs";
import { fromEuroleague } from "./euroleague.mjs";
import { fromFormula1 } from "./formula1.mjs";
import { fromVolleyBG } from "./volley-bg.mjs";
import { volleyball, basketball } from "./other-sports.mjs";

const EVENTS_FILE = "docs/data/events.json";
const REPORT_FILE = "docs/data/fill-report.json";
const STATE_FILE = "config/fill-state.json";
const TENNIS_FILE = "config/tennis-candidates.json";

const FORCE = process.env.FORCE === "1";
const DRY = process.env.DRY_RUN === "1";

/* ---------- 1. кога и за какво ---------- */
const today = sofiaToday();
const clock = sofiaClock();
const state = (await readJSON(STATE_FILE, {})) || {};

if (!FORCE && state.lastRun === today) {
  console.log(`Попълването вече е минало днес (${today} в ${state.lastRunAt}). Излизам.`);
  process.exit(0);
}
/* Cron-ът е в UTC и тръгва два пъти (00:30 и 01:30), за да уцели 03:30 и
   през лятното, и през зимното време. По-ранното пускане просто излиза. */
if (!FORCE && Number(clock.slice(0, 2)) < 3) {
  console.log(`В София е ${clock} — рано е, следващото пускане ще свърши работата.`);
  process.exit(0);
}

const dow = new Date(today + "T12:00:00Z").getUTCDay();          // 0 = неделя
const from = process.env.FILL_FROM || (dow === 0 ? addDays(today, 1) : today);
const to = process.env.FILL_TO || (dow === 0 ? addDays(today, 7) : addDays(today, 7 - dow));
console.log(`Дневно попълване · ${today} ${clock}`);
console.log(`Прозорец: ${from} → ${to} (${TZ})\n`);

const cfg = await readJSON("config/fill.json", null);
if (!cfg) { console.error("Липсва config/fill.json."); process.exit(1); }
const leaguesCfg = (await readJSON("config/leagues.json", {})) || {};
const WATCH = leaguesCfg._teamsOfInterest?.names || [];
const on = x => x && x.enabled !== false;
const calendarSeason = lg => lg.season === "calendar" ? { ...lg, season: from.slice(0, 4) } : lg;

/* ---------- 2. тегленето ---------- */
const sourceLog = [];
let fresh = [];

async function step(name, fn) {
  console.log(`\n${name}:`);
  try {
    const rows = await fn();
    fresh = fresh.concat(rows);
    sourceLog.push({ name, ok: true, count: rows.length, error: null });
  } catch (e) {
    console.warn(`  ! ${e.message}`);
    sourceLog.push({ name, ok: false, count: 0, error: e.message });
  }
}

/* 2а. футбол — football-data, където има код и ключ */
const football = (cfg.football || []).filter(on);
const FD_KEY = process.env.FOOTBALL_DATA_KEY;
const fdFailed = new Set();
const viaFd = FD_KEY ? football.filter(l => l.fd) : [];
if (viaFd.length) {
  await step("football-data", async () => {
    const rows = await fromFootballData(viaFd.map(l => ({ ...l, sport: "fut" })), from, to, FD_KEY, WATCH);
    for (const l of viaFd) if (!rows.some(r => r.comp === l.name)) fdFailed.add(l.name);
    return rows;
  });
}

/* 2б. TheSportsDB — всичко без football-data, плюс резерва за празните.
   Празен отговор от football-data е нормален за седмица без кръг, затова
   резервата пита TheSportsDB само за тези турнири — ако и там е празно, толкова. */
const viaSdb = [
  ...football.filter(l => l.sdb && (!l.fd || !FD_KEY || fdFailed.has(l.name)))
    .map(l => ({ id: l.sdb, name: l.name, sport: "fut", weight: l.weight, season: l.season })),
  ...(cfg.basketball || []).filter(on).map(l => ({ id: l.sdb, name: l.name, sport: "bas", weight: l.weight, season: l.season })),
  ...(on(cfg.formula2) ? [{ id: cfg.formula2.sdb, name: cfg.formula2.name, sport: "mot", weight: cfg.formula2.weight, season: cfg.formula2.season }] : []),
].map(calendarSeason);

for (const lg of viaSdb)
  await step(`thesportsdb · ${lg.name}`, () => fromSportsDBWindow([lg], from, to, WATCH));

/* 2в. Евролига и Еврокъп */
if ((cfg.euroleague || []).some(on))
  await step("euroleague", () => fromEuroleague(cfg.euroleague, from, to, WATCH));

/* 2г. Формула 1 */
if (on(cfg.formula1))
  await step("jolpica · Формула 1", () => fromFormula1(from, to, cfg.formula1));

/* 2д. българският волейбол */
if ((cfg.volleyball || []).some(on))
  await step("БФВ волейбол", () => fromVolleyBG(cfg.volleyball, from, to, WATCH));

/* 2е. api-sports — днес и утре, ако има ключ */
const AF_KEY = process.env.API_FOOTBALL_KEY;
const as = cfg.apiSports || {};
if (on(as) && AF_KEY) {
  const days = Math.max(1, Math.min(as.days || 2, 1 + (Date.parse(to) - Date.parse(from)) / 864e5));
  if (on(as.basketball))
    await step("api-basketball", () => basketball(AF_KEY, from, days, as.basketball));
  if (on(as.volleyball))
    await step("api-volleyball", () => volleyball(AF_KEY, from, days, as.volleyball));
} else if (on(as)) {
  sourceLog.push({ name: "api-sports", ok: false, count: 0, error: "няма API_FOOTBALL_KEY" });
}

/* 2ж. тенис — само одобрените от редакцията */
const tennisCfg = cfg.tennis || {};
let candidates = (await readJSON(TENNIS_FILE, [])) || [];
const newCandidates = [];
if (on(tennisCfg)) {
  const found = process.env.TENNIS_FOUND ? ((await readJSON(path.relative(ROOT, path.resolve(process.env.TENNIS_FOUND)), [])) || []) : [];
  const big = (tennisCfg.bigTournaments || []).map(s => s.toLowerCase());
  const known = new Set(candidates.map(c => c.extId));
  for (const e of found) {
    if (!e.extId || known.has(e.extId)) continue;
    if (e.date < today) continue;
    const comp = String(e.comp || "");
    // турнир, който сайтът не е назовал, също отива за проверка
    const isBig = comp === "Тенис" || big.some(b => comp.toLowerCase().includes(b));
    if (!isBig) continue;
    const c = { ...e, sport: "ten", ok: null, foundAt: today };
    candidates.push(c); newCandidates.push(c); known.add(e.extId);
  }
  const approved = candidates.filter(c => c.ok === true && !c.addedAt);
  fresh = fresh.concat(approved.map(c => ({
    source: "tennis-review", extId: c.extId, date: c.date, time: c.time, sport: "ten",
    comp: c.comp, title: c.title, p: c.p || tennisCfg.weight || 2,
    venue: "", round: "", provisional: !!c.provisional,
  })));
  sourceLog.push({ name: "тенис (одобрени)", ok: true, count: approved.length, error: null });
  console.log(`\nТенис: ${approved.length} одобрени · ${newCandidates.length} нови за проверка · ` +
    `${candidates.filter(c => c.ok === null).length} чакат общо`);
}

/* ---------- 3. кое липсва ---------- */
fresh = fresh.filter(e => e.date >= from && e.date <= to);

const feed = (await readJSON(EVENTS_FILE, null)) || { generatedAt: null, timezone: TZ, events: [] };
const table = feed.events || [];

/* Кирилица → латиница, за да се познае „Левски – Лудогорец“ в „Levski Sofia – Ludogorets“. */
const LAT = { а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"ts",ч:"ch",ш:"sh",щ:"sht",ъ:"a",ь:"y",ю:"yu",я:"ya" };
/* Грубо уеднаквяване на изписванията: ц/ts/cs/k/c → c, ч/ch → c, y/j → i,
   двойните букви — единични. „ЦСКА“ и „CSKA“ стават „ca“, „Олимпиакос“ и
   „Olympiacos“ — „olimpiacos“. */
const canon = w => w.replace(/ch/g, "c").replace(/ts|tz/g, "c").replace(/k/g, "c")
  .replace(/cs+/g, "c").replace(/[yj]/g, "i").replace(/w/g, "v").replace(/(.)\1+/g, "$1");
const STOP = new Set(["club", "the", "sport", "sporting", "athletic", "basket", "basketbol",
  "basketball", "baloncesto", "volley", "fc", "cf", "bc", "ac", "sc", "vc", "ud", "cd", "as", "ss", "de", "of"].map(canon));
const tokens = side => new Set(
  String(side || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
    .replace(/[а-яѝ]/g, ch => LAT[ch] ?? "i")
    .split(/[^a-z0-9]+/).map(canon).filter(w => w.length >= 2 && !STOP.has(w)));
/* „Домакин – гост“ → два набора думи; събитие без двама участници → null. */
const sides = title => {
  const p = String(title || "").split(/\s+(?:[-–—]|vs\.?|v|срещу)\s+/i);
  return p.length === 2 ? p.map(tokens) : null;
};
/* Един отбор = по-краткото име се съдържа изцяло в по-дългото:
   „Левски“ ⊂ „Levski Sofia“, но „Ботев Пловдив“ ≠ „Ботев Враца“.
   strict — думите трябва да са същите (за мачове от различни турнири). */
const meets = (a, b, strict) => {
  if (strict) return a.size === b.size && [...a].every(w => b.has(w));
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  return [...small].every(w => big.has(w));
};
const compOf = c => String(c || "").trim().toLowerCase();

const byExtId = new Set(table.map(e => e.extId).filter(Boolean));
const byKey = new Set(table.filter(e => e.date >= addDays(from, -3) && e.date <= addDays(to, 3)).map(matchKey));
const byDay = new Map();
const remember = e => {
  const s = sides(e.title);
  if (!s) return;
  if (!byDay.has(e.date)) byDay.set(e.date, []);
  byDay.get(e.date).push({ sport: e.sport || "fut", comp: compOf(e.comp), s });
};
for (const e of table) if (e.date >= from && e.date <= to) remember(e);

/* Същото събитие ли е вече в таблицата? Първо по id, после по заглавие,
   накрая „на око“: същия ден и спорт, и ДВАТА отбора се разпознават
   (в същия или в разменен ред). Един общ отбор не стига — „Манчестър“
   в един ден може да е и Сити, и Юнайтед. */
function exists(ev) {
  if (byExtId.has(ev.extId) || byKey.has(matchKey(ev))) return true;
  const s = sides(ev.title);
  if (!s || !s[0].size || !s[1].size) return false;
  const comp = compOf(ev.comp);
  return (byDay.get(ev.date) || []).some(old => {
    if (old.sport !== (ev.sport || "fut")) return false;
    // „Интер“ от Серия А и „Интер Маями“ от МЛС в един ден не са един мач
    const strict = !!(comp && old.comp && comp !== old.comp);
    return (meets(s[0], old.s[0], strict) && meets(s[1], old.s[1], strict)) ||
           (meets(s[0], old.s[1], strict) && meets(s[1], old.s[0], strict));
  });
}

const added = [];
const seen = new Set();
for (const ev of fresh) {
  const k = ev.extId || matchKey(ev);
  if (seen.has(k)) continue;
  seen.add(k);
  if (exists(ev)) continue;
  added.push({ ...ev, source: "fill", via: ev.source, addedAt: today });
  // и в рамките на това пускане — две API-та със същия мач не бива да го вкарат два пъти
  byExtId.add(ev.extId); byKey.add(matchKey(ev));
  remember(ev);
}
added.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

console.log(`\nОт източниците: ${fresh.length} · вече ги има: ${fresh.length - added.length} · липсващи: ${added.length}`);
for (const e of added.slice(0, 30)) console.log(`  + ${e.date} ${e.time}  ${e.comp} · ${e.title}`);
if (added.length > 30) console.log(`  … и още ${added.length - 30}`);

/* ---------- 4. отчет ---------- */
const SPORT_SLUG = { football: "football", basketball: "basketball", volleyball: "volleyball", tennis: "tennis", motorsport: "motorsport" };
const days = [];
for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
const sofascore = days.map(d => ({
  date: d,
  links: (cfg.sofascoreLinks || []).filter(s => SPORT_SLUG[s])
    .map(s => ({ sport: s, url: `https://www.sofascore.com/${SPORT_SLUG[s]}/${d}` })),
}));

const report = {
  generatedAt: new Date().toISOString(),
  runDate: today, timezone: TZ,
  window: { from, to },
  sources: sourceLog,
  totals: { fromSources: fresh.length, added: added.length, tennisNew: newCandidates.length,
            tennisPending: candidates.filter(c => c.ok === null).length },
  added: added.map(({ extId, date, time, sport, comp, title, via }) => ({ extId, date, time, sport, comp, title, via })),
  tennisNew: newCandidates.map(({ extId, date, time, comp, title }) => ({ extId, date, time, comp, title })),
  sofascore,
  dryRun: DRY,
};

if (DRY) {
  console.log("\nDRY_RUN — нищо не е записано.");
  process.exit(0);
}

/* Предпазител: ако всички източници са паднали, светваме в червено. */
if (sourceLog.length && sourceLog.every(s => !s.ok)) {
  await writeJSON(REPORT_FILE, { ...report, failed: true });
  console.error("\nНито един източник не отговори. Таблицата не е пипната.");
  for (const s of sourceLog) console.error(`  · ${s.name}: ${s.error}`);
  process.exit(1);
}

if (added.length) {
  const events = table.concat(added)
    .sort((a, b) => a.date === b.date ? String(a.time).localeCompare(b.time)
                                      : String(a.date).localeCompare(b.date));
  await writeJSON(EVENTS_FILE, {
    ...feed,
    generatedAt: new Date().toISOString(),
    timezone: TZ,
    count: events.length,
    lastFill: today,
    events,
  });
}

/* Одобрените се отбелязват като обработени — влезли или вече ги е имало. */
const tennisTaken = new Set(fresh.filter(e => e.source === "tennis-review").map(e => e.extId));
candidates = candidates
  .map(c => tennisTaken.has(c.extId) && !c.addedAt ? { ...c, addedAt: today } : c)
  .filter(c => c.date >= addDays(today, -14));          // старите се чистят сами
if (on(tennisCfg)) await writeJSON(TENNIS_FILE, candidates);

await writeJSON(REPORT_FILE, report);
await writeJSON(STATE_FILE, { lastRun: today, lastRunAt: clock, lastWindow: { from, to }, lastTotals: report.totals });
console.log(`\nЗаписано: ${added.length} нови в ${EVENTS_FILE}, отчет в ${REPORT_FILE}`);
