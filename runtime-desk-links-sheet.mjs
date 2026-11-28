/**
 * Карта связей со стола сценариев: выключатель → действие → нагрузки.
 */
import { mqttControlTopic, workbookXlsx } from "./runtime-desk-passport.mjs";
import { deskSolutionCatalog, listDeskSolutions } from "./runtime-desk-solutions.mjs";

export const DESK_LINKS_HEADERS = ["Топик выключателя", "Действие", "Топики нагрузок"];

function pressTail(sol) {
  const p = String(sol?.params?.press || "").toLowerCase();
  if (p === "double") return " · двойное";
  if (p === "long") return " · долгое";
  if (p === "shortlong") return " · короткое и долгое";
  return "";
}

/** Колонка «что делает»: переключает / диммирует / иное. */
export function deskLinkAction(sol) {
  const id = String(sol?.solutionId || "");
  const tail = pressTail(sol);
  if (id === "light_dim_hold_mcm") return "диммирует" + tail;
  if (id === "light_cct_hold") return "диммирует и цвет" + tail;
  if (id === "audio_volume_hold") return "диммирует громкость" + tail;
  if (id === "light_button_toggle" || id === "socket_button_toggle" || id === "audio_toggle") {
    const mode = String(sol?.params?.mode || "toggle").toLowerCase();
    if (mode === "on") return "включает" + tail;
    if (mode === "off") return "выключает" + tail;
    return "переключает" + tail;
  }
  if (id === "light_all_off" || id === "cron_all_off" || id === "master_power_off_restore") return "гасит" + tail;
  if (id === "scene_astro_on") return "включает до заката, гасит после восхода";
  const titles = new Map((deskSolutionCatalog() || []).map((c) => [c.id, c.title]));
  return titles.get(id) || sol?.title || id || "иное";
}

function topicOf(c) {
  if (!c?.deviceTopicKey || !c?.controlId) return "";
  return mqttControlTopic(c.deviceTopicKey, c.controlId);
}

export function deskLinkRows(solutions = listDeskSolutions()) {
  return (Array.isArray(solutions) ? solutions : []).map((sol) => [
    topicOf(sol?.trigger),
    deskLinkAction(sol),
    (Array.isArray(sol?.targets) ? sol.targets : []).map(topicOf).filter(Boolean).join("; "),
  ]);
}

export function deskLinksXlsx(solutions) {
  return workbookXlsx([
    {
      name: "Связи",
      headers: DESK_LINKS_HEADERS,
      rows: deskLinkRows(solutions),
    },
  ]);
}
