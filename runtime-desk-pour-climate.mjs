/**
 * Климат со стола → bang-bang defineRule.
 * Абсолютные on/off или желаемая + превышение (пол).
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

function emitHumidityMotion(sol) {
  const humidity = pathOf(sol.trigger);
  const motion = pathOf(sol.aux);
  const loads = (sol.targets || []).map(pathOf).filter(Boolean);
  if (!humidity || !motion || !loads.length) return "";
  const id = "desk_sol_" + sol.id + "_clim";
  const p = sol.params || {};
  const { on, off } = gteBand("vent_humidity", p);
  const latch = "_desk_clim_" + String(sol.id || "").replace(/[^a-zA-Z0-9_]/g, "_");
  return [
    `var ${latch} = false;`,
    `defineRule(${esc(id)}, {`,
    `  whenChanged: [${esc(humidity)}, ${esc(motion)}],`,
    "  then: function () {",
    "    try {",
    `      var v = Number(readValue(${esc(humidity)}));`,
    "      if (isNaN(v)) return;",
    `      var people = wbIsOn(readValue(${esc(motion)}));`,
    `      if (v >= ${on} && people) ${latch} = true;`,
    `      else if (v <= ${off} || !people) ${latch} = false;`,
    `      var __want = ${latch};`,
    setLoads(loads, "__want", id),
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id) + ", e); }",
    "  }",
    "});",
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
    const thr = num(p, "thr", 22);
    const h = Math.max(0.1, num(p, "hyst", 1));
    body = [
      `      var thr = ${thr}; var h = ${h};`,
      `      if (v <= thr) ${latch} = true;`,
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

  return [
    `var ${latch} = false;`,
    `defineRule(${esc(id)}, {`,
    `  whenChanged: ${esc(sensor)},`,
    "  then: function () {",
    "    try {",
    "      var v = Number(readValue(" + esc(sensor) + "));",
    "      if (isNaN(v)) return;",
    body,
    setLoads(loads, "__want", id),
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id) + ", e); }",
    "  }",
    "});",
  ].join("\n");
}
