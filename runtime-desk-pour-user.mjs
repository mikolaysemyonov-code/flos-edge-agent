/**
 * Типовые со стола → defineRule в 40_rules_user.
 */
import { liveDeskDeviceKey } from "./runtime-desk-rules-marks.mjs";
import { emitDeskClimate, isDeskClimateSolution } from "./runtime-desk-pour-climate.mjs";
import { emitDeskCron, isDeskCronSolution } from "./runtime-desk-pour-cron.mjs";
import { emitDeskLight, isDeskLightSolution } from "./runtime-desk-pour-light.mjs";
import { emitDeskScene, isDeskSceneSolution } from "./runtime-desk-pour-scenes.mjs";
import { emitDeskVavBlock, isDeskVavSolution } from "./runtime-desk-pour-vav.mjs";

const DESK_PREFIX = "desk_sol_";
const SUPPORTED = new Set([
  "light_button_toggle",
  "light_all_off",
  "socket_button_toggle",
  "custom_control_task",
]);

function esc(s) {
  return JSON.stringify(String(s ?? ""));
}

function pathOf(c) {
  if (!c?.deviceTopicKey || !c?.controlId) return "";
  return liveDeskDeviceKey(c.deviceTopicKey) + "/" + String(c.controlId).trim();
}

function triggerWhen(trig) {
  const p = pathOf(trig);
  if (!p) return "";
  if (/\/Input \d+$/i.test(p)) return p + " Short Press Counter";
  return p;
}

function longWhen(trig) {
  const p = pathOf(trig);
  if (!p) return "";
  if (/\/Input \d+$/i.test(p)) return p + " Long Press Counter";
  return p;
}

function stripDeskRules(src) {
  const text = String(src || "");
  const re = /defineRule\s*\(\s*['"]desk_sol_[^'"]+['"][\s\S]*?(?=defineRule\s*\(|$)/g;
  return text.replace(re, "").replace(/\n{3,}/g, "\n\n").trim();
}

function emitToggle(sol) {
  const id = DESK_PREFIX + sol.id + "_toggle";
  const when = triggerWhen(sol.trigger);
  const loads = (sol.targets || []).map(pathOf).filter(Boolean);
  if (!when || !loads.length) return "";
  const mode = String(sol?.params?.mode || "toggle").toLowerCase();
  let body;
  if (mode === "off") {
    body = loads.map((p) => `      wbActuatorSet(${esc(p)}, 0, ${esc(id)}, 50);`).join("\n");
  } else if (mode === "on") {
    body = loads.map((p) => `      wbActuatorSet(${esc(p)}, 1, ${esc(id)}, 50);`).join("\n");
  } else {
    body = [
      `      var next = !wbIsOn(readValue(${esc(loads[0])}));`,
      ...loads.map((p) => `      wbActuatorSet(${esc(p)}, next, ${esc(id)}, 50);`),
    ].join("\n");
  }
  return [
    `defineRule(${esc(id)}, {`,
    `  whenChanged: ${esc(when)},`,
    "  then: function () {",
    "    try {",
    body,
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id) + ", e); }",
    "  }",
    "});",
  ].join("\n");
}

function emitAllOff(sol) {
  const id = DESK_PREFIX + sol.id + "_alloff";
  const when = longWhen(sol.trigger);
  const loads = (sol.targets || []).map(pathOf).filter(Boolean);
  if (!when || !loads.length) return "";
  const sets = loads
    .map((p) => `      wbActuatorSet(${esc(p)}, 0, ${esc(id)}, 55);`)
    .join("\n");
  return [
    `defineRule(${esc(id)}, {`,
    `  whenChanged: ${esc(when)},`,
    "  then: function () {",
    "    try {",
    sets,
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id) + ", e); }",
    "  }",
    "});",
  ].join("\n");
}

function emitCustomSet(sol) {
  const id = DESK_PREFIX + sol.id + "_set";
  const when = triggerWhen(sol.trigger);
  const loads = (sol.targets || []).map(pathOf).filter(Boolean);
  if (!when || !loads.length) return "";
  const val = Number(sol?.params?.val);
  const payload = Number.isFinite(val) ? val : 1;
  const sets = loads
    .map((p) => `      wbActuatorSet(${esc(p)}, ${payload}, ${esc(id)}, 55);`)
    .join("\n");
  return [
    `defineRule(${esc(id)}, {`,
    `  whenChanged: ${esc(when)},`,
    "  then: function () {",
    "    try {",
    sets,
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id) + ", e); }",
    "  }",
    "});",
  ].join("\n");
}

export function supportedDeskSolution(sol) {
  const sid = String(sol?.solutionId || "");
  return (
    SUPPORTED.has(sid) ||
    isDeskClimateSolution(sol) ||
    isDeskCronSolution(sol) ||
    isDeskLightSolution(sol) ||
    isDeskSceneSolution(sol) ||
    isDeskVavSolution(sol)
  );
}

export function mergeDeskSolutionsIntoUser(userSrc, solutions) {
  const base = stripDeskRules(userSrc);
  const list = Array.isArray(solutions) ? solutions : [];
  const chunks = [];
  const vavBlock = emitDeskVavBlock(list);
  if (vavBlock) chunks.push(vavBlock);
  for (const sol of list) {
    if (!supportedDeskSolution(sol) || isDeskVavSolution(sol)) continue;
    const sid = String(sol.solutionId || "");
    let js = "";
    if (isDeskClimateSolution(sol)) js = emitDeskClimate(sol);
    else if (isDeskCronSolution(sol)) js = emitDeskCron(sol);
    else if (isDeskLightSolution(sol)) js = emitDeskLight(sol);
    else if (isDeskSceneSolution(sol)) js = emitDeskScene(sol);
    else if (sid === "light_all_off") js = emitAllOff(sol);
    else if (sid === "custom_control_task") js = emitCustomSet(sol);
    else js = emitToggle(sol);
    if (js) chunks.push(js);
  }
  const banner = "// desk_sol — типовые со стола LAN\n";
  const next = (base ? base + "\n\n" : "") + (chunks.length ? banner + chunks.join("\n\n") + "\n" : "");
  return { content: next, emitted: chunks.length, changed: chunks.length > 0 || base !== String(userSrc || "").trim() };
}
