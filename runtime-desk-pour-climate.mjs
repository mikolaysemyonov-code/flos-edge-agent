/**
 * Климат со стола → bang-bang defineRule.
 * minOn/minOff — антищелчок; staleSec — страховка тёплого пола.
 */
import { liveDeskDeviceKey } from "./runtime-desk-rules-marks.mjs";

const CLIMATE = new Set([
  "vent_humidity",
  "vent_humidity_motion",
  "vent_co2",
  "vent_diy_vav",
  "humidifier_low",
  "warm_floor_comfort",
  "warm_floor_electric_comfort",
  "warm_floor_water_comfort",
  "ac_cool_comfort",
  "ac_window_off",
  "thermostat_simple_vd",
  "weather_climate_link",
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

function modeOf(sid) {
  if (/warm_floor|thermostat/.test(sid)) return "lte";
  if (sid === "humidifier_low") return "range";
  return "gte";
}

function isFloor(sid) {
  return /warm_floor/.test(sid);
}

function gteBand(sid, p) {
  const defOn = sid === "vent_co2" || sid === "vent_diy_vav" ? 1000 : sid === "ac_cool_comfort" ? 25 : sid === "weather_climate_link" ? 24 : 70;
  const defOff = sid === "vent_co2" || sid === "vent_diy_vav" ? 800 : sid === "ac_cool_comfort" ? 24 : sid === "weather_climate_link" ? 23 : 65;
  if (p.on != null || p.off != null) {
    const on = num(p, "on", defOn);
    let off = num(p, "off", defOff);
    if (off >= on) off = on - (sid.includes("co2") || sid === "vent_diy_vav" ? 50 : 1);
    return { on, off };
  }
  const thr = num(p, "thr", defOn);
  const h = Math.max(0.1, num(p, "hyst", sid.includes("co2") || sid === "vent_diy_vav" ? 200 : 5));
  return { on: thr, off: thr - h };
}

function setLoads(loads, wantExpr, id) {
  return loads
    .map((load) =>
      [
        "      try {",
        `        if (wbIsOn(readValue(${esc(load)})) !== !!(${wantExpr})) {`,
        `          wbActuatorSet(${esc(load)}, ${wantExpr}, ${esc(id)}, 50);`,
        "        }",
        "      } catch (_e) {",
        `        wbActuatorSet(${esc(load)}, ${wantExpr}, ${esc(id)}, 50);`,
        "      }",
      ].join("\n"),
    )
    .join("\n");
}

function antiClickGuard(latch, minOnSec, minOffSec) {
  const onMs = Math.max(0, minOnSec) * 1000;
  const offMs = Math.max(0, minOffSec) * 1000;
  if (!onMs && !offMs) return { preface: "", apply: setLoads };
  const tVar = latch + "_t";
  const wantVar = latch + "_w";
  return {
    preface: `var ${tVar} = 0; var ${wantVar} = false;\n`,
    wrap: (loads, id) =>
      [
        `      var __now = Date.now();`,
        `      if (__want !== ${wantVar}) {`,
        `        var __elapsed = __now - ${tVar};`,
        `        if (${wantVar} && ${onMs} && __elapsed < ${onMs}) __want = ${wantVar};`,
        `        else if (!${wantVar} && ${offMs} && __elapsed < ${offMs}) __want = ${wantVar};`,
        `        else { ${wantVar} = __want; ${tVar} = __now; }`,
        `      }`,
        setLoads(loads, "__want", id),
      ].join("\n"),
  };
}

function emitWindowOff(sol) {
  const windowPath = pathOf(sol.trigger);
  const loads = (sol.targets || []).map(pathOf).filter(Boolean);
  if (!windowPath || !loads.length) return "";
  const id = "desk_sol_" + sol.id + "_winoff";
  const sets = loads
    .map((p) => `      if (open) wbActuatorSet(${esc(p)}, 0, ${esc(id)}, 50);`)
    .join("\n");
  return [
    `defineRule(${esc(id)}, {`,
    `  whenChanged: ${esc(windowPath)},`,
    "  then: function () {",
    "    try {",
    `      var open = wbIsOn(readValue(${esc(windowPath)}));`,
    sets,
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id) + ", e); }",
    "  }",
    "});",
  ].join("\n");
}

/**
 * Вытяжка: влажность ИЛИ движение (не AND).
 * Влажность — гистерезис on/off; движение — hold N сек после ухода.
 */
function emitHumidityMotion(sol) {
  const humidity = pathOf(sol.trigger);
  const motion = pathOf(sol.aux);
  const loads = (sol.targets || []).map(pathOf).filter(Boolean);
  if (!humidity || !motion || !loads.length) return "";
  const id = "desk_sol_" + sol.id + "_clim";
  const p = sol.params || {};
  const { on, off } = gteBand("vent_humidity", p);
  const holdMs = Math.max(0, num(p, "motionHold", 300)) * 1000;
  const base = "_desk_clim_" + String(sol.id || "").replace(/[^a-zA-Z0-9_]/g, "_");
  const humLatch = base + "_hum";
  const motionUntil = base + "_mot";
  const latch = base;
  const guard = antiClickGuard(latch, num(p, "minOn", 180), num(p, "minOff", 180));
  const tick = [
    `function ${base}_tick() {`,
    "  try {",
    `    var __want = ${humLatch} || Date.now() < ${motionUntil};`,
    guard.wrap ? guard.wrap(loads, id) : setLoads(loads, "__want", id),
    "  } catch (_e) {}",
    "}",
  ].join("\n");
  return [
    `var ${humLatch} = false;`,
    `var ${motionUntil} = 0;`,
    `var ${latch} = false;`,
    guard.preface || "",
    tick,
    `defineRule(${esc(id)}, {`,
    `  whenChanged: [${esc(humidity)}, ${esc(motion)}],`,
    "  then: function () {",
    "    try {",
    `      var v = Number(readValue(${esc(humidity)}));`,
    "      if (!isNaN(v)) {",
    `        if (v >= ${on}) ${humLatch} = true;`,
    `        else if (v <= ${off}) ${humLatch} = false;`,
    "      }",
    `      if (wbIsOn(readValue(${esc(motion)}))) ${motionUntil} = Date.now() + ${holdMs};`,
    `      ${base}_tick();`,
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id) + ", e); }",
    "  }",
    "});",
    `(function () { try { setInterval(${base}_tick, 15000); } catch (_e) {} })();`,
  ]
    .filter(Boolean)
    .join("\n");
}

function emitFloorStaleWatch(sol, loads, latch, staleSec) {
  if (!staleSec || staleSec <= 0) return "";
  const id = "desk_sol_" + sol.id + "_stale";
  const ts = latch + "_ok";
  const off = loads.map((p) => `      wbActuatorSet(${esc(p)}, false, ${esc(id)}, 50);`).join("\n");
  return [
    `var ${ts} = Date.now();`,
    `(function () {`,
    `  try {`,
    `    setInterval(function () {`,
    `      try {`,
    `        if (Date.now() - ${ts} > ${staleSec * 1000}) {`,
    `          ${latch} = false;`,
    off,
    `        }`,
    `      } catch (_e) {}`,
    `    }, 60000);`,
    `  } catch (_e2) {}`,
    `})();`,
  ].join("\n");
}

export function isDeskClimateSolution(sol) {
  return CLIMATE.has(String(sol?.solutionId || ""));
}

export function emitDeskClimate(sol) {
  const sid = String(sol?.solutionId || "");
  if (!CLIMATE.has(sid)) return "";
  if (sid === "ac_window_off") return emitWindowOff(sol);
  if (sid === "vent_humidity_motion") return emitHumidityMotion(sol);

  const sensor = pathOf(sol.trigger);
  const loads = (sol.targets || []).map(pathOf).filter(Boolean);
  if (!sensor || !loads.length) return "";
  const id = "desk_sol_" + sol.id + "_clim";
  const p = sol.params || {};
  const mode = modeOf(sid);
  const latch = "_desk_clim_" + String(sol.id || "").replace(/[^a-zA-Z0-9_]/g, "_");
  const minOn = num(p, "minOn", /vent_|ac_|humidifier/.test(sid) ? 180 : 60);
  const minOff = num(p, "minOff", /vent_|ac_|humidifier/.test(sid) ? 180 : 60);
  const guard = antiClickGuard(latch, minOn, minOff);
  const staleSec = isFloor(sid) ? num(p, "staleSec", 900) : 0;
  const ts = latch + "_ok";

  let body;
  if (mode === "range") {
    const lo = num(p, "lo", 40);
    const hi = num(p, "hi", 55);
    body = [
      `      if (v <= ${lo}) ${latch} = true;`,
      `      else if (v >= ${hi}) ${latch} = false;`,
      `      var __want = ${latch};`,
    ].join("\n");
  } else if (mode === "lte") {
    // Симметрия: ON при thr−h, OFF при thr+h (желаемая 22 / hyst 1 → вкл ≤21, выкл ≥23).
    const thr = num(p, "thr", 22);
    const h = Math.max(0.1, num(p, "hyst", 1));
    body = [
      `      var thr = ${thr}; var h = ${h};`,
      `      if (v <= thr - h) ${latch} = true;`,
      `      else if (v >= thr + h) ${latch} = false;`,
      `      var __want = ${latch};`,
    ].join("\n");
  } else {
    const { on, off } = gteBand(sid, p);
    body = [
      `      if (v >= ${on}) ${latch} = true;`,
      `      else if (v <= ${off}) ${latch} = false;`,
      `      var __want = ${latch};`,
    ].join("\n");
  }

  const readBlock = staleSec
    ? [
        `      var v = Number(readValue(${esc(sensor)}));`,
        `      if (isNaN(v)) {`,
        `        ${latch} = false;`,
        `        var __want = false;`,
        guard.wrap ? guard.wrap(loads, id) : setLoads(loads, "__want", id),
        `        return;`,
        `      }`,
        `      ${ts} = Date.now();`,
      ].join("\n")
    : [
        `      var v = Number(readValue(${esc(sensor)}));`,
        `      if (isNaN(v)) return;`,
      ].join("\n");

  return [
    `var ${latch} = false;`,
    guard.preface || "",
    emitFloorStaleWatch(sol, loads, latch, staleSec),
    `defineRule(${esc(id)}, {`,
    `  whenChanged: ${esc(sensor)},`,
    "  then: function () {",
    "    try {",
    readBlock,
    body,
    guard.wrap ? guard.wrap(loads, id) : setLoads(loads, "__want", id),
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id) + ", e); }",
    "  }",
    "});",
  ]
    .filter(Boolean)
    .join("\n");
}
