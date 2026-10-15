/**
 * Многозонная VAV: зона = P-регулятор CO₂ → заслонка 0–10 В;
 * вентилятор = Max-Selector по спросу зон своей системы (systemId).
 *
 * Fan: maxY > stopBelow → max(ymin, maxY);
 * иначе ждём restDelaySec в «покое» на ymin, потом 0% (антитактование на границе).
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

export function vavSystemId(params) {
  const raw = String(params?.system ?? params?.systemId ?? "pu1").trim().toLowerCase();
  return raw.replace(/[^a-z0-9_-]/g, "") || "pu1";
}

export function vavAoFromPercent(pct) {
  const y = Math.max(0, Math.min(100, Number(pct) || 0));
  return Math.round(y * 100);
}

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

/**
 * @returns {{ out: number, restSince: number }}
 * restSince: 0 = не в покое; >0 = момент входа в покой.
 */
export function vavFanStep(maxZonePct, ymin, stopBelow, restSince, nowMs, restDelayMs) {
  const maxY = Number(maxZonePct) || 0;
  const floor = Math.max(0, Math.min(100, Number(ymin) || 0));
  const rest = Math.max(0, Math.min(100, Number(stopBelow) || 0));
  const delay = Math.max(0, Number(restDelayMs) || 0);
  const now = Number(nowMs) || Date.now();
  if (maxY > rest) {
    return { out: Math.max(floor, Math.min(100, maxY)), restSince: 0 };
  }
  const since = Number(restSince) > 0 ? Number(restSince) : now;
  if (delay > 0 && now - since < delay) {
    return { out: Math.max(floor, maxY), restSince: since };
  }
  return { out: 0, restSince: since };
}

/** @deprecated use vavFanStep — мгновенный стоп без выдержки. */
export function vavFanOutput(maxZonePct, ymin, stopBelow) {
  return vavFanStep(maxZonePct, ymin, stopBelow, 0, Date.now(), 0).out;
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
    "function __deskVavFanStep(maxY, ymin, stopBelow, restSince, now, restDelayMs) {",
    "  maxY = Number(maxY) || 0;",
    "  var floor = Math.max(0, Math.min(100, Number(ymin) || 0));",
    "  var rest = Math.max(0, Math.min(100, Number(stopBelow) || 0));",
    "  var delay = Math.max(0, Number(restDelayMs) || 0);",
    "  now = Number(now) || Date.now();",
    "  if (maxY > rest) return { out: Math.max(floor, Math.min(100, maxY)), restSince: 0 };",
    "  var since = restSince > 0 ? restSince : now;",
    "  if (delay > 0 && now - since < delay) return { out: Math.max(floor, maxY), restSince: since };",
    "  return { out: 0, restSince: since };",
    "}",
    "if (typeof global !== 'undefined') {",
    "  if (!global.__deskVavDemand) global.__deskVavDemand = {};",
    "  if (!global.__deskVavFans) global.__deskVavFans = [];",
    "}",
    "function __deskVavPushFan(sys) {",
    "  try {",
    "    sys = String(sys || 'pu1');",
    "    var dem = (typeof global !== 'undefined' && global.__deskVavDemand && global.__deskVavDemand[sys]) || {};",
    "    var maxY = 0, k;",
    "    for (k in dem) { if (dem.hasOwnProperty(k)) { var v = Number(dem[k]); if (!isNaN(v) && v > maxY) maxY = v; } }",
    "    var fans = (typeof global !== 'undefined' && global.__deskVavFans) || [];",
    "    var now = Date.now();",
    "    for (var i = 0; i < fans.length; i++) {",
    "      var f = fans[i];",
    "      if (!f || !f.path || String(f.sys) !== sys) continue;",
    "      var step = __deskVavFanStep(maxY, f.ymin, f.stopBelow, f.restSince || 0, now, f.restDelayMs || 0);",
    "      f.restSince = step.restSince;",
    "      try { wbActuatorSet(f.path, __deskVavAo(step.out), f.id, 50); } catch (_e) {}",
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
  const sys = vavSystemId(p);
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
    "      if (typeof global !== 'undefined') {",
    "        if (!global.__deskVavDemand) global.__deskVavDemand = {};",
    `        if (!global.__deskVavDemand[${esc(sys)}]) global.__deskVavDemand[${esc(sys)}] = {};`,
    `        global.__deskVavDemand[${esc(sys)}][${esc(key)}] = y;`,
    "      }",
    `      wbActuatorSet(${esc(damper)}, __deskVavAo(y), ${esc(id)}, 50);`,
    `      __deskVavPushFan(${esc(sys)});`,
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id) + ", e); }",
    "  }",
    "});",
  ].join("\n");
}

function emitFanRegister(sol) {
  const fan = pathOf((sol.targets || [])[0]);
  if (!fan) return "";
  const p = sol.params || {};
  const sys = vavSystemId(p);
  const ymin = num(p, "ymin", 10);
  const stopBelow = num(p, "stopBelow", ymin);
  const restDelayMs = Math.max(0, num(p, "restDelay", 180)) * 1000;
  const id = "desk_sol_" + sol.id + "_vavf";
  return [
    `(function () {`,
    "  if (typeof global === 'undefined') return;",
    "  if (!global.__deskVavFans) global.__deskVavFans = [];",
    `  global.__deskVavFans.push({ path: ${esc(fan)}, ymin: ${ymin}, stopBelow: ${stopBelow}, restDelayMs: ${restDelayMs}, restSince: 0, sys: ${esc(sys)}, id: ${esc(id)} });`,
    `  __deskVavPushFan(${esc(sys)});`,
    "  try {",
    `    setInterval(function () { __deskVavPushFan(${esc(sys)}); }, 30000);`,
    "  } catch (_e) {}",
    "})();",
  ].join("\n");
}

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
