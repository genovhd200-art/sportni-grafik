/**
 * Волейбол и баскетбол от api-sports.io.
 *
 * Ползва СЪЩИЯ ключ като футбола — регистрацията в dashboard.api-football.com
 * дава достъп и до останалите спортове от семейството. Тенис не е сред тях.
 *
 * Формула 1 е махната: безплатният план пуска само сезони 2022-2024 и за
 * текущия сезон връщаше празно. Календарът идва от formula1.com през
 * config/weekly-sources.json, а конкретните сесии — от config/manual-events.json.
 *
 * ВАЖНО: структурата на отговорите при тези API-та не е проверявана срещу
 * жив ключ. Четенето на полетата е нарочно толерантно (пробва няколко имена),
 * а при първото пускане скриптът отпечатва по един примерен запис от всеки
 * спорт — сверете го и при разминаване поправете съответния mapper.
 */

import { TZ, toSofia, sleep, addDays } from "./lib.mjs";

const pick = (obj, ...paths) => {
  for (const p of paths) {
    const v = p.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
    if (v != null && v !== "") return v;
  }
  return null;
};

async function get(url, key, label) {
  const r = await fetch(url, { headers: { "x-apisports-key": key } });
  if (r.status === 429) throw new Error(`${label}: изчерпан дневен лимит (429)`);
  if (!r.ok) throw new Error(`${label}: HTTP ${r.status}`);
  const j = await r.json();
  if (j.errors && Object.keys(j.errors).length)
    console.warn(`  ! ${label}: ${JSON.stringify(j.errors)}`);
  return j.response || [];
}

/* Дните се смятат по календара, не през toISOString — иначе близо до
   полунощ в София изпадаше по един ден. */
const datesBetween = (from, days) =>
  Array.from({ length: days }, (_, i) => addDays(from, i));

/* ---------- волейбол ---------- */
export async function volleyball(key, from, days, cfg) {
  const out = [];
  let sampled = false;
  for (const day of datesBetween(from, days)) {
    let rows;
    try { rows = await get(`https://v1.volleyball.api-sports.io/games?date=${day}&timezone=${TZ}`, key, "волейбол " + day); }
    catch (e) { console.warn("  ! " + e.message); continue; }
    if (rows.length && !sampled) {
      console.log("  примерен запис (волейбол):", JSON.stringify(rows[0]).slice(0, 400));
      sampled = true;
    }
    for (const g of rows) {
      const league = pick(g, "league.name") || "Волейбол";
      const country = pick(g, "country.name") || "";
      if (cfg.leagueFilter?.length &&
          !cfg.leagueFilter.some(f => (league + " " + country).toLowerCase().includes(f.toLowerCase())))
        continue;
      const home = pick(g, "teams.home.name") || "?";
      const away = pick(g, "teams.away.name") || "?";
      const t = toSofia(pick(g, "date", "fixture.date")) ||
                { date: day, time: (pick(g, "time") || "00:00").slice(0, 5) };
      const bg = /bulgaria/i.test(home + away);
      out.push({
        source: "api-volleyball", extId: `vb-${pick(g, "id", "game.id") || home + away + day}`,
        date: t.date, time: t.time, sport: "vol",
        comp: league, title: `${home} – ${away}`,
        p: bg ? 3 : (cfg.weight || 2), venue: country, round: "", provisional: false,
      });
    }
    await sleep(200);
  }
  console.log(`  ✓ волейбол: ${out.length} мача`);
  return out;
}

/* ---------- баскетбол ---------- */
export async function basketball(key, from, days, cfg) {
  const out = [];
  let sampled = false;
  for (const day of datesBetween(from, days)) {
    let rows;
    try { rows = await get(`https://v1.basketball.api-sports.io/games?date=${day}&timezone=${TZ}`, key, "баскетбол " + day); }
    catch (e) { console.warn("  ! " + e.message); continue; }
    if (rows.length && !sampled) {
      console.log("  примерен запис (баскетбол):", JSON.stringify(rows[0]).slice(0, 400));
      sampled = true;
    }
    for (const g of rows) {
      const league = pick(g, "league.name") || "Баскетбол";
      const country = pick(g, "country.name") || "";
      if (cfg.leagueFilter?.length &&
          !cfg.leagueFilter.some(f => (league + " " + country).toLowerCase().includes(f.toLowerCase())))
        continue;
      // „NBA“ хваща и „NBA W“ (WNBA) — leagueExclude ги маха
      if (cfg.leagueExclude?.some(f => league.toLowerCase() === f.toLowerCase())) continue;
      const home = pick(g, "teams.home.name") || "?";
      const away = pick(g, "teams.away.name") || "?";
      const t = toSofia(pick(g, "date")) || { date: day, time: "00:00" };
      const bg = /bulgaria/i.test(home + away + country);
      out.push({
        source: "api-basketball", extId: `bb-${pick(g, "id") || home + away + day}`,
        date: t.date, time: t.time, sport: "bas",
        comp: league, title: `${home} – ${away}`,
        p: bg ? 3 : (cfg.weight || 1), venue: country, round: "", provisional: false,
      });
    }
    await sleep(200);
  }
  console.log(`  ✓ баскетбол: ${out.length} мача`);
  return out;
}
