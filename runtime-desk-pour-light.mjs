/**
 * L1 свет со стола → defineRule (motion/reed/night + dim Auto-Change).
 */
import { liveDeskDeviceKey } from "./runtime-desk-rules-marks.mjs";

const LIGHT = new Set([
  "light_dim_hold_mcm",
  "light_motion",
  "light_reed_on",
  "light_night_path",
  "stair_light_motion",
]);

const AC_STOP = 0;
const AC_DEC = 1;
const AC_INC = 2;

function esc(s) {
  return JSON.stringify(String(s ?? ""));
}

function pathOf(c) {
  if (!c?.deviceTopicKey || !c?.controlId) return "";
  return liveDeskDeviceKey(c.deviceTopicKey) + "/" + String(c.controlId).trim();
}

function inputBase(trig) {
  const p = pathOf(trig);
  if (!p) return "";
  return p.replace(/\s+(Short|Long|Shortlong|Double)\s+Press Counter$/i, "");
}

function press(trig, kind) {
  const base = inputBase(trig);
  if (!base) return "";
  if (/\/Input \d+$/i.test(base)) return base + " " + kind + " Press Counter";
  return base;
}

function autoChangeOf(channelPath) {
  const p = String(channelPath || "").trim();
  if (!p) return "";
  if (/\s+Auto-Change$/i.test(p)) return p;
  if (/\s+Brightness$/i.test(p)) return p.replace(/\s+Brightness$/i, " Auto-Change");
  if (/\/(Channel \d+|CCT\d+)$/i.test(p)) return p + " Auto-Change";
  return p + " Auto-Change";
}

function emitOnWhenActive(sol, soft) {
  const when = pathOf(sol.trigger);
  const loads = (sol.targets || []).map(pathOf).filter(Boolean);
  if (!when || !loads.length) return "";
  const id = "desk_sol_" + sol.id + "_on";
  const level = soft ? 15 : 1;
  const sets = loads
    .map((p) => `      if (on) wbActuatorSet(${esc(p)}, ${level}, ${esc(id)}, 50);`)
    .join("\n");
  return [
    `defineRule(${esc(id)}, {`,
    `  whenChanged: ${esc(when)},`,
    "  then: function () {",
    "    try {",
    `      var on = wbIsOn(readValue(${esc(when)}));`,
    sets,
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id) + ", e); }",
    "  }",
    "});",
  ].join("\n");
}

function emitDimHold(sol) {
  const base = inputBase(sol.trigger);
  const long = press(sol.trigger, "Long");
  const shortlong = press(sol.trigger, "Shortlong");
  const loads = (sol.targets || []).map(pathOf).filter(Boolean);
  if (!base || !long || !shortlong || !loads.length) return "";
  const autos = loads.map(autoChangeOf).filter(Boolean);
  if (!autos.length) return "";
  const id = "desk_sol_" + sol.id;
  const write = (val) =>
    autos.map((p) => `      wbActuatorSet(${esc(p)}, ${val}, ${esc(id)}, 50);`).join("\n");
  return [
    `defineRule(${esc(id + "_dim_up")}, {`,
    `  whenChanged: ${esc(long)},`,
    "  then: function () {",
    "    try {",
    write(AC_INC),
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id + "_dim_up") + ", e); }",
    "  }",
    "});",
    "",
    `defineRule(${esc(id + "_dim_dn")}, {`,
    `  whenChanged: ${esc(shortlong)},`,
    "  then: function () {",
    "    try {",
    write(AC_DEC),
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id + "_dim_dn") + ", e); }",
    "  }",
    "});",
    "",
    `defineRule(${esc(id + "_dim_stop")}, {`,
    `  whenChanged: ${esc(base)},`,
    "  then: function () {",
    "    try {",
    `      if (wbIsOn(readValue(${esc(base)}))) return;`,
    write(AC_STOP),
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id + "_dim_stop") + ", e); }",
    "  }",
    "});",
  ].join("\n");
}

export function isDeskLightSolution(sol) {
  return LIGHT.has(String(sol?.solutionId || ""));
}

export function emitDeskLight(sol) {
  const sid = String(sol?.solutionId || "");
  if (!LIGHT.has(sid)) return "";
  if (sid === "light_dim_hold_mcm") return emitDimHold(sol);
  if (sid === "light_night_path") return emitOnWhenActive(sol, true);
  return emitOnWhenActive(sol, false);
}
