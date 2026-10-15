/**
 * Многозонная VAV: зона = P-регулятор CO₂ → заслонка 0–10 В;
 * вентилятор = Max-Selector по спросу зон.
 */
import { liveDeskDeviceKey } from "./runtime-desk-rules-marks.mjs";

export const VAV_ZONE = "vent_vav_zone";
export const VAV_FAN = "vent_vav_fan";

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

/** % открытия → значение AO Wiren Board (MAO: 0…10000 ≈ 0…10 В). */
export function vavAoFromPercent(pct) {
  const y = Math.max(0, Math.min(100, Number(pct) || 0));
  return Math.round(y * 100);
}

/** Линейная интерполяция CO₂ → % заслонки с клипом. */
export function vavDamperPercent(co2, xmin, xmax, ymin, ymax) {
  const x = Number(co2);
  if (!Number.isFinite(x)) return ymin;
  const lo = Math.min(xmin, xmax);
  const hi = Math.max(xmin, xmax);
  const y0 = Math.max(0, Math.min(100, ymin));
  const y1 = Math.max(y0, Math.min(100, ymax));
  if (x <= lo) return y0;
  if (x >= hi) return y1;
  return y0 + ((x - lo) * (y1 - y0)) / (hi - lo);
}

export function isDeskVavSolution(sol) {
  const sid = String(sol?.solutionId || "");
  return sid === VAV_ZONE || sid === VAV_FAN;
}

function emitHelper() {
  return [
    "function __deskVavY(x, xmin, xmax, ymin, ymax) {",
    "  x = Number(x); if (isNaN(x)) return ymin;",
    "  var lo = Math.min(xmin, xmax), hi = Math.max(xmin, xmax);",
    "  var y0 = Math.max(0, Math.min(100, ymin)), y1 = Math.max(y0, Math.min(100, ymax));",
    "  if (x <= lo) return y0; if (x >= hi) return y1;",
    "  return y0 + (x - lo) * (y1 - y0) / (hi - lo);",
    "}",
    "function __deskVavAo(pct) { return Math.round(Math.max(0, Math.min(100, Number(pct) || 0)) * 100); }",
    "if (typeof global !== 'undefined') {",
    "  if (!global.__deskVavDemand) global.__deskVavDemand = {};",
    "  if (!global.__deskVavFans) global.__deskVavFans = [];",
    "}",
    "function __deskVavPushFan() {",
    "  try {",
    "    var dem = (typeof global !== 'undefined' && global.__deskVavDemand) || {};",
    "    var maxY = 0, k;",
    "    for (k in dem) { if (dem.hasOwnProperty(k)) { var v = Number(dem[k]); if (!isNaN(v) && v > maxY) maxY = v; } }",
    "    var fans = (typeof global !== 'undefined' && global.__deskVavFans) || [];",
    "    for (var i = 0; i < fans.length; i++) {",
    "      var f = fans[i];",
    "      if (!f || !f.path) continue;",
    "      var floor = Number(f.ymin); if (isNaN(floor)) floor = 10;",
    "      var out = Math.max(floor, maxY);",
    "      try { wbActuatorSet(f.path, __deskVavAo(out), f.id, 50); } catch (_e) {}",
    "    }",
    "  } catch (_e2) {}",
    "}",
  ].join("\n");
}

function emitZone(sol) {
  const co2 = pathOf(sol.trigger);
  const damper = pathOf((sol.targets || [])[0]);
  if (!co2 || !damper) return "";
  const p = sol.params || {};
  const xmin = num(p, "xmin", 600);
  const xmax = num(p, "xmax", 1100);
  const ymin = num(p, "ymin", 10);
  const ymax = num(p, "ymax", 100);
  const id = "desk_sol_" + sol.id + "_vavz";
  const key = String(sol.id || "z").replace(/[^a-zA-Z0-9_]/g, "_");
  return [
    `defineRule(${esc(id)}, {`,
    `  whenChanged: ${esc(co2)},`,
    "  then: function () {",
    "    try {",
    `      var y = __deskVavY(readValue(${esc(co2)}), ${xmin}, ${xmax}, ${ymin}, ${ymax});`,
    "      if (typeof global !== 'undefined' && global.__deskVavDemand) global.__deskVavDemand[" + esc(key) + "] = y;",
    `      wbActuatorSet(${esc(damper)}, __deskVavAo(y), ${esc(id)}, 50);`,
    "      __deskVavPushFan();",
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id) + ", e); }",
    "  }",
    "});",
  ].join("\n");
}

function emitFanRegister(sol) {
  const fan = pathOf((sol.targets || [])[0]);
  if (!fan) return "";
  const ymin = num(sol.params || {}, "ymin", 10);
  const id = "desk_sol_" + sol.id + "_vavf";
  return [
    `(function () {`,
    "  if (typeof global === 'undefined') return;",
    "  if (!global.__deskVavFans) global.__deskVavFans = [];",
    `  global.__deskVavFans.push({ path: ${esc(fan)}, ymin: ${ymin}, id: ${esc(id)} });`,
    "  __deskVavPushFan();",
    "})();",
  ].join("\n");
}

/**
 * Один блок на весь pour: helper + зоны + регистрация вентиляторов.
 * @param {object[]} solutions все solutions со стола
 */
export function emitDeskVavBlock(solutions) {
  const list = Array.isArray(solutions) ? solutions : [];
  const zones = list.filter((s) => String(s?.solutionId || "") === VAV_ZONE);
  const fans = list.filter((s) => String(s?.solutionId || "") === VAV_FAN);
  if (!zones.length && !fans.length) return "";
  const parts = [emitHelper()];
  for (const z of zones) {
    const js = emitZone(z);
    if (js) parts.push(js);
  }
  for (const f of fans) {
    const js = emitFanRegister(f);
    if (js) parts.push(js);
  }
  return parts.join("\n\n");
}
