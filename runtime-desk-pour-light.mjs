/**
 * L1 свет со стола → defineRule (motion/reed/night + dim Auto-Change).
 * DALI-группы: удержание шагает virt _bri/_temp → wrap /flos (не LED Auto-Change).
 */
import { cellId, physPath, virtCell } from "./runtime-desk-pour-core.mjs";
import { deskButtonCounter, deskColonCell } from "./runtime-desk-marking.mjs";
import { liveDeskDeviceKey } from "./runtime-desk-rules-marks.mjs";
import { parseDaliMqttId } from "./runtime-desk-dali.mjs";

const LIGHT = new Set([
  "light_dim_hold_mcm",
  "light_cct_hold",
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
  return physPath(c.deviceTopicKey, c.controlId);
}

function num(params, key, fallback) {
  const n = Number(params?.[key]);
  return Number.isFinite(n) ? n : fallback;
}

function inputBase(trig) {
  const p = pathOf(trig);
  if (!p) return "";
  return p.replace(/\s+(Single|Shortlong|Short|Long|Double)\s+Press Counter$/i, "");
}

function press(trig, kind) {
  const dev = liveDeskDeviceKey(trig?.deviceTopicKey);
  const cid = deskButtonCounter(trig?.controlId, kind, dev);
  if (!dev || !cid) return "";
  return dev + "/" + cid;
}

function isLedChannelPath(path) {
  return /\/Channel \d+$/i.test(String(path || ""));
}

function isSwitchPath(path) {
  const p = String(path || "");
  return /\/K\d+$/i.test(p) || /\/(?:Curtain|Actuator) \d+ (?:Open|Close)$/i.test(p);
}

function virtSet(cell, expr) {
  return `dev["form_logic_os"][${JSON.stringify(cell)}] = ${expr};`;
}

/**
 * LED пишет ячейку: яркость, затем ключ. Мост сам пишет канал.
 * Прямой ключ при яркости 0 мост тут же гасит.
 * 0% — только выключить ключ, яркость ячейки не обнуляем (иначе мост ставит 100).
 * Реле и привод: 0/1 на железо.
 */
export function wbActuatorSetLines(path, pct, ruleId, priority = 50) {
  const p = String(path || "");
  const topic = JSON.stringify(p);
  const id = JSON.stringify(String(ruleId || ""));
  const n = Math.max(0, Math.min(100, Number(pct) || 0));
  const pri = Number(priority) || 50;
  if (isLedChannelPath(p)) {
    const slash = p.indexOf("/");
    const cell = cellId(p.slice(0, slash), p.slice(slash + 1));
    if (n <= 0) return [virtSet(cell, "false")];
    return [virtSet(cell + "_bri", String(n)), virtSet(cell, "true")];
  }
  const mqtt = p.replace(/\/wanted_level$/i, "");
  const dali = parseDaliMqttId(mqtt);
  if (dali && /\/wanted_level$/i.test(p)) {
    const cell = cellId(dali.gateway, dali.channelId);
    if (n <= 0) return [virtSet(cell, "false")];
    return [virtSet(cell + "_bri", String(n)), virtSet(cell, "true")];
  }
  if (isSwitchPath(p)) {
    return [`wbActuatorSet(${topic}, ${n <= 0 ? 0 : 1}, ${id}, ${pri});`];
  }
  return [`wbActuatorSet(${topic}, ${n}, ${id}, ${pri});`];
}

function setLines(paths, pct, ruleId, priority, indent) {
  return paths
    .flatMap((path) => wbActuatorSetLines(path, pct, ruleId, priority))
    .map((line) => indent + line)
    .join("\n");
}

function daliVirtCells(paths) {
  const out = [];
  for (const p of paths || []) {
    const mqtt = String(p || "").replace(/\/wanted_level$/i, "");
    if (!parseDaliMqttId(mqtt)) continue;
    const cell = virtCell(p);
    if (cell) out.push(cell);
  }
  return out;
}

/** Удержание MCM: шаг ячейки form_logic_os, wrap сам бьёт DAPC/DT8. */
function emitDaliRangeHold(sol, suffix, field, spec) {
  const base = inputBase(sol.trigger);
  const long = press(sol.trigger, "Long");
  const shortlong = press(sol.trigger, "Shortlong");
  const cells = daliVirtCells((sol.targets || []).map(pathOf).filter(Boolean));
  if (!base || !long || !shortlong || !cells.length) return "";
  const id = "desk_sol_" + sol.id;
  const timer = "_desk_dali_" + String(sol.id || "x").replace(/[^a-zA-Z0-9_]/g, "_");
  const min = Number(spec.min);
  const max = Number(spec.max);
  const step = Number(spec.step);
  const def = Number(spec.def);
  const tick = (dir) => {
    const n = dir === "inc" ? step : -step;
    const apply = cells
      .map((c) => {
        const topic = JSON.stringify(c + field);
        const sw = JSON.stringify(c);
        return [
          `          var __v = Number(readValue("form_logic_os/" + ${topic}));`,
          `          if (isNaN(__v)) __v = ${def};`,
          `          __v = __v + (${n});`,
          `          if (__v < ${min}) __v = ${min};`,
          `          if (__v > ${max}) __v = ${max};`,
          `          dev["form_logic_os"][${topic}] = __v;`,
          field === "_bri"
            ? `          dev["form_logic_os"][${sw}] = __v > 0;`
            : `          if (__v > 0) dev["form_logic_os"][${sw}] = true;`,
        ].join("\n");
      })
      .join("\n");
    return [
      `      if (${timer}) { try { clearInterval(${timer}); } catch (_c) {} ${timer} = 0; }`,
      apply.replace(/^          /gm, "      "),
      `      ${timer} = setInterval(function () {`,
      "        try {",
      apply,
      "        } catch (_e) {}",
      "      }, 180);",
    ].join("\n");
  };
  return [
    `var ${timer} = 0;`,
    `defineRule(${esc(id + "_" + suffix + "_up")}, {`,
    `  whenChanged: ${esc(long)},`,
    "  then: function () {",
    "    try {",
    tick("inc"),
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id + "_" + suffix + "_up") + ", e); }",
    "  }",
    "});",
    `defineRule(${esc(id + "_" + suffix + "_dn")}, {`,
    `  whenChanged: ${esc(shortlong)},`,
    "  then: function () {",
    "    try {",
    tick("dec"),
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id + "_" + suffix + "_dn") + ", e); }",
    "  }",
    "});",
    `defineRule(${esc(id + "_" + suffix + "_stop")}, {`,
    `  whenChanged: ${esc(base)},`,
    "  then: function () {",
    "    try {",
    `      if (wbIsOn(readValue(${esc(base)}))) return;`,
    `      if (${timer}) { try { clearInterval(${timer}); } catch (_c) {} ${timer} = 0; }`,
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id + "_" + suffix + "_stop") + ", e); }",
    "  }",
    "});",
  ].join("\n");
}

function autoChangeOf(channelPath) {
  const p = String(channelPath || "").trim();
  if (!p) return "";
  if (/\/wanted_level$/i.test(p)) return "";
  const mqtt = p.replace(/\/[^/]+$/, "");
  if (parseDaliMqttId(mqtt)) return "";
  if (/\s+Auto-Change$/i.test(p)) return p;
  if (/\s+Brightness$/i.test(p)) return p.replace(/\s+Brightness$/i, " Auto-Change");
  if (/\/(Channel \d+|CCT\d+)$/i.test(p)) return p + " Auto-Change";
  return p + " Auto-Change";
}

function brightnessOf(channelPath) {
  const p = String(channelPath || "").trim();
  if (/\s+Brightness$/i.test(p)) return p;
  if (/\/(Channel \d+|CCT\d+)$/i.test(p)) return p + " Brightness";
  return "";
}

function emitOnWhenActive(sol, defaults) {
  const when = pathOf(sol.trigger);
  const loads = (sol.targets || []).map(pathOf).filter(Boolean);
  if (!when || !loads.length) return "";
  const id = "desk_sol_" + sol.id + "_on";
  const p = sol.params || {};
  const level = Math.max(0, Math.min(100, num(p, "level", defaults.level)));
  const offDelay = Math.max(0, Math.floor(num(p, "offDelay", defaults.offDelay)));
  const latch = "_desk_hold_" + String(sol.id || "").replace(/[^a-zA-Z0-9_]/g, "_");
  const onSets = setLines(loads, level, id, 50, "        ");
  const offSets = setLines(loads, 0, id, 50, "        ");
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
  const colon = deskColonCell(when);
  const onRead = colon ? "wbIsOn(raw)" : `wbIsOn(readValue(${esc(when)}))`;
  const thenBody = [
    `      var on = ${onRead};`,
    "      if (on) {",
    `        if (${latch}) try { clearTimeout(${latch}); } catch (_e) {}`,
    `        ${latch} = null;`,
    onSets,
    "      } else {",
    offBody,
    "      }",
  ].join("\n");
  const catchLine =
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id) + ", e); }";
  if (colon) {
    return [
      `var ${latch} = null;`,
      "(function () {",
      `  trackMqtt(${esc(colon.topic)}, function (message) {`,
      "    try {",
      '      var raw = message && typeof message === "object" ? message.value : message;',
      thenBody,
      catchLine,
      "  });",
      "})();",
    ].join("\n");
  }
  return [
    `var ${latch} = null;`,
    `defineRule(${esc(id)}, {`,
    `  whenChanged: ${esc(when)},`,
    "  then: function () {",
    "    try {",
    thenBody,
    catchLine,
    "  }",
    "});",
  ].join("\n");
}

/**
 * Long: вверх, а если яркость уже 100 — вниз. Shortlong: вниз.
 * Отпустили (Input → 0) — стоп Auto-Change.
 * Сначала яркость всех линий по первой, потом ключ вкл. Ключ числом не пишем:
 * иначе мост видит Channel при яркости 0 и гасит линию.
 */
function emitDimHold(sol) {
  const dali = emitDaliRangeHold(sol, "ddim", "_bri", { min: 0, max: 100, step: 4, def: 40 });
  const base = inputBase(sol.trigger);
  const long = press(sol.trigger, "Long");
  const shortlong = press(sol.trigger, "Shortlong");
  const loads = (sol.targets || []).map(pathOf).filter(Boolean);
  if (!base || !long || !shortlong || !loads.length) return dali;
  const autos = loads.map(autoChangeOf).filter(Boolean);
  if (!autos.length) return dali;
  const id = "desk_sol_" + sol.id;
  const flag = "__dimSu_" + String(sol.id || "x").replace(/[^a-zA-Z0-9_]/g, "_");
  const firstBri = brightnessOf(loads[0]);
  const arm = [
    firstBri
      ? `      var __bri = Number(readValue(${esc(firstBri)}));`
      : "      var __bri = 0;",
    "      if (isNaN(__bri) || __bri < 0) __bri = 0;",
    "      var __arm = __bri <= 0 ? 1 : __bri;",
    ...loads.map((p) => {
      const b = brightnessOf(p);
      return b ? `      wbActuatorSet(${esc(b)}, __arm, ${esc(id)}, 50);` : "";
    }).filter(Boolean),
    ...loads
      .filter((p) => isLedChannelPath(p))
      .map((p) => `      wbActuatorSet(${esc(p)}, true, ${esc(id)}, 50);`),
  ].join("\n");
  const writeAc = (val, pad) =>
    autos.map((p) => `${pad}wbActuatorSet(${esc(p)}, ${val}, ${esc(id)}, 50);`).join("\n");
  const led = [
    `defineRule(${esc(id + "_dim_up")}, {`,
    `  whenChanged: ${esc(long)},`,
    "  then: function () {",
    "    try {",
    `      if (global.__proto__[${esc(flag)}]) return;`,
    arm,
    "      if (__bri >= 100) {",
    writeAc(AC_DEC, "        "),
    "      } else {",
    writeAc(AC_INC, "        "),
    "      }",
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id + "_dim_up") + ", e); }",
    "  }",
    "});",
    "",
    `defineRule(${esc(id + "_dim_dn")}, {`,
    `  whenChanged: ${esc(shortlong)},`,
    "  then: function () {",
    "    try {",
    `      global.__proto__[${esc(flag)}] = 1;`,
    "      setTimeout(function () { global.__proto__[" + esc(flag) + "] = 0; }, 450);",
    arm,
    writeAc(AC_DEC, "      "),
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id + "_dim_dn") + ", e); }",
    "  }",
    "});",
    "",
    `defineRule(${esc(id + "_dim_stop")}, {`,
    `  whenChanged: ${esc(base)},`,
    "  then: function () {",
    "    try {",
    `      if (wbIsOn(readValue(${esc(base)}))) return;`,
    writeAc(AC_STOP, "      "),
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id + "_dim_stop") + ", e); }",
    "  }",
    "});",
  ].join("\n");
  return dali ? dali + "\n" + led : led;
}

export function isDeskLightSolution(sol) {
  return LIGHT.has(String(sol?.solutionId || ""));
}

export function emitDeskLight(sol) {
  const sid = String(sol?.solutionId || "");
  if (!LIGHT.has(sid)) return "";
  if (sid === "light_cct_hold") {
    return emitDaliRangeHold(sol, "cct", "_temp", { min: 153, max: 500, step: 12, def: 370 });
  }
  if (sid === "light_dim_hold_mcm") return emitDimHold(sol);
  if (sid === "light_night_path") return emitOnWhenActive(sol, { level: 15, offDelay: 45 });
  if (sid === "light_reed_on") return emitOnWhenActive(sol, { level: 100, offDelay: 0 });
  if (sid === "stair_light_motion") return emitOnWhenActive(sol, { level: 100, offDelay: 60 });
  return emitOnWhenActive(sol, { level: 100, offDelay: 0 });
}
