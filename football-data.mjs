/**
 * football-data.org (v4) — безплатният план дава ЦЕЛИЯ сезон, но само на
 * 12 турнира: Висша лига, Ла Лига, Серия А, Бундеслига, Лига 1, Шампионска
 * лига, Чемпиъншип, Ередивизие, Примейра лига, Серия А (Бразилия),
 * Световно и Европейско. Лига Европа, Лигата на конференциите и Първа лига
 * ГИ НЯМА — те идват от TheSportsDB.
 *
 * Лимитът на безплатния план е 10 заявки в минута, затова между лигите се
 * чака по 6,5 секунди.
 *
 * Изнесено в отделен модул, за да го ползват и fetch-fixtures.mjs, и
 * weekly-check.mjs, без да се преписва.
 */
import { toSofia, sleep } from "./lib.mjs";

const BASE = "https://api.football-data.org/v4";

async function getJSON(url, key, label) {
  const r = await fetch(url, { headers: { "X-Auth-Token": key } });
  if (r.status === 429) throw new Error(`${label}: изчерпан лимит на заявките (429)`);
  if (r.status === 403) throw new Error(`${label}: планът не покрива този турнир (403)`);
  if (!r.ok) throw new Error(`${label}: HTTP ${r.status} ${r.statusText}`);
  return r.json();
}

/**
 * @param {Array}  leagues  от config/leagues.json (тези с `fd`)
 * @param {string} from     "ГГГГ-ММ-ДД"
 * @param {string} to       "ГГГГ-ММ-ДД"
 * @param {string} key      FOOTBALL_DATA_KEY
 * @param {Array<string>} watch  отбори, чиито мачове стават водещи
 */
export async function fromFootballData(leagues, from, to, key, watch = []) {
  const W = watch.map(s => s.toLowerCase());
  const out = [];

  for (const lg of leagues) {
    if (!lg.fd) { console.warn(`  ! ${lg.name}: няма го в football-data.org, пропускам`); continue; }
    const q = new URLSearchParams({ dateFrom: from, dateTo: to });
    let res;
    try {
      res = await getJSON(`${BASE}/competitions/${lg.fd}/matches?${q}`, key, lg.name);
    } catch (e) {
      console.warn(`  ! ${lg.name}: ${e.message}`);
      await sleep(6500);
      continue;
    }
    for (const m of res.matches || []) {
      const t = toSofia(m.utcDate);
      if (!t) continue;
      const home = m.homeTeam?.shortName || m.homeTeam?.name || "?";
      const away = m.awayTeam?.shortName || m.awayTeam?.name || "?";
      const hot = W.some(w => (home + " " + away).toLowerCase().includes(w));
      out.push({
        source: "football-data",
        extId: `fd-${m.id}`,
        date: t.date, time: t.time, sport: lg.sport || "fut",
        comp: lg.name, title: `${home} – ${away}`,
        p: hot ? 3 : (lg.weight || 1),
        venue: "", round: m.matchday ? `кръг ${m.matchday}` : "",
        // 03:00 без потвърден час е обичайният запълнител на football-data
        provisional: m.status === "SCHEDULED" && t.time === "03:00",
      });
    }
    console.log(`  ✓ ${lg.name}: ${(res.matches || []).length} мача`);
    await sleep(6500);
  }
  return out;
}
