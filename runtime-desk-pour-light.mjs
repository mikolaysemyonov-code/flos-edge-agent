/**
 * L1 свет со стола → defineRule (motion/reed/night + dim Auto-Change).
 * Параметры: level (%), offDelay (сек; 0 = гасить сразу при уходе).
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

function num(params, key, fallback) {
  const n = Number(params?.[key]);
  return Number.isFinite(n) ? n : fallback;
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

/** WB-LED switch 0/1; уровень 1…100 пишем как есть (реле трактует >0 как ON). */
function levelPayload(levelPct) {
  const n = Math.max(0, Math.min(100, Number(levelPct) || 0));
  if (n <= 0) return 0;
  if (n >= 100) return 1;
  return n;
}

function emitOnWhenActive(sol, defaults) {
  const when = pathOf(sol.trigger);
  const loads = (sol.targets || []).map(pathOf).filter(Boolean);
  if (!when || !loads.length) return "";
  const id = "desk_sol_" + sol.id + "_on";
  const p = sol.params || {};
  const level = levelPayload(num(p, "level", defaults.level));
  const offDelay = Math.max(0, Math.floor(num(p, "offDelay", defaults.offDelay)));
  const latch = "_desk_hold_" + String(sol.id || "").replace(/[^a-zA-Z0-9_]/g, "_");
  const onSets = loads
    .map((path) => `        wbActuatorSet(${esc(path)}, ${level}, ${esc(id)}, 50);`)
    .join("\n");
  const offSets = loads
    .map((path) => `        wbActuatorSet(${esc(path)}, 0, ${esc(id)}, 50);`)
    .join("\n");
  const offBody =
    offDelay > 0
      ? [
          `      if (${latch}) try { clearTimeout(${latch}); } catch (_e) {}`,
          `      ${latch} = setTimeout(function () {`,
          `        ${latch} = null;`,
          offSets,
          `      }, ${offDelay * 1000});`,
        ].join("\n")
      : offSets;
  return [
    `var ${latch} = null;`,
    `defineRule(${esc(id)}, {`,
    `  whenChanged: ${esc(when)},`,
    "  then: function () {",
    "    try {",
    `      var on = wbIsOn(readValue(${esc(when)}));`,
    "      if (on) {",
    `        if (${latch}) try { clearTimeout(${latch}); } catch (_e) {}`,
    `        ${latch} = null;`,
    onSets,
    "      } else {",
    offBody,
    "      }",
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id) + ", e); }",
    "  }",
    "});",
  ].join("\n");
}

/**
 * Long = вверх, Shortlong = вниз (счётчики MCM), release (Input → 0) = стоп Auto-Change.
 * Перед рампой выравниваем яркость всех линий по первой — иначе разъедутся.
 */
function emitDimHold(sol) {
  const base = inputBase(sol.trigger);
  const long = press(sol.trigger, "Long");
  const shortlong = press(sol.trigger, "Shortlong");
  const loads = (sol.targets || []).map(pathOf).filter(Boolean);
  if (!base || !long || !shortlong || !loads.length) return "";
  const autos = loads.map(autoChangeOf).filter(Boolean);
  if (!autos.length) return "";
  const id = "desk_sol_" + sol.id;
  const first = loads[0];
  const syncFromFirst = [
    `      try {`,
    `        var __cur = Number(readValue(${esc(first)}));`,
    `        if (isNaN(__cur)) __cur = 0;`,
    ...loads.slice(1).map((p) => `        wbActuatorSet(${esc(p)}, __cur, ${esc(id)}, 50);`),
    `      } catch (_e) {}`,
  ].join("\n");
  const writeAc = (val) =>
    autos.map((p) => `      wbActuatorSet(${esc(p)}, ${val}, ${esc(id)}, 50);`).join("\n");
  return [
    `defineRule(${esc(id + "_dim_up")}, {`,
    `  whenChanged: ${esc(long)},`,
    "  then: function () {",
    "    try {",
    syncFromFirst,
    writeAc(AC_INC),
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id + "_dim_up") + ", e); }",
    "  }",
    "});",
    "",
    `defineRule(${esc(id + "_dim_dn")}, {`,
    `  whenChanged: ${esc(shortlong)},`,
    "  then: function () {",
    "    try {",
    syncFromFirst,
    writeAc(AC_DEC),
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id + "_dim_dn") + ", e); }",
    "  }",
    "});",
    "",
    `defineRule(${esc(id + "_dim_stop")}, {`,
    `  whenChanged: ${esc(base)},`,
    "  then: function () {",
    "    try {",
    `      if (wbIsOn(readValue(${esc(base)}))) return;`,
    writeAc(AC_STOP),
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
  if (sid === "light_night_path") return emitOnWhenActive(sol, { level: 15, offDelay: 45 });
  if (sid === "light_reed_on") return emitOnWhenActive(sol, { level: 100, offDelay: 0 });
  if (sid === "stair_light_motion") return emitOnWhenActive(sol, { level: 100, offDelay: 60 });
  return emitOnWhenActive(sol, { level: 100, offDelay: 90 });
}
