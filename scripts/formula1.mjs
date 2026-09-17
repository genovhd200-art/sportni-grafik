/**
 * Формула 1 — всички сесии (тренировки, спринт, квалификация, състезание)
 * от Jolpica (api.jolpi.ca), отворения наследник на Ergast. Без ключ.
 *
 * Формула 2 тук я няма — за нея няма такъв отворен API и тя идва от
 * TheSportsDB (само състезанията, често без час).
 */
import { toSofia } from "./lib.mjs";

const SESSIONS = [
  ["FirstPractice", "1-ва тренировка", 1],
  ["SecondPractice", "2-ра тренировка", 1],
  ["ThirdPractice", "3-та тренировка", 1],
  ["SprintQualifying", "Спринт квалификация", 1],
  ["Sprint", "Спринт", 2],
  ["Qualifying", "Квалификация", 2],
];

/**
 * @param {string} from  "ГГГГ-ММ-ДД"
 * @param {string} to    "ГГГГ-ММ-ДД"
 * @param {object} cfg   {name, weight}
 */
export async function fromFormula1(from, to, cfg = {}) {
  const years = [...new Set([from.slice(0, 4), to.slice(0, 4)])];
  const out = [];
  for (const y of years) {
    const r = await fetch(`https://api.jolpi.ca/ergast/f1/${y}.json?limit=100`,
      { headers: { "User-Agent": "sportni-grafik/1.0" } });
    if (!r.ok) throw new Error(`Jolpica ${y}: HTTP ${r.status}`);
    const races = (await r.json()).MRData?.RaceTable?.Races || [];
    for (const race of races) {
      const gp = race.raceName.replace(/ Grand Prix$/, "");
      const list = SESSIONS.filter(([k]) => race[k])
        .map(([k, label, w]) => ({ key: k, label, w, ...race[k] }));
      list.push({ key: "Race", label: "Състезание", w: 3, date: race.date, time: race.time });
      for (const s of list) {
        const t = s.time ? toSofia(`${s.date}T${s.time}`) : { date: s.date, time: "00:00" };
        if (!t || t.date < from || t.date > to) continue;
        out.push({
          source: "jolpica",
          extId: `f1-${race.season}-${race.round}-${s.key}`,
          date: t.date, time: t.time, sport: "mot",
          comp: cfg.name || "Формула 1",
          title: `ГП на ${gp} — ${s.label}`,
          p: Math.min(3, s.w + ((cfg.weight || 2) - 2)),
          venue: race.Circuit?.circuitName || "",
          round: `кръг ${race.round}`,
          provisional: !s.time,
        });
      }
    }
  }
  console.log(`  ✓ ${cfg.name || "Формула 1"}: ${out.length} сесии в прозореца`);
  return out;
}
