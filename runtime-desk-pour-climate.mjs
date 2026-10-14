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

export function isDeskClimateSolution(sol) {
  return CLIMATE.has(String(sol?.solutionId || ""));
}

export function emitDeskClimate(sol) {
  const sid = String(sol?.solutionId || "");
  if (!CLIMATE.has(sid)) return "";
  const sensor = pathOf(sol.trigger);
  const load = pathOf((sol.targets || [])[0]);
  if (!sensor || !load) return "";
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
    "      try {",
    "        if (wbIsOn(readValue(" + esc(load) + ")) !== !!__want) {",
    `          wbActuatorSet(${esc(load)}, __want, ${esc(id)}, 50);`,
    "        }",
    "      } catch (_e) {",
    `        wbActuatorSet(${esc(load)}, __want, ${esc(id)}, 50);`,
    "      }",
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id) + ", e); }",
    "  }",
    "});",
  ].join("\n");
}
