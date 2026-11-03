/**
 * Общи помощни неща за всички скриптове.
 *
 * Държи на едно място: къде е коренът на хранилището, как се смята
 * българското време и как се чете/пише JSON. Дотук всеки скрипт си ги
 * преписваше и се разминаваха.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Коренът на хранилището (една папка нагоре от scripts/). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const TZ = "Europe/Sofia";

export const pad = n => String(n).padStart(2, "0");
export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** UTC отметка -> { date: "ГГГГ-ММ-ДД", time: "ЧЧ:ММ" } в българско време. */
export function toSofia(input) {
  if (!input) return null;
  const d = new Date(input);
  if (isNaN(d)) return null;
  const s = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
  const [date, time] = s.split(" ");
  return { date, time };
}

/** Днешната дата по софийско време, "ГГГГ-ММ-ДД". */
export function sofiaToday(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

/** Час и минута по софийско време, "ЧЧ:ММ". */
export function sofiaClock(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(now);
}

/** Прибавя дни към дата "ГГГГ-ММ-ДД". Смята се по обяд UTC, за да не хапе DST. */
export function addDays(dateStr, n) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Следващата календарна седмица: понеделник → неделя.
 * Пуснато в неделя вечер, връща утрешния понеделник и неделята след него.
 * Пуснато в друг ден, връща пак СЛЕДВАЩИЯ понеделник — прозорецът е
 * винаги „идната седмица“, независимо кога натиснеш бутона.
 */
export function nextWeekWindow(today = sofiaToday()) {
  const dow = new Date(today + "T12:00:00Z").getUTCDay();   // 0 = неделя
  const from = addDays(today, ((8 - dow) % 7) || 7);
  return { from, to: addDays(from, 6) };
}

export async function readJSON(rel, fallback = null) {
  try { return JSON.parse(await fs.readFile(path.join(ROOT, rel), "utf8")); }
  catch { return fallback; }
}

export async function writeJSON(rel, data, indent = 1) {
  const p = path.join(ROOT, rel);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(data, null, indent) + "\n", "utf8");
  return p;
}

/**
 * Един и същ мач от api-sports и от друг източник. api-sports дава само
 * днес и утре и пише отборите различно („Beroe – CSKA Sofia“ и
 * „Beroe 2016 – CSKA“, „Pernik – Dunav“ и „Metalurg – Dunav“), затова ключът
 * по заглавие не ги хваща. Само волейбол и баскетбол, само двойка „api-sports
 * срещу друг източник“, в същия ден и час и с поне един общ отбор: отбор не
 * играе два мача едновременно. Женските („W“, „Women“) не се сливат с мъжките.
 * Остава записът от другия източник, защото той е за целия сезон.
 */
const SAME_TEAM_STOP = new Set(["sofi", "plov", "varn", "burg", "voll", "spor", "club", "bask"]);
const isApiSports = e => /^api-/.test(e.source || "") || /^api-/.test(e.via || "");
const isWomen = t => /\b(w|women|feminin|жени)\b/i.test(t);
const teamWords = side => String(side).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
  .split(/[^\p{L}]+/u).filter(w => w.length >= 4).map(w => w.slice(0, 4))
  .filter(w => !SAME_TEAM_STOP.has(w));
const shareTeam = (a, b) => a.some(w => b.includes(w));
export function mergeSourceDuplicates(events) {
  const parts = e => {
    const p = String(e.title || "").split(/\s+[-–—]\s+/);
    return p.length === 2 ? p.map(teamWords) : null;
  };
  const drop = new Set(), pairs = [];
  const groups = new Map();
  for (const e of events) {
    if (e.sport !== "vol" && e.sport !== "bas") continue;
    const k = e.date + "|" + e.time + "|" + e.sport;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  for (const list of groups.values()) {
    for (const api of list.filter(isApiSports)) {
      const a = parts(api);
      if (!a) continue;
      const other = list.find(o => {
        if (isApiSports(o) || isWomen(o.title) !== isWomen(api.title)) return false;
        const b = parts(o);
        return b && (shareTeam(a[0], b[0]) || shareTeam(a[1], b[1]) ||
                     shareTeam(a[0], b[1]) || shareTeam(a[1], b[0]));
      });
      if (other) { drop.add(api); pairs.push([api, other]); }
    }
  }
  return { events: events.filter(e => !drop.has(e)), pairs };
}

/**
 * Ключ за сравняване на едно и също събитие между два източника или между
 * два дни. Часът и датата нарочно НЕ влизат — иначе преместен мач излиза
 * като „нов“ и „отпаднал“ едновременно.
 */
export function matchKey(ev) {
  const t = String(ev.title || "")
    .toLowerCase()
    .replace(/[–—−]/g, "-")
    .replace(/\s*(-|vs\.?|срещу)\s*/g, "|")
    .replace(/[^\p{L}\p{N}|]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${ev.sport || "fut"}::${t}`;
}
