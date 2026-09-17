#!/usr/bin/env node
/**
 * TheSportsDB — покрива турнирите, които другите безплатни източници нямат:
 * Първа лига, Лига Европа, Лигата на конференциите, Купата и Суперкупата.
 *
 * Истински API с един ключ, а не изтегляне от страница.
 *
 * ВНИМАНИЕ: тестовият ключ вече е "123", не "3" — старият спря и точно
 * затова TheSportsDB не връщаше нищо. Безплатният ключ е и с нисък лимит:
 * eventsseason.php е 15 заявки/минута, eventsnextleague.php — 1 на минута.
 * За сериозна работа си извади собствен от thesportsdb.com и го сложи като
 * secret SPORTSDB_KEY.
 *
 * Ползва се като модул от fetch-fixtures.mjs.
 */

import { toSofia, sleep, addDays } from "./lib.mjs";

const KEY = process.env.SPORTSDB_KEY || "123";
const FREE = !process.env.SPORTSDB_KEY;
const BASE = `https://www.thesportsdb.com/api/v1/json/${KEY}`;

async function get(url, label) {
  const r = await fetch(url, { headers: { "User-Agent": "sportni-grafik/1.0" } });
  if (r.status === 429) throw new Error(`${label}: изчерпан лимит (429)`);
  if (r.status === 401 || r.status === 403)
    throw new Error(`${label}: ключът не се приема (HTTP ${r.status}) — провери SPORTSDB_KEY`);
  if (!r.ok) throw new Error(`${label}: HTTP ${r.status}`);
  const t = await r.text();
  if (!t || t.trim() === "" || t.trim() === "null") return null;
  try { return JSON.parse(t); } catch { throw new Error(`${label}: отговорът не е JSON`); }
}

/** Сезонът във формата на TheSportsDB: "2026-2027" за есенно-пролетните. */
function seasonOf(dateStr) {
  const d = new Date(dateStr);
  const y = d.getUTCFullYear();
  return d.getUTCMonth() >= 6 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

/**
 * @param {Array} leagues  [{id, name, sport, weight, enabled}]
 * @param {string} from    "ГГГГ-ММ-ДД"
 * @param {string} to      "ГГГГ-ММ-ДД"
 * @param {Array<string>} watch  отбори, чиито мачове стават водещи
 */
export async function fromSportsDB(leagues, from, to, watch = []) {
  const out = [];
  const W = watch.map(s => s.toLowerCase());
  let sampled = false;

  let dead = false;   // ключът е отказан — няма смисъл да питаме пак

  for (const lg of leagues.filter(l => l.enabled !== false)) {
    if (dead) { console.warn(`  ! ${lg.name}: пропуснат — ключът не се приема`); continue; }
    let rows = null, failed = false;

    /* 1) целият сезон — най-пълното, ако го дава */
    try {
      const j = await get(`${BASE}/eventsseason.php?id=${lg.id}&s=${seasonOf(from)}`, lg.name);
      rows = j && j.events;
    } catch (e) {
      console.warn(`  ! ${lg.name}: ${e.message}`);
      failed = true;
      if (/не се приема/.test(e.message)) dead = true;
    }

    /* 2) резервно — следващите мачове. Пробва се САМО когато горното е
       минало, но е върнало празно. Ако е гръмнало (лош ключ, паднал сайт),
       второто ще гръмне по същия начин — няма защо да чакаме за нищо.
       На безплатния ключ този адрес е 1 заявка в МИНУТА. */
    if (!failed && (!rows || !rows.length)) {
      await sleep(FREE ? 62000 : 1000);
      try {
        const j = await get(`${BASE}/eventsnextleague.php?id=${lg.id}`, lg.name);
        rows = j && j.events;
      } catch (e) { console.warn(`  ! ${lg.name} (следващи): ${e.message}`); }
    }

    if (!rows || !rows.length) {
      console.warn(`  ! ${lg.name} (id ${lg.id}): празен отговор — провери id-то или ключа`);
      await sleep(500);
      continue;
    }

    if (!sampled) {
      console.log("  примерен запис:", JSON.stringify(rows[0]).slice(0, 320));
      sampled = true;
    }

    let kept = 0;
    for (const ev of rows) {
      const stamp = ev.strTimestamp ||
        (ev.dateEvent ? `${ev.dateEvent}T${(ev.strTime || "00:00:00").slice(0, 8)}Z` : null);
      const t = toSofia(stamp);
      if (!t || t.date < from || t.date > to) continue;

      const home = ev.strHomeTeam || "", away = ev.strAwayTeam || "";
      const title = home && away ? `${home} – ${away}` : (ev.strEvent || "Мач");
      const isWatched = W.some(w => (home + " " + away).toLowerCase().includes(w));

      out.push({
        source: "thesportsdb",
        extId: `sdb-${ev.idEvent}`,
        date: t.date, time: t.time,
        sport: lg.sport || "fut",
        comp: lg.name,
        title,
        p: isWatched ? 3 : (lg.weight || 2),
        venue: ev.strVenue || "",
        round: ev.intRound ? `кръг ${ev.intRound}` : "",
        provisional: !ev.strTime || ev.strTime === "00:00:00",
      });
      kept++;
    }
    console.log(`  ✓ ${lg.name}: ${kept} мача в прозореца (от ${rows.length} в отговора)`);
    await sleep(FREE ? 4500 : 500);   // 15 заявки/мин на безплатния ключ
  }
  return out;
}

/**
 * Същото, но по дни и кръгове — работи и с БЕЗПЛАТНИЯ ключ.
 *
 * Безплатният ключ реже: eventsseason.php дава само първите 15 мача на
 * сезона (тоест нищо след август), eventsday.php — най-много 3 мача на ден.
 * eventsround.php обаче връща ЦЕЛИЯ кръг. Затова:
 *   1) за всеки ден от прозореца питаме eventsday.php → номерата на кръговете
 *   2) за всеки нов кръг питаме eventsround.php → всички мачове от него
 *   3) дните, които кръгът вече е покрил, не ги питаме повторно
 * Турнири без кръгове (НБА връща кръг 0) остават с до 3 мача на ден —
 * с платен ключ ограничението изчезва.
 *
 * @param {Array} leagues  [{id, name, sport, weight, season?, enabled}]
 *                         season: "2026" за турнирите в календарна година (MLS, F2)
 */
export async function fromSportsDBWindow(leagues, from, to, watch = []) {
  const out = [];
  const W = watch.map(s => s.toLowerCase());
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const pause = () => sleep(FREE ? 4200 : 300);

  const toEvent = (ev, lg) => {
    let stamp = ev.strTimestamp ||
      (ev.dateEvent ? `${ev.dateEvent}T${(ev.strTime || "00:00:00").slice(0, 8)}` : null);
    // TheSportsDB дава UTC без „Z“ — без него часът зависи от машината
    if (stamp && !/(Z|[+-]\d\d:?\d\d)$/.test(stamp)) stamp += "Z";
    const t = toSofia(stamp);
    if (!t || t.date < from || t.date > to) return null;
    const home = ev.strHomeTeam || "", away = ev.strAwayTeam || "";
    const title = home && away ? `${home} – ${away}` : (ev.strEvent || "Събитие");
    const hot = W.some(w => (home + " " + away).toLowerCase().includes(w));
    return {
      source: "thesportsdb",
      extId: `sdb-${ev.idEvent}`,
      date: t.date, time: t.time,
      sport: lg.sport || "fut",
      comp: lg.name,
      title,
      p: hot ? 3 : (lg.weight || 2),
      venue: ev.strVenue || "",
      round: Number(ev.intRound) > 0 ? `кръг ${ev.intRound}` : "",
      provisional: !ev.strTime || ev.strTime === "00:00:00",
    };
  };

  for (const lg of leagues.filter(l => l.enabled !== false)) {
    const season = lg.season || seasonOf(from);
    const byId = new Map();
    const covered = new Set(), roundsDone = new Set();
    let failed = null;

    for (const day of days) {
      if (covered.has(day)) continue;
      let rows = [];
      try {
        const j = await get(`${BASE}/eventsday.php?d=${day}&l=${lg.id}`, lg.name);
        rows = (j && j.events) || [];
      } catch (e) { failed = e.message; if (/не се приема/.test(e.message)) break; }
      await pause();

      for (const ev of rows) {
        const x = toEvent(ev, lg);
        if (x) byId.set(x.extId, x);
      }

      const rounds = [...new Set(rows.map(e => Number(e.intRound)).filter(r => r > 0))];
      for (const r of rounds) {
        if (roundsDone.has(r)) continue;
        roundsDone.add(r);
        try {
          const j = await get(`${BASE}/eventsround.php?id=${lg.id}&r=${r}&s=${season}`, `${lg.name} кръг ${r}`);
          for (const ev of (j && j.events) || []) {
            const x = toEvent(ev, lg);
            if (!x) continue;
            byId.set(x.extId, x);
            covered.add(x.date);
          }
        } catch (e) { failed = e.message; }
        await pause();
      }
    }

    const got = [...byId.values()];
    out.push(...got);
    if (failed && !got.length) throw new Error(`${lg.name}: ${failed}`);
    console.log(`  ✓ ${lg.name}: ${got.length}` + (roundsDone.size ? ` (кръг ${[...roundsDone].join(", ")})` : ""));
  }
  return out;
}
