/**
 * Типовые со стола → defineRule в 40_rules_user.
 */
import { cellId } from "./runtime-desk-pour-core.mjs";
import { deskButtonCounter, deskPressEdgeLine } from "./runtime-desk-marking.mjs";
import { liveDeskDeviceKey } from "./runtime-desk-rules-marks.mjs";
import { emitDeskClimate, isDeskClimateSolution } from "./runtime-desk-pour-climate.mjs";
import { emitDeskCron, isDeskCronSolution } from "./runtime-desk-pour-cron.mjs";
import { emitDeskLight, isDeskLightSolution } from "./runtime-desk-pour-light.mjs";
import { emitDeskScene, isDeskSceneSolution } from "./runtime-desk-pour-scenes.mjs";
import { emitDeskVavHelper, emitDeskVavSolution, isDeskVavSolution } from "./runtime-desk-pour-vav.mjs";

const DESK_PREFIX = "desk_sol_";
const SUPPORTED = new Set([
  "light_button_toggle",
  "light_all_off",
  "master_power_off_restore",
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

function buttonWhen(trig, kind) {
  const dev = liveDeskDeviceKey(trig?.deviceTopicKey);
  const cid = deskButtonCounter(trig?.controlId, kind, dev);
  if (!dev || !cid) return "";
  return dev + "/" + cid;
}

function triggerWhen(trig) {
  return buttonWhen(trig, "Short");
}

function longWhen(trig) {
  return buttonWhen(trig, "Long");
}

const RULE_SUFFIXES = [
  "_offrestore",
  "_dim_stop",
  "_dim_up",
  "_dim_dn",
  "_winoff",
  "_toggle",
  "_alloff",
  "_scene",
  "_vavz",
  "_vavf",
  "_stale",
  "_cron",
  "_clim",
  "_curt",
  "_set",
  "_sec",
  "_on",
];

/** desk_sol_<solutionId>_toggle → solutionId. Без суффикса — id целиком (дим). */
export function deskOwnerFromRuleName(ruleName) {
  const name = String(ruleName || "");
  if (!name.startsWith(DESK_PREFIX)) return "";
  const rest = name.slice(DESK_PREFIX.length);
  for (const suf of RULE_SUFFIXES) {
    if (rest.endsWith(suf) && rest.length > suf.length) return rest.slice(0, -suf.length);
  }
  return rest;
}

export function canonDeskSolutionId(solutionId) {
  return String(solutionId || "") === "scene_home" ? "scene_come_home" : String(solutionId || "");
}

function canonSol(sol) {
  if (!sol || typeof sol !== "object") return sol;
  const solutionId = canonDeskSolutionId(sol.solutionId);
  return solutionId === sol.solutionId ? sol : { ...sol, solutionId };
}

function ownedChunk(id, js) {
  const body = String(js || "").trim();
  const owner = String(id || "").trim();
  if (!body || !owner) return "";
  return `// desk_sol_owner:${owner}\n${body}\n// desk_sol_end:${owner}`;
}

function escapeReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dropOwnerBlock(text, id) {
  const owner = escapeReg(id);
  let next = String(text || "").replace(
    new RegExp(`\\n*// desk_sol_owner:${owner}\\n[\\s\\S]*?// desk_sol_end:${owner}\\n?`, "g"),
    "\n",
  );
  next = next.replace(/defineRule\s*\(\s*['"](desk_sol_[^'"]+)['"][\s\S]*?(?=defineRule\s*\(|$)/g, (block, ruleName) =>
    deskOwnerFromRuleName(ruleName) === id ? "" : block,
  );
  const hold = escapeReg(String(id).replace(/[^a-zA-Z0-9_]/g, "_"));
  next = next.replace(new RegExp(`^var _desk_hold_${hold}[^\\n]*\\n?`, "gm"), "");
  return next;
}

function stripDeskRules(src) {
  let text = String(src || "");
  text = text.replace(/\n*\/\/ desk_sol_owner:[^\n]*\n[\s\S]*?\/\/ desk_sol_end:[^\n]*\n?/g, "\n");
  text = text.replace(/^\/\/\s*desk_sol[^\n]*\n?/gm, "");
  text = text.replace(/^var _desk_[^\n]*\n?/gm, "");
  text = text.replace(/function __deskVavY[\s\S]*?function __deskVavPushFan[\s\S]*?\n\}/g, "");
  text = text.replace(/\(function \(\) \{\n {2}if \(typeof global === 'undefined'\) return;\n[\s\S]*?\}\)\(\);\n?/g, "");
  const re = /defineRule\s*\(\s*['"]desk_sol_[^'"]+['"][\s\S]*?(?=defineRule\s*\(|$)/g;
  return text.replace(re, "").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Облачный apply дописывает блоки стола, которых нет во входящем шарде.
 * Не вызывает стол: удаление правила стола делает только заливка стола.
 */
export function preserveDeskRules(previous, incoming) {
  const prev = String(previous || "");
  let next = String(incoming || "");
  const extra = [];
  const marked = /\n*(\/\/ desk_sol_owner:([^\n]+)\n[\s\S]*?\/\/ desk_sol_end:\2\n?)/g;
  let m;
  while ((m = marked.exec(prev))) {
    const owner = m[2];
    if (!next.includes(`// desk_sol_owner:${owner}\n`)) extra.push(m[1].trim());
  }
  const legacy = /defineRule\s*\(\s*['"](desk_sol_[^'"]+)['"][\s\S]*?(?=defineRule\s*\(|$)/g;
  while ((m = legacy.exec(prev))) {
    if (next.includes(m[1])) continue;
    if (extra.some((b) => b.includes(m[1]))) continue;
    extra.push(m[0].trim());
  }
  if (!extra.length) return next;
  return `${next.replace(/\s*$/, "")}\n\n${extra.join("\n\n")}\n`;
}

/** LED: яркость 100/0, иначе канал остаётся на 1%. Реле — как есть. */
function actuatorBool(path, expr, id, priority = 50) {
  const topic = esc(path);
  const rule = esc(id);
  const on = expr === "0" || expr === "1" ? expr : `${expr} ? 1 : 0`;
  const bri = expr === "0" ? "0" : expr === "1" ? "100" : `${expr} ? 100 : 0`;
  if (/\/Channel \d+$/i.test(String(path || ""))) {
    const briLine = `      wbActuatorSet(${esc(path + " Brightness")}, ${bri}, ${rule}, ${priority});`;
    const swLine = `      wbActuatorSet(${topic}, ${on}, ${rule}, ${priority});`;
    // Канал последним оставляет лампу на 1%. Яркость — до и после ключа.
    return [briLine, swLine, briLine].join("\n");
  }
  return `      wbActuatorSet(${topic}, ${on}, ${rule}, ${priority});`;
}

function isLedChannelPath(path) {
  return /\/Channel \d+$/i.test(String(path || ""));
}

/** Как компилятор типовых на Vercel: реле — wbActuatorToggle, лента — яркость затем канал. */
function echoCellKey(path) {
  const i = String(path || "").indexOf("/");
  if (i <= 0) return "";
  return esc(cellId(path.slice(0, i), path.slice(i + 1)));
}

/** Мост form_logic_os не должен затирать запись кнопки, пока она идёт на канал. */
function holdEcho(path, body) {
  const key = echoCellKey(path);
  if (!key) return body;
  return [
    '      if (typeof flRtEcho === "undefined") flRtEcho = {};',
    `      flRtEcho[${key}] = 1;`,
    body,
    `      setTimeout(function () { flRtEcho[${key}] = 0; }, 160);`,
  ].join("\n");
}

function compilerToggle(path, id) {
  const rule = esc(id);
  if (!isLedChannelPath(path)) return `      wbActuatorToggle(${esc(path)}, ${rule}, 50);`;
  const sw = esc(path);
  const dim = esc(path + " Brightness");
  return [
    "      (function () {",
    `        var sw = ${sw};`,
    `        var dim = ${dim};`,
    "        var on = wbIsOn(readValue(sw));",
    "        if (on) {",
    `          wbActuatorSet(dim, 0, ${rule}, 50);`,
    `          wbActuatorSet(sw, false, ${rule}, 50);`,
    "        } else {",
    "          var lv = Number(readValue(dim));",
    "          if (isNaN(lv) || lv <= 0) lv = 100;",
    `          wbActuatorSet(dim, lv, ${rule}, 50);`,
    `          wbActuatorSet(sw, true, ${rule}, 50);`,
    "        }",
    "      })();",
  ].join("\n");
}

function compilerSet(path, on, id) {
  const rule = esc(id);
  if (!isLedChannelPath(path)) return `      wbActuatorSet(${esc(path)}, ${on ? "true" : "false"}, ${rule}, 50);`;
  const sw = esc(path);
  const dim = esc(path + " Brightness");
  if (!on) {
    return [`      wbActuatorSet(${dim}, 0, ${rule}, 50);`, `      wbActuatorSet(${sw}, false, ${rule}, 50);`].join("\n");
  }
  return [`      wbActuatorSet(${dim}, 100, ${rule}, 50);`, `      wbActuatorSet(${sw}, true, ${rule}, 50);`].join("\n");
}

function emitToggle(sol) {
  const id = DESK_PREFIX + sol.id + "_toggle";
  const when = triggerWhen(sol.trigger);
  const loads = (sol.targets || []).map(pathOf).filter(Boolean);
  if (!when || !loads.length) return "";
  const mode = String(sol?.params?.mode || "toggle").toLowerCase();
  const body =
    mode === "off"
      ? loads.map((p) => holdEcho(p, compilerSet(p, false, id))).join("\n")
      : mode === "on"
        ? loads.map((p) => holdEcho(p, compilerSet(p, true, id))).join("\n")
        : loads.map((p) => holdEcho(p, compilerToggle(p, id))).join("\n");
  return [
    `defineRule(${esc(id)}, {`,
    `  whenChanged: ${esc(when)},`,
    "  then: function (newValue) {",
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
  const sets = loads.map((p) => actuatorBool(p, "0", id, 55)).join("\n");
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

/** Short: snapshot levels → OFF; next short: restore. */
function emitMasterOffRestore(sol) {
  const id = DESK_PREFIX + sol.id + "_offrestore";
  const when = triggerWhen(sol.trigger);
  const loads = (sol.targets || []).map(pathOf).filter(Boolean);
  if (!when || !loads.length) return "";
  const flag = "_desk_offrest_" + String(sol.id || "").replace(/[^a-zA-Z0-9_]/g, "_");
  const snap = flag + "_snap";
  const save = loads.map((p) => `        ${snap}[${esc(p)}] = readValue(${esc(p)});`).join("\n");
  const off = loads.map((p) => `        wbActuatorSet(${esc(p)}, 0, ${esc(id)}, 55);`).join("\n");
  const restore = loads
    .map(
      (p) =>
        `        wbActuatorSet(${esc(p)}, ${snap}[${esc(p)}] != null ? ${snap}[${esc(p)}] : 0, ${esc(id)}, 55);`,
    )
    .join("\n");
  return [
    `var ${flag} = false;`,
    `var ${snap} = {};`,
    `defineRule(${esc(id)}, {`,
    `  whenChanged: ${esc(when)},`,
    "  then: function (newValue) {",
    "    try {",
    deskPressEdgeLine(when),
    `      if (!${flag}) {`,
    save,
    off,
    `        ${flag} = true;`,
    "      } else {",
    restore,
    `        ${flag} = false;`,
    "      }",
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
    "  then: function (newValue) {",
    "    try {",
    deskPressEdgeLine(when),
    sets,
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id) + ", e); }",
    "  }",
    "});",
  ].join("\n");
}

export function supportedDeskSolution(sol) {
  const row = canonSol(sol);
  const sid = String(row?.solutionId || "");
  return (
    SUPPORTED.has(sid) ||
    isDeskClimateSolution(row) ||
    isDeskCronSolution(row) ||
    isDeskLightSolution(row) ||
    isDeskSceneSolution(row) ||
    isDeskVavSolution(row)
  );
}

function emitOne(sol) {
  const row = canonSol(sol);
  if (!supportedDeskSolution(row)) return "";
  if (isDeskVavSolution(row)) return emitDeskVavSolution(row);
  const sid = String(row.solutionId || "");
  if (isDeskClimateSolution(row)) return emitDeskClimate(row);
  if (isDeskCronSolution(row)) return emitDeskCron(row);
  if (isDeskLightSolution(row)) return emitDeskLight(row);
  if (isDeskSceneSolution(row)) return emitDeskScene(row);
  if (sid === "light_all_off") return emitAllOff(row);
  if (sid === "master_power_off_restore") return emitMasterOffRestore(row);
  if (sid === "custom_control_task") return emitCustomSet(row);
  return emitToggle(row);
}

function chunksFor(list, { helper }) {
  const chunks = [];
  const rows = list.map(canonSol);
  if (helper && rows.some(isDeskVavSolution)) {
    const js = emitDeskVavHelper();
    if (js) chunks.push(ownedChunk("__vav", js));
  }
  for (const sol of rows) {
    const js = emitOne(sol);
    if (js) chunks.push(ownedChunk(sol.id, js));
  }
  return chunks;
}

function joinUser(base, chunks) {
  const banner = "// desk_sol — типовые со стола LAN\n";
  const body = chunks.length ? banner + chunks.join("\n\n") + "\n" : "";
  return ((base ? base + "\n\n" : "") + body).replace(/\n{3,}/g, "\n\n").trim() + (body || base ? "\n" : "");
}

/**
 * onlyIds: правка или долив этих карточек. Остальные defineRule на диске не переписываются.
 * Без onlyIds — полная пересборка правил стола, чужие (не desk_sol) байты остаются.
 */
export function mergeDeskSolutionsIntoUser(userSrc, solutions, opts = {}) {
  const list = (Array.isArray(solutions) ? solutions : []).map(canonSol).filter(supportedDeskSolution);
  const onlyIds = Array.isArray(opts.onlyIds)
    ? opts.onlyIds.map((id) => String(id || "").trim()).filter(Boolean)
    : null;
  if (!onlyIds) {
    const base = stripDeskRules(userSrc);
    const chunks = chunksFor(list, { helper: true });
    const content = joinUser(base, chunks);
    return {
      content,
      emitted: chunks.filter((c) => !c.startsWith("// desk_sol_owner:__vav\n")).length,
      changed: content.trim() !== String(userSrc || "").trim(),
      solutionIds: list.map((s) => String(s.id)),
    };
  }
  const targets = list.filter((s) => onlyIds.includes(String(s.id)));
  let text = String(userSrc || "");
  for (const sol of targets) text = dropOwnerBlock(text, String(sol.id));
  const needHelper = targets.some(isDeskVavSolution) && !text.includes("function __deskVavY");
  const chunks = chunksFor(targets, { helper: needHelper });
  let content = text.replace(/\n{3,}/g, "\n\n").trim();
  if (chunks.length) {
    if (!content.includes("// desk_sol — типовые со стола LAN")) {
      content = (content ? content + "\n\n" : "") + "// desk_sol — типовые со стола LAN";
    }
    content = content.replace(/\s*$/, "") + "\n\n" + chunks.join("\n\n") + "\n";
  } else {
    content = content ? content.replace(/\s*$/, "") + "\n" : "";
  }
  return {
    content,
    emitted: chunks.filter((c) => !c.startsWith("// desk_sol_owner:__vav\n")).length,
    changed: content.trim() !== String(userSrc || "").trim(),
    solutionIds: targets.map((s) => String(s.id)),
  };
}
