/**
 * Полевой сертификат / resource passport — снимок готовности ритуала на щите.
 */
import { readDeskDocument } from "./runtime-desk-marking.mjs";
import { assessDeskCanPour } from "./runtime-desk-pour.mjs";
import { supportedDeskSolution } from "./runtime-desk-pour-user.mjs";

function namedCount(shelves) {
  let n = 0;
  for (const s of shelves || []) {
    for (const ch of s.channels || []) {
      if (String(ch.name || "").trim()) n += 1;
    }
  }
  return n;
}

/**
 * @param {{ agentVersion?: string, topics?: number, busOk?: boolean, cloudOk?: boolean|null, shelves?: object[] }} live
 */
export function buildFieldCertificate(live = {}) {
  const shelves = Array.isArray(live.shelves) ? live.shelves : [];
  const doc = readDeskDocument();
  const sols = Array.isArray(doc.solutions) ? doc.solutions : [];
  const gate = assessDeskCanPour();
  const named = namedCount(shelves);
  const supported = sols.filter(supportedDeskSolution).length;
  const unsupported = sols.length - supported;
  const topics = Number(live.topics) || 0;
  const busOk = live.busOk === true || topics > 0;
  const checks = [
    { id: "bus", title: "Шина отвечает", ok: busOk, detail: topics ? topics + " топиков" : "нет топиков" },
    { id: "version", title: "Версия агента", ok: Boolean(live.agentVersion), detail: live.agentVersion || "неизвестно" },
    { id: "names", title: "Есть имена в разметке", ok: named > 0, detail: named + " имён" },
    { id: "modules", title: "Модули на шине", ok: shelves.length > 0, detail: shelves.length + " модулей" },
    {
      id: "solutions",
      title: "Типовые на столе льются",
      ok: sols.length === 0 || unsupported === 0,
      detail: sols.length
        ? supported + " готовы" + (unsupported ? " · " + unsupported + " ещё не в заливке" : "")
        : "пока пусто — ок для имён",
    },
    {
      id: "pour",
      title: "Заливка доступна",
      ok: gate.canPourNames || gate.canPourRules || gate.canRepair,
      detail: gate.reason || "—",
    },
  ];
  const passed = checks.filter((c) => c.ok).length;
  const ready = passed === checks.length;
  return {
    ok: true,
    ready,
    passed,
    total: checks.length,
    checks,
    passport: {
      agentVersion: live.agentVersion || "",
      topics,
      modules: shelves.length,
      named,
      solutionsOnDesk: sols.length,
      solutionsPourable: supported,
      canPourNames: Boolean(gate.canPourNames),
      canPourRules: Boolean(gate.canPourRules),
      cloudOk: live.cloudOk == null ? null : Boolean(live.cloudOk),
      stampedAt: new Date().toISOString(),
    },
  };
}
