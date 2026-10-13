/**
 * Имена стола → ячейки form_logic_os в 00_core. Без облачного компилятора.
 */
import { liveDeskDeviceKey } from "./runtime-desk-rules-marks.mjs";

function esc(s) {
  return JSON.stringify(String(s ?? ""));
}

export function cellId(deviceTopicKey, controlId) {
  const d = liveDeskDeviceKey(deviceTopicKey).replace(/[^a-z0-9]+/gi, "_");
  const c = String(controlId || "")
    .trim()
    .replace(/Channel\s+/i, "ch")
    .replace(/Curtain\s+(\d+)\s+Open/i, "cu$1o")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_|_$/g, "");
  return ("d_" + d + "_" + c).slice(0, 48);
}

function physPath(deviceTopicKey, controlId) {
  return liveDeskDeviceKey(deviceTopicKey) + "/" + String(controlId || "").trim();
}

function isLedChannel(controlId) {
  return /^Channel \d+$/i.test(String(controlId || ""));
}

function patchCellTitle(src, id, title) {
  const needle = `"${id}"`;
  const i = src.indexOf(needle);
  if (i < 0) return { src, changed: false };
  const slice = src.slice(i, i + 280);
  const m = /title:\s*"((?:\\.|[^"\\])*)"/.exec(slice);
  if (!m) return { src, changed: false };
  if (m[1] === title) return { src, changed: false };
  const from = slice.slice(0, m.index) + `title: ${esc(title)}` + slice.slice(m.index + m[0].length);
  return { src: src.slice(0, i) + from + src.slice(i + slice.length), changed: true };
}

/** Rename title on the virtual cell that already bridges this physical path. */
function patchTitleByPhysPath(src, deviceTopicKey, controlId, title) {
  const path = physPath(deviceTopicKey, controlId);
  const re = new RegExp(
    `defineRule\\s*\\(\\s*['"]fl_rt_(?:cmd|mir)_([^'"]+)['"][\\s\\S]*?${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
  );
  const m = re.exec(src);
  if (!m) return { src, changed: false, found: false };
  return { ...patchCellTitle(src, m[1], title), found: true };
}

function emitBridge(deviceTopicKey, controlId, name) {
  const id = cellId(deviceTopicKey, controlId);
  const path = physPath(deviceTopicKey, controlId);
  const cellLines = [];
  const ruleLines = [];
  if (isLedChannel(controlId)) {
    const bri = path + " Brightness";
    const briId = id + "_bri";
    cellLines.push(
      `    ${esc(id)}: { type: "switch", title: ${esc(name)}, value: false },`,
      `    ${esc(briId)}: { type: "range", title: ${esc(name + " · яркость")}, value: 100, max: 100, min: 0 },`,
    );
    ruleLines.push(
      `defineRule(${esc("fl_rt_cmd_" + id)}, {`,
      `  whenChanged: ${esc("form_logic_os/" + id)},`,
      "  then: function () {",
      "    try {",
      `      var on = wbIsOn(readValue(${esc("form_logic_os/" + id)}));`,
      `      var bri = Number(readValue(${esc("form_logic_os/" + briId)}));`,
      "      if (isNaN(bri) || bri < 0) bri = 0; if (bri > 100) bri = 100;",
      "      var wantBr = on ? (bri > 0 ? bri : 80) : 0;",
      `      wbActuatorSet(${esc(bri)}, wantBr, ${esc("fl_rt_cmd_" + id)}, 40);`,
      `      wbActuatorSet(${esc(path)}, on, ${esc("fl_rt_cmd_" + id)}, 40);`,
      `    } catch (e) { if (typeof wbRuleGuardCatch === "function") wbRuleGuardCatch(${esc("fl_rt_cmd_" + id)}, e); }`,
      "  }",
      "});",
      `defineRule(${esc("fl_rt_mir_" + id)}, {`,
      `  whenChanged: [${esc(path)}, ${esc(bri)}],`,
      "  then: function () {",
      "    try {",
      `      var br = Number(readValue(${esc(bri)})); if (isNaN(br)) br = 0;`,
      "      var on = br > 0;",
      `      if (wbIsOn(readValue(${esc("form_logic_os/" + id)})) !== on) dev[${esc("form_logic_os/" + id)}] = on;`,
      `      if (Number(readValue(${esc("form_logic_os/" + briId)})) !== br) dev[${esc("form_logic_os/" + briId)}] = br;`,
      `    } catch (e) { if (typeof wbRuleGuardCatch === "function") wbRuleGuardCatch(${esc("fl_rt_mir_" + id)}, e); }`,
      "  }",
      "});",
    );
  } else {
    cellLines.push(`    ${esc(id)}: { type: "switch", title: ${esc(name)}, value: false },`);
    ruleLines.push(
      `defineRule(${esc("fl_rt_cmd_" + id)}, {`,
      `  whenChanged: ${esc("form_logic_os/" + id)},`,
      "  then: function () {",
      "    try {",
      `      var want = wbIsOn(readValue(${esc("form_logic_os/" + id)}));`,
      `      if (wbIsOn(readValue(${esc(path)})) === want) return;`,
      `      wbActuatorSet(${esc(path)}, want, ${esc("fl_rt_cmd_" + id)}, 40);`,
      `    } catch (e) { if (typeof wbRuleGuardCatch === "function") wbRuleGuardCatch(${esc("fl_rt_cmd_" + id)}, e); }`,
      "  }",
      "});",
      `defineRule(${esc("fl_rt_mir_" + id)}, {`,
      `  whenChanged: ${esc(path)},`,
      "  then: function () {",
      "    try {",
      `      var on = wbIsOn(readValue(${esc(path)}));`,
      `      if (wbIsOn(readValue(${esc("form_logic_os/" + id)})) !== on) dev[${esc("form_logic_os/" + id)}] = on;`,
      `    } catch (e) { if (typeof wbRuleGuardCatch === "function") wbRuleGuardCatch(${esc("fl_rt_mir_" + id)}, e); }`,
      "  }",
      "});",
    );
  }
  return { cellLines, ruleLines };
}

/** @param {string} coreSrc @param {{deviceTopicKey:string,controlId:string,name:string}[]} named */
export function mergeDeskNamesIntoCore(coreSrc, named) {
  let src = String(coreSrc || "");
  if (!/defineVirtualDevice\s*\(\s*["']form_logic_os["']/.test(src)) {
    return { ok: false, error: "no_form_logic_os", content: src, changed: false };
  }
  let changed = false;
  const addCells = [];
  const addRules = [];
  for (const row of named || []) {
    const name = String(row.name || "").trim();
    if (!name || !row.deviceTopicKey || !row.controlId) continue;
    const id = cellId(row.deviceTopicKey, row.controlId);
    if (src.includes(`"${id}"`)) {
      const next = patchCellTitle(src, id, name);
      src = next.src;
      if (next.changed) changed = true;
      continue;
    }
    const byPath = patchTitleByPhysPath(src, row.deviceTopicKey, row.controlId, name);
    if (byPath.found) {
      src = byPath.src;
      if (byPath.changed) changed = true;
      continue;
    }
    const emit = emitBridge(row.deviceTopicKey, row.controlId, name);
    addCells.push(...emit.cellLines);
    addRules.push(...emit.ruleLines);
    changed = true;
  }
  if (addCells.length) {
    const withCells = src.replace(/(cells:\s*\{)/, `$1\n${addCells.join("\n")}`);
    src = withCells !== src ? withCells : src + "\n";
  }
  if (addRules.length) src = src.trimEnd() + "\n\n" + addRules.join("\n") + "\n";
  return { ok: true, content: src, changed };
}
