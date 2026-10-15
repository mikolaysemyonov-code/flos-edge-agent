/**
 * Расписание со стола → defineRule({ cron: "m h * * *" }).
 * Время контроллера (Wirenboard); сумерки/рассвет — фиксированные часы, не астрономия.
 */
import { liveDeskDeviceKey } from "./runtime-desk-rules-marks.mjs";

const CRON_ON = new Set([
  "cron_presence_on",
  "outdoor_dusk_on",
  "anti_ice_cron_on",
]);
const CRON_OFF = new Set([
  "cron_all_off",
  "outdoor_dawn_off",
  "anti_ice_cron_off",
]);
const CRON_CURTAIN_CLOSE = new Set(["rollers_evening", "curtain_dusk_close"]);
const CRON_CURTAIN_OPEN = new Set(["curtain_dawn_open"]);

export const DESK_CRON_IDS = new Set([
  ...CRON_ON,
  ...CRON_OFF,
  ...CRON_CURTAIN_CLOSE,
  ...CRON_CURTAIN_OPEN,
]);

function esc(s) {
  return JSON.stringify(String(s ?? ""));
}

function pathOf(c) {
  if (!c?.deviceTopicKey || !c?.controlId) return "";
  return liveDeskDeviceKey(c.deviceTopicKey) + "/" + String(c.controlId).trim();
}

function num(params, key, fallback) {
  const n = Number(params?.[key]);
  return Number.isFinite(n) ? n : fallback;
}

/** @returns {string} five-field cron */
export function deskCronExpr(params, defHh, defMm) {
  const hh = Math.max(0, Math.min(23, Math.round(num(params, "hh", defHh))));
  const mm = Math.max(0, Math.min(59, Math.round(num(params, "mm", defMm))));
  return `${mm} ${hh} * * *`;
}

function defaultsFor(sid) {
  if (sid === "cron_all_off") return { hh: 23, mm: 0, level: 0 };
  if (sid === "cron_presence_on") return { hh: 19, mm: 30, level: 80 };
  if (sid === "outdoor_dusk_on") return { hh: 20, mm: 0, level: 100 };
  if (sid === "outdoor_dawn_off") return { hh: 7, mm: 0, level: 0 };
  if (sid === "anti_ice_cron_on") return { hh: 22, mm: 0, level: 100 };
  if (sid === "anti_ice_cron_off") return { hh: 8, mm: 0, level: 0 };
  if (sid === "rollers_evening" || sid === "curtain_dusk_close") return { hh: 21, mm: 0 };
  if (sid === "curtain_dawn_open") return { hh: 8, mm: 0 };
  return { hh: 12, mm: 0, level: 100 };
}

function payloadOf(pct) {
  const want = Math.max(0, Math.min(100, Number(pct) || 0));
  return want <= 0 ? 0 : want >= 100 ? 1 : want;
}

function emitSet(sol, cron, payload) {
  const loads = (sol.targets || []).map(pathOf).filter(Boolean);
  if (!cron || !loads.length) return "";
  const id = "desk_sol_" + sol.id + "_cron";
  const sets = loads
    .map((p) => `      wbActuatorSet(${esc(p)}, ${payload}, ${esc(id)}, 55);`)
    .join("\n");
  return [
    `defineRule(${esc(id)}, {`,
    `  cron: ${esc(cron)},`,
    "  then: function () {",
    "    try {",
    sets,
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id) + ", e); }",
    "  }",
    "});",
  ].join("\n");
}

function emitCurtainCron(sol, cron, kind) {
  const loads = (sol.targets || []).map(pathOf).filter(Boolean);
  if (!cron || !loads.length) return "";
  const id = "desk_sol_" + sol.id + "_cron";
  const lines = loads.map((p) => {
    let path = p;
    if (kind === "close" && / Open$/i.test(p)) path = p.replace(/ Open$/i, " Close");
    if (kind === "open" && / Close$/i.test(p)) path = p.replace(/ Close$/i, " Open");
    return `      wbActuatorSet(${esc(path)}, 1, ${esc(id)}, 55);`;
  });
  return [
    `defineRule(${esc(id)}, {`,
    `  cron: ${esc(cron)},`,
    "  then: function () {",
    "    try {",
    lines.join("\n"),
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id) + ", e); }",
    "  }",
    "});",
  ].join("\n");
}

export function isDeskCronSolution(sol) {
  return DESK_CRON_IDS.has(String(sol?.solutionId || ""));
}

export function emitDeskCron(sol) {
  const sid = String(sol?.solutionId || "");
  if (!DESK_CRON_IDS.has(sid)) return "";
  const d = defaultsFor(sid);
  const cron = deskCronExpr(sol.params || {}, d.hh, d.mm);
  if (CRON_CURTAIN_CLOSE.has(sid)) return emitCurtainCron(sol, cron, "close");
  if (CRON_CURTAIN_OPEN.has(sid)) return emitCurtainCron(sol, cron, "open");
  if (CRON_OFF.has(sid)) return emitSet(sol, cron, 0);
  const level = num(sol.params, "level", d.level ?? 100);
  return emitSet(sol, cron, payloadOf(level));
}
