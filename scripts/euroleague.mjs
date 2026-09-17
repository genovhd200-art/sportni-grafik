/**
 * EuroLeague и EuroCup — от официалния публичен API на EuroLeague Basketball
 * (api-live.euroleague.net). Без ключ, целият сезон наведнъж: редовен сезон,
 * плейин, плейофи и финална четворка.
 *
 * Кодове на турнирите: E = EuroLeague, U = EuroCup.
 * Сезонът е „E2026“ за 2026/27 — годината, в която започва.
 */
import { toSofia } from "./lib.mjs";

const BASE = "https://api-live.euroleague.net/v2";

const seasonYear = d => {
  const x = new Date(d + "T12:00:00Z");
  return x.getUTCMonth() >= 6 ? x.getUTCFullYear() : x.getUTCFullYear() - 1;
};

/**
 * @param {Array} comps  [{code:"E", name, weight, enabled}]
 * @param {string} from  "ГГГГ-ММ-ДД"
 * @param {string} to    "ГГГГ-ММ-ДД"
 * @param {Array<string>} watch  отбори, чиито мачове стават водещи
 */
export async function fromEuroleague(comps, from, to, watch = []) {
  const W = watch.map(s => s.toLowerCase());
  const out = [];
  for (const c of comps.filter(x => x.enabled !== false)) {
    const season = `${c.code}${seasonYear(from)}`;
    const r = await fetch(`${BASE}/competitions/${c.code}/seasons/${season}/games`,
      { headers: { Accept: "application/json", "User-Agent": "sportni-grafik/1.0" } });
    if (!r.ok) throw new Error(`${c.name}: HTTP ${r.status}`);
    const j = await r.json();
    let kept = 0;
    for (const g of j.data || []) {
      const t = toSofia(g.utcDate);
      if (!t || t.date < from || t.date > to) continue;
      const club = s => s?.club?.editorialName || s?.club?.name || "?";
      const home = club(g.local), away = club(g.road);
      const hot = W.some(w => (home + " " + away).toLowerCase().includes(w));
      out.push({
        source: "euroleague",
        extId: `el-${g.identifier || g.id}`,
        date: t.date, time: t.time, sport: "bas",
        comp: c.name, title: `${home} – ${away}`,
        p: hot ? 3 : (c.weight || 2),
        venue: g.venue?.name || "",
        round: g.phaseType?.code === "RS" ? `кръг ${g.round}` : (g.phaseType?.name || g.roundName || ""),
        provisional: g.confirmedHour === false,
      });
      kept++;
    }
    console.log(`  ✓ ${c.name}: ${kept} мача в прозореца (от ${(j.data || []).length} за сезона)`);
  }
  return out;
}
