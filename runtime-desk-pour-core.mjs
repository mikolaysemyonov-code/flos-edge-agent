/**
 * Имена стола → titles в существующем form_logic_os.
 * Новые ячейки не плодим, если физика уже в 00_core — иначе дубли в UI.
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
    .replace(/Actuator\s+(\d+)\s+Open/i, "ac$1o")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_|_$/g, "");
  return ("d_" + d + "_" + c).slice(0, 48);
}

export function physPath(deviceTopicKey, controlId) {
  return liveDeskDeviceKey(deviceTopicKey) + "/" + String(controlId || "").trim();
}

function isDriveClose(controlId) {
  return /^(Curtain|Actuator)\s+\d+\s+Close$/i.test(String(controlId || "").trim());
}

function isLedChannel(controlId) {
  return /^Channel \d+$/i.test(String(controlId || ""));
}

/** Физика уже в ядре — только переименовать title, не добавлять desk_* ячейку. */
export function pathAlreadyInCore(src, deviceTopicKey, controlId) {
  const path = physPath(deviceTopicKey, controlId);
  if (!path || path.endsWith("/")) return false;
  if (src.includes(`"${path}"`) || src.includes(`'${path}'`)) return true;
  if (isLedChannel(controlId)) {
    const bri = path + " Brightness";
    if (src.includes(`"${bri}"`) || src.includes(`'${bri}'`)) return true;
  }
  return false;
}

function patchCellTitle(src, id, title) {
  const needle = `"${id}"`;
  const i = src.indexOf(needle);
  if (i < 0) return { src, changed: false };
  const slice = src.slice(i, i + 320);
  const m = /title:\s*"((?:\\.|[^"\\])*)"/.exec(slice);
  if (!m) return { src, changed: false };
  if (m[1] === title) return { src, changed: false };
  const from = slice.slice(0, m.index) + `title: ${esc(title)}` + slice.slice(m.index + m[0].length);
  return { src: src.slice(0, i) + from + src.slice(i + slice.length), changed: true };
}

function cellIdForPhysPath(src, deviceTopicKey, controlId) {
  const path = physPath(deviceTopicKey, controlId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `defineRule\\s*\\(\\s*['"]fl_rt_(?:cmd|mir)_([^'"]+)['"][\\s\\S]{0,1200}?["']${path}["']`,
  );
  const m = re.exec(src);
  return m ? m[1] : "";
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
  return { id, cellLines, ruleLines };
}

function pathQuotedIn(src, path) {
  return src.includes(`"${path}"`) || src.includes(`'${path}'`);
}

function removeCellAndRules(text, id) {
  const idEsc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const blockRe = new RegExp(
    `defineRule\\s*\\(\\s*['"]fl_rt_(?:cmd|mir)_${idEsc}['"][\\s\\S]*?(?=defineRule\\s*\\(|$)`,
    "g",
  );
  let next = text.replace(blockRe, "");
  const cellRe = new RegExp(`\\s*${esc(id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*\\{[^}]*\\},?\\n?`);
  const briRe = new RegExp(
    `\\s*${esc(id + "_bri").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*\\{[^}]*\\},?\\n?`,
  );
  next = next.replace(cellRe, "\n").replace(briRe, "\n");
  return next;
}

/** Close-близнец шторы даёт второй title с тем же именем — выкидываем. */
export function stripDriveCloseBridges(src) {
  let text = String(src || "");
  const removedIds = [];
  for (const m of text.matchAll(/defineRule\s*\(\s*['"]fl_rt_cmd_([^'"]+)['"]([\s\S]*?)(?=defineRule\s*\(|$)/g)) {
    const id = m[1];
    const body = m[2] || "";
    if (!id || !/["']wb-[^"']+\/(?:Curtain|Actuator) \d+ Close["']/.test(body)) continue;
    text = removeCellAndRules(text, id);
    removedIds.push(id, id + "_bri");
  }
  return { content: text.replace(/\n{3,}/g, "\n\n"), changed: removedIds.length > 0, removedIds };
}

/**
 * Убрать desk_* мосты, если та же физика уже есть у «облачной» ячейки.
 * Иначе после пуша в FORM LOGIC OS два одинаковых title.
 */
export function stripDuplicateDeskBridges(src) {
  let text = String(src || "");
  const deskCmd = [...text.matchAll(/defineRule\s*\(\s*['"]fl_rt_cmd_(d_[^'"]+)['"]/g)].map((m) => m[1]);
  let changed = false;
  const removedIds = [];
  for (const id of deskCmd) {
    const idEsc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const blockRe = new RegExp(
      `defineRule\\s*\\(\\s*['"]fl_rt_(?:cmd|mir)_${idEsc}['"][\\s\\S]*?(?=defineRule\\s*\\(|$)`,
      "g",
    );
    const blocks = [...text.matchAll(blockRe)].map((m) => m[0]);
    const paths = [...blocks.join("\n").matchAll(/["'](wb-[^"']+\/[^"']+)["']/g)].map((m) => m[1]);
    if (!paths.length) continue;
    const bases = [...new Set(paths.map((p) => p.replace(/ Brightness$/i, "")))];
    const withoutDesk = text.replace(blockRe, "");
    const stillHas = bases.some((p) => pathQuotedIn(withoutDesk, p));
    if (!stillHas) continue;
    text = removeCellAndRules(text, id);
    removedIds.push(id, id + "_bri");
    changed = true;
  }
  return { content: text.replace(/\n{3,}/g, "\n\n"), changed, removedIds };
}

/**
 * Если на один phys path два fl_rt_cmd — оставить не-desk (или первый), остальное выкинуть.
 */
export function stripDuplicatePhysPathBridges(src) {
  let text = String(src || "");
  const byPath = new Map();
  for (const m of text.matchAll(/defineRule\s*\(\s*['"]fl_rt_cmd_([^'"]+)['"]([\s\S]*?)(?=defineRule\s*\(|$)/g)) {
    const id = m[1];
    const paths = [...m[2].matchAll(/["'](wb-[^"']+\/[^"']+)["']/g)].map((x) =>
      x[1].replace(/ Brightness$/i, ""),
    );
    for (const p of paths) {
      if (!byPath.has(p)) byPath.set(p, []);
      byPath.get(p).push(id);
    }
  }
  const removedIds = [];
  for (const ids of byPath.values()) {
    const uniq = [...new Set(ids)];
    if (uniq.length < 2) continue;
    const keep = uniq.find((id) => !id.startsWith("d_")) || uniq[0];
    for (const id of uniq) {
      if (id === keep) continue;
      text = removeCellAndRules(text, id);
      removedIds.push(id, id + "_bri");
    }
  }
  return { content: text.replace(/\n{3,}/g, "\n\n"), changed: removedIds.length > 0, removedIds };
}

/**
 * Два одинаковых title в FORM LOGIC OS (как «Кухня · Штора» ×2) — оставить не-desk.
 */
export function stripDuplicateTitles(src) {
  let text = String(src || "");
  const cells = /defineVirtualDevice\s*\(\s*["']form_logic_os["'][\s\S]*?cells:\s*\{([\s\S]*?)\n\s*\}/.exec(text);
  if (!cells) return { content: text, changed: false, removedIds: [] };
  const byTitle = new Map();
  for (const m of cells[1].matchAll(/^\s*["']([^"']+)["']\s*:\s*\{[^}]*?\btitle:\s*"((?:\\.|[^"\\])*)"/gm)) {
    const id = m[1];
    const title = m[2];
    if (!id || !title || / · яркость$/.test(title)) continue;
    if (!byTitle.has(title)) byTitle.set(title, []);
    byTitle.get(title).push(id);
  }
  const removedIds = [];
  for (const ids of byTitle.values()) {
    const uniq = [...new Set(ids)];
    if (uniq.length < 2) continue;
    const keep = uniq.find((id) => !String(id).startsWith("d_")) || uniq[0];
    for (const id of uniq) {
      if (id === keep) continue;
      text = removeCellAndRules(text, id);
      removedIds.push(id, id + "_bri");
    }
  }
  return { content: text.replace(/\n{3,}/g, "\n\n"), changed: removedIds.length > 0, removedIds };
}

/** @param {string} coreSrc @param {{deviceTopicKey:string,controlId:string,name:string}[]} named */
export function mergeDeskNamesIntoCore(coreSrc, named) {
  let src = String(coreSrc || "");
  if (!/defineVirtualDevice\s*\(\s*["']form_logic_os["']/.test(src)) {
    return { ok: false, error: "no_form_logic_os", content: src, changed: false, removedIds: [] };
  }
  let changed = false;
  const addCells = [];
  const addRules = [];
  const removedIds = [];
  for (const row of named || []) {
    const name = String(row.name || "").trim();
    if (!name || !row.deviceTopicKey || !row.controlId) continue;
    if (isDriveClose(row.controlId)) continue;
    const id = cellId(row.deviceTopicKey, row.controlId);
    if (src.includes(`"${id}"`) || src.includes(`'${id}'`)) {
      const next = patchCellTitle(src, id, name);
      src = next.src;
      if (next.changed) changed = true;
      continue;
    }
    if (pathAlreadyInCore(src, row.deviceTopicKey, row.controlId)) {
      const existing = cellIdForPhysPath(src, row.deviceTopicKey, row.controlId);
      if (existing) {
        const next = patchCellTitle(src, existing, name);
        src = next.src;
        if (next.changed) changed = true;
      }
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
  for (const step of [
    stripDriveCloseBridges,
    stripDuplicateDeskBridges,
    stripDuplicatePhysPathBridges,
    stripDuplicateTitles,
  ]) {
    const stripped = step(src);
    if (stripped.changed) {
      src = stripped.content;
      removedIds.push(...(stripped.removedIds || []));
      changed = true;
    }
  }
  return { ok: true, content: src, changed, removedIds };
}
