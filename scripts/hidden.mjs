/**
 * Какво е махнато от дъската — за да не го връща тегленето.
 *
 * Редакторът маха мач или цял турнир и публикува
 * docs/data/assignments.json. Оттам идват:
 *   hidden        { extId: true }        — махнати мачове
 *   hiddenComps   { ключ: "Име" }        — махнати турнири, и занапред
 *
 * Махнат турнир изобщо не се тегли (пести и заявки към безплатните API-та).
 */
import { readJSON } from "./lib.mjs";

const key = c => String(c || "").trim().toLowerCase();

export async function loadHidden() {
  const a = (await readJSON("docs/data/assignments.json", {})) || {};
  const ids = new Set(Object.keys(a.hidden || {}));
  const comps = new Set(Object.keys(a.hiddenComps || {}));
  return {
    ids, comps,
    /** Махнат ли е този турнир? */
    comp: name => comps.has(key(name)),
    /** Махнато ли е това събитие? */
    event: ev => ids.has(ev.extId) || comps.has(key(ev.comp)),
    names: [...new Set(Object.values(a.hiddenComps || {}))],
  };
}
