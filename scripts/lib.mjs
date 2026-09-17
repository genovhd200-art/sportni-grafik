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
