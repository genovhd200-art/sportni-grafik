/**
 * Българският волейбол — от официалната статистика на БФВ
 * (bvf-web.dataproject.com, платформата DataProject). Страниците се
 * генерират на сървъра, затова стига обикновено сваляне, без браузър.
 * robots.txt на сайта не забранява нищо.
 *
 * ID-тата на турнирите се виждат в адреса: CompetitionHome.aspx?ID=65.
 * Сменят се всеки сезон — виж config/fill.json.
 *
 * Часовете на сайта са българско време: „22.10.2026 г. - 19:00“ или „TBD“.
 */
import { pad } from "./lib.mjs";

const BASE = "https://bvf-web.dataproject.com";

const decode = s => s
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/\s+/g, " ").trim();

/* Имената идват с главни букви — „NEFTOHIMIK  2010“ → „Neftohimik 2010“. */
const tidy = s => decode(s).replace(/\s+-\s+/g, "-").toLowerCase()
  .replace(/(^|[\s.-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
  .replace(/\b(Cska|Nsa|Vc|Sk|Vk)\b/g, w => w.toUpperCase());

function parse(html) {
  const P = "RADLIST_Legs_ctrl(\\d+)_RADLIST_Matches_ctrl(\\d+)_";
  const blocks = new Map();
  const grab = (field, re) => {
    for (const m of html.matchAll(re)) {
      const k = `${m[1]}-${m[2]}`;
      if (!blocks.has(k)) blocks.set(k, {});
      const b = blocks.get(k);
      if (b[field] === undefined) b[field] = decode(m[3]);
    }
  };
  grab("when", new RegExp(P + `HF_MatchDatetime" value="([^"]*)"`, "g"));
  // мачовете с линк към отбора са с LBL_*TeamName, другите — с Label2/Label4
  grab("home", new RegExp(P + `(?:LBL_HomeTeamName|Label2)"[^>]*>([^<]*)<`, "g"));
  grab("away", new RegExp(P + `(?:LBL_GuestTeamName|Label4)"[^>]*>([^<]*)<`, "g"));
  grab("hall", new RegExp(P + `LB_Palasport"[^>]*>([^<]*)<`, "g"));
  return [...blocks.entries()].map(([k, b]) => ({ key: k, ...b }));
}

/**
 * @param {Array} comps  [{id, pid?, name, weight, enabled}]
 * @param {string} from  "ГГГГ-ММ-ДД"
 * @param {string} to    "ГГГГ-ММ-ДД"
 * @param {Array<string>} watch  отбори, чиито мачове стават водещи
 */
export async function fromVolleyBG(comps, from, to, watch = []) {
  const W = watch.map(s => s.toLowerCase());
  const out = [];
  for (const c of comps.filter(x => x.enabled !== false)) {
    const url = `${BASE}/CompetitionMatches.aspx?ID=${c.id}` + (c.pid ? `&PID=${c.pid}` : "");
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (sportni-grafik)" } });
    if (!r.ok) throw new Error(`${c.name}: HTTP ${r.status}`);
    const rows = parse(await r.text());
    let kept = 0;
    for (const m of rows) {
      const d = (m.when || "").match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\D+(\d{1,2}):(\d{2})/);
      if (!d || !m.home || !m.away) continue;       // „TBD“ — още без дата
      const date = `${d[3]}-${pad(d[2])}-${pad(d[1])}`;
      if (date < from || date > to) continue;
      const home = tidy(m.home), away = tidy(m.away);
      const hot = W.some(w => (home + " " + away).toLowerCase().includes(w));
      out.push({
        source: "bvf",
        extId: `bvf-${c.id}-${date}-${home}-${away}`.toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, ""),
        date, time: `${pad(d[4])}:${d[5]}`, sport: "vol",
        comp: c.name, title: `${home} – ${away}`,
        p: hot ? 3 : (c.weight || 2),
        venue: m.hall ? tidy(m.hall) : "", round: "", provisional: false,
      });
      kept++;
    }
    console.log(`  ✓ ${c.name}: ${kept} мача в прозореца (от ${rows.length} на страницата)`);
  }
  return out;
}
