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

function emitLoad(deviceTopicKey, controlId, name) {
  const id = cellId(deviceTopicKey, controlId);
  const dev = liveDeskDeviceKey(deviceTopicKey);
  const sw = String(controlId || "").trim();
  const cellLines = [];
  if (isLedChannel(controlId)) {
    const briId = id + "_bri";
    cellLines.push(
      `    ${esc(id)}: { type: "switch", title: ${esc(name)}, value: false },`,
      `    ${esc(briId)}: { type: "range", title: ${esc(name + " · яркость")}, value: 100, max: 100, min: 0 },`,
    );
    return {
      id,
      cellLines,
      row: { kind: "dimmer", vSw: id, vBri: briId, pDev: dev, pSw: sw, pBri: sw + " Brightness" },
    };
  }
  cellLines.push(`    ${esc(id)}: { type: "switch", title: ${esc(name)}, value: false },`);
  return { id, cellLines, row: { kind: "relay", vSw: id, pDev: dev, pSw: sw } };
}

function removeDeskRuleBlocks(text, id) {
  const idEsc = String(id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const blockRe = new RegExp(
    `defineRule\\s*\\(\\s*['"]fl_rt_(?:cmd|mir)_${idEsc}['"][\\s\\S]*?\\n\\}\\);\\n?`,
    "g",
  );
  return String(text || "").replace(blockRe, "");
}

function readJsonField(obj, name) {
  const m = new RegExp(name + '\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"').exec(obj);
  if (!m) return "";
  try {
    return JSON.parse('"' + m[1] + '"');
  } catch {
    return m[1];
  }
}

function parseRows(arraySrc, kind) {
  const rows = [];
  for (const m of String(arraySrc || "").matchAll(/\{[^{}]*\}/g)) {
    const vSw = readJsonField(m[0], "vSw");
    if (!vSw) continue;
    const row = { kind, vSw, pDev: readJsonField(m[0], "pDev"), pSw: readJsonField(m[0], "pSw") };
    if (kind === "dimmer") {
      row.vBri = readJsonField(m[0], "vBri");
      row.pBri = readJsonField(m[0], "pBri");
    }
    rows.push(row);
  }
  return rows;
}

function parseMap(src) {
  const block = /\/\/ fl_rt_map_begin\n([\s\S]*?)\/\/ fl_rt_map_end/.exec(String(src || ""));
  if (!block) return { dimmers: [], relays: [] };
  const dim = /var dimmersConfig = \[([\s\S]*?)\];/.exec(block[1]);
  const rel = /var relaysConfig = \[([\s\S]*?)\];/.exec(block[1]);
  return { dimmers: parseRows(dim?.[1] || "", "dimmer"), relays: parseRows(rel?.[1] || "", "relay") };
}

function renderRow(row) {
  if (row.kind === "dimmer") {
    return `  { vSw: ${esc(row.vSw)}, vBri: ${esc(row.vBri)}, pDev: ${esc(row.pDev)}, pSw: ${esc(row.pSw)}, pBri: ${esc(row.pBri)} },`;
  }
  return `  { vSw: ${esc(row.vSw)}, pDev: ${esc(row.pDev)}, pSw: ${esc(row.pSw)} },`;
}

function renderArray(name, rows) {
  if (!rows.length) return `var ${name} = [];`;
  return `var ${name} = [\n${rows.map(renderRow).join("\n")}\n];`;
}

const FL_RT_ENGINE = [
  "dimmersConfig.forEach(function (cfg) {",
  "  var key = cfg.vSw;",
  '  var swTopic = "form_logic_os/" + cfg.vSw;',
  '  var briTopic = "form_logic_os/" + cfg.vBri;',
  '  var pSwTopic = cfg.pDev + "/" + cfg.pSw;',
  '  var pBriTopic = cfg.pDev + "/" + cfg.pBri;',
  '  defineRule("fl_rt_cmd_" + key, {',
  "    whenChanged: [swTopic, briTopic],",
  "    then: function (newValue, devName, cellName) {",
  "      try {",
  "        if (flRtEcho[key]) return;",
  '        var on = wbIsOn(flRtRead("form_logic_os/" + cfg.vSw));',
  '        var bri = Number(flRtRead("form_logic_os/" + cfg.vBri));',
  "        if (isNaN(bri) || bri < 0) bri = 0; if (bri > 100) bri = 100;",
  "        if (cellName === cfg.vBri && !on && bri > 0) {",
  "          on = true;",
  "          flRtEcho[key] = 1;",
  '          dev["form_logic_os"][cfg.vSw] = true;',
  "          setTimeout(function () { flRtEcho[key] = 0; }, 160);",
  "        }",
  "        var wantSw = on ? 1 : 0;",
  "        var wantBr = on ? (bri > 0 ? bri : 100) : 0;",
  '        var curSw = wbIsOn(flRtRead(cfg.pDev + "/" + cfg.pSw)) ? 1 : 0;',
  '        var curBr = Number(flRtRead(cfg.pDev + "/" + cfg.pBri)); if (isNaN(curBr)) curBr = 0;',
  "        if (curSw === wantSw && curBr === wantBr) return;",
  "        flRtEcho[key] = 1;",
  "        if (on) {",
  "          if (bri <= 0) {",
  "            var lastBr = Number(flRtLastBri[key]);",
  "            if (!isNaN(lastBr) && lastBr > 0) { bri = lastBr; wantBr = lastBr; } else { bri = 100; wantBr = 100; }",
  '            dev["form_logic_os"][cfg.vBri] = bri;',
  "          } else {",
  "            flRtLastBri[key] = bri;",
  "          }",
  '          wbActuatorSet(cfg.pDev + "/" + cfg.pBri, wantBr, "fl_rt_cmd_" + key, 50);',
  '          wbActuatorSet(cfg.pDev + "/" + cfg.pSw, true, "fl_rt_cmd_" + key, 50);',
  "        } else {",
  "          if (bri > 0) {",
  "            flRtLastBri[key] = bri;",
  "          } else if (curBr > 0) {",
  "            flRtLastBri[key] = curBr;",
  "          }",
  '          wbActuatorSet(cfg.pDev + "/" + cfg.pBri, 0, "fl_rt_cmd_" + key, 50);',
  '          wbActuatorSet(cfg.pDev + "/" + cfg.pSw, false, "fl_rt_cmd_" + key, 50);',
  "        }",
  "        setTimeout(function () { flRtEcho[key] = 0; }, 160);",
  '      } catch (e) { if (typeof wbRuleGuardCatch === "function") wbRuleGuardCatch("fl_rt_cmd_" + key, e); }',
  "    }",
  "  });",
  '  defineRule("fl_rt_mir_" + key, {',
  "    whenChanged: [pSwTopic, pBriTopic],",
  "    then: function () {",
  "      try {",
  "        if (flRtEcho[key]) return;",
  '        var brNow = Number(flRtRead(cfg.pDev + "/" + cfg.pBri)); if (isNaN(brNow)) brNow = 0;',
  "        var physOn = brNow > 0;",
  "        flRtEcho[key] = 1;",
  '        if (wbIsOn(flRtRead("form_logic_os/" + cfg.vSw)) !== physOn) dev["form_logic_os"][cfg.vSw] = physOn;',
  "        var br = brNow; if (br < 0) br = 0; if (br > 100) br = 100;",
  '        var curBr = Number(flRtRead("form_logic_os/" + cfg.vBri));',
  '        if (physOn && (isNaN(curBr) || curBr !== br)) dev["form_logic_os"][cfg.vBri] = br;',
  "        setTimeout(function () { flRtEcho[key] = 0; }, 200);",
  '      } catch (e) { if (typeof wbRuleGuardCatch === "function") wbRuleGuardCatch("fl_rt_mir_" + key, e); }',
  "    }",
  "  });",
  "});",
  "relaysConfig.forEach(function (cfg) {",
  "  var key = cfg.vSw;",
  '  defineRule("fl_rt_cmd_" + key, {',
  '    whenChanged: "form_logic_os/" + cfg.vSw,',
  "    then: function () {",
  "      try {",
  "        if (flRtEcho[key]) return;",
  '        var want = wbIsOn(flRtRead("form_logic_os/" + cfg.vSw));',
  '        if (wbIsOn(flRtRead(cfg.pDev + "/" + cfg.pSw)) === want) return;',
  "        flRtEcho[key] = 1;",
  '        wbActuatorSet(cfg.pDev + "/" + cfg.pSw, want, "fl_rt_cmd_" + key, 50);',
  "        setTimeout(function () { flRtEcho[key] = 0; }, 120);",
  '      } catch (e) { if (typeof wbRuleGuardCatch === "function") wbRuleGuardCatch("fl_rt_cmd_" + key, e); }',
  "    }",
  "  });",
  '  defineRule("fl_rt_mir_" + key, {',
  '    whenChanged: cfg.pDev + "/" + cfg.pSw,',
  "    then: function () {",
  "      try {",
  "        if (flRtEcho[key]) return;",
  '        var on = wbIsOn(flRtRead(cfg.pDev + "/" + cfg.pSw));',
  '        if (wbIsOn(flRtRead("form_logic_os/" + cfg.vSw)) !== on) {',
  "          flRtEcho[key] = 1;",
  '          dev["form_logic_os"][cfg.vSw] = on;',
  "          setTimeout(function () { flRtEcho[key] = 0; }, 120);",
  "        }",
  '      } catch (e) { if (typeof wbRuleGuardCatch === "function") wbRuleGuardCatch("fl_rt_mir_" + key, e); }',
  "    }",
  "  });",
  "});",
].join("\n");

function renderMap(dimmers, relays) {
  return [
    "// fl_rt_map_begin",
    renderArray("dimmersConfig", dimmers),
    renderArray("relaysConfig", relays),
    FL_RT_ENGINE,
    "// fl_rt_map_end",
  ].join("\n");
}

function installMap(src, dimmers, relays) {
  const block = renderMap(dimmers, relays);
  const re = /\/\/ fl_rt_map_begin\n[\s\S]*?\/\/ fl_rt_map_end/;
  if (re.test(src)) return src.replace(re, block);
  return String(src || "").trimEnd() + "\n\n" + block + "\n";
}

function dropMap(src) {
  return String(src || "").replace(/\n*\/\/ fl_rt_map_begin\n[\s\S]*?\/\/ fl_rt_map_end\n?/g, "\n");
}

function upsertRow(list, row) {
  const i = list.findIndex((r) => r.vSw === row.vSw);
  if (i >= 0) list[i] = row;
  else list.push(row);
}

function dropRow(list, vSw) {
  const i = list.findIndex((r) => r.vSw === vSw);
  if (i >= 0) list.splice(i, 1);
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

function foreignOwnsPath(src, deviceTopicKey, controlId, ownId) {
  const text = dropMap(removeDeskRuleBlocks(src, ownId));
  const path = physPath(deviceTopicKey, controlId);
  if (!path || path.endsWith("/")) return false;
  if (pathQuotedIn(text, path)) return true;
  return isLedChannel(controlId) && pathQuotedIn(text, path + " Brightness");
}

function rememberRow(map, row) {
  if (row.kind === "dimmer") {
    dropRow(map.relays, row.vSw);
    upsertRow(map.dimmers, row);
  } else {
    dropRow(map.dimmers, row.vSw);
    upsertRow(map.relays, row);
  }
}

export function emptyFormLogicOsSource() {
  return [
    'defineVirtualDevice("form_logic_os", {',
    '  title: "FORM LOGIC OS",',
    "  cells: {",
    "  }",
    "});",
    "",
  ].join("\n");
}

/** @param {string} coreSrc @param {{deviceTopicKey:string,controlId:string,name:string}[]} named */
export function mergeDeskNamesIntoCore(coreSrc, named) {
  let src = String(coreSrc || "");
  let changed = false;
  if (!/defineVirtualDevice\s*\(\s*["']form_logic_os["']/.test(src)) {
    const pending = (named || []).some((row) => String(row?.name || "").trim() && row?.deviceTopicKey && row?.controlId);
    if (!pending) {
      return { ok: false, error: "no_form_logic_os", content: src, changed: false, removedIds: [] };
    }
    const base = src.trimEnd();
    src = base ? base + "\n\n" + emptyFormLogicOsSource() : emptyFormLogicOsSource();
    changed = true;
  }
  const addCells = [];
  const removedIds = [];
  const map = parseMap(src);
  const seen = new Set();
  let mapTouched = false;
  for (const row of named || []) {
    const name = String(row.name || "").trim();
    if (!name || !row.deviceTopicKey || !row.controlId) continue;
    if (isDriveClose(row.controlId)) continue;
    const id = cellId(row.deviceTopicKey, row.controlId);
    if (seen.has(id)) continue;
    seen.add(id);
    const load = emitLoad(row.deviceTopicKey, row.controlId, name);
    if (src.includes(`"${id}"`) || src.includes(`'${id}'`)) {
      const next = patchCellTitle(src, id, name);
      src = next.src;
      if (next.changed) changed = true;
      if (foreignOwnsPath(src, row.deviceTopicKey, row.controlId, id)) {
        dropRow(map.dimmers, id);
        dropRow(map.relays, id);
        const stripped = removeCellAndRules(src, id);
        if (stripped !== src) {
          src = stripped;
          changed = true;
          removedIds.push(id, id + "_bri");
        }
        mapTouched = true;
        continue;
      }
      rememberRow(map, load.row);
      mapTouched = true;
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
    addCells.push(...load.cellLines);
    rememberRow(map, load.row);
    mapTouched = true;
    changed = true;
  }
  if (addCells.length) {
    const withCells = src.replace(/(cells:\s*\{)/, `$1\n${addCells.join("\n")}`);
    src = withCells !== src ? withCells : src + "\n";
  }
  if (mapTouched) {
    for (const item of [...map.dimmers, ...map.relays]) {
      const next = removeDeskRuleBlocks(src, item.vSw);
      if (next !== src) {
        src = next;
        changed = true;
      }
    }
    const next = map.dimmers.length || map.relays.length ? installMap(src, map.dimmers, map.relays) : dropMap(src);
    if (next !== src) changed = true;
    src = next;
  }
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
  const echo = ensureFlRtStores(src);
  src = echo.src;
  if (echo.changed) changed = true;
  const help = ensureFlRtHelpers(src);
  src = help.src;
  if (help.changed) changed = true;
  return { ok: true, content: src, changed, removedIds };
}

const FL_RT_HELPERS = [
  "// fl_rt_helpers",
  'if (typeof wbIsOn !== "function") {',
  "  global.__proto__.wbIsOn = function (cur) {",
  '    return cur === true || cur === 1 || cur === "1" || cur === "true" || cur === "ON";',
  "  };",
  "}",
  'if (typeof wbRuleGuardCatch !== "function") {',
  "  global.__proto__.wbRuleGuardCatch = function (ruleId, error) {",
  '    log("[CORE_ERROR] " + ruleId + ": " + error);',
  "  };",
  "}",
  "global.__proto__.flRtRead = function (path) {",
  '  var cell = String(path || "");',
  "  var v;",
  "  try { v = dev[cell]; } catch (e) { v = undefined; }",
  '  if (v !== null && typeof v === "object") {',
  "    try { if (typeof v.getValue === \"function\") return v.getValue(); } catch (e2) {}",
  "  }",
  '  if (v === undefined || (v !== null && typeof v === "object")) {',
  '    var slash = cell.indexOf("/");',
  "    if (slash > 0) {",
  "      try {",
  "        var nested = dev[cell.slice(0, slash)][cell.slice(slash + 1)];",
  '        if (nested !== null && typeof nested === "object" && typeof nested.getValue === "function") return nested.getValue();',
  '        if (nested !== undefined && (nested === null || typeof nested !== "object")) return nested;',
  "      } catch (e3) {}",
  "    }",
  "  }",
  "  return v;",
  "};",
  'if (typeof readValue !== "function") {',
  "  global.__proto__.readValue = function (path) { return flRtRead(path); };",
  "}",
  'if (typeof wbActuatorSet !== "function") {',
  "  global.__proto__.wbActuatorSet = function (path, value, ruleId) {",
  '    var cell = String(path || "");',
  '    var slash = cell.indexOf("/");',
  "    if (slash <= 0) return;",
  "    var deviceId = cell.slice(0, slash);",
  "    var controlId = cell.slice(slash + 1);",
  "    var cur = flRtRead(cell);",
  '    var onOff = controlId.indexOf("Brightness") < 0 && controlId.indexOf("_bri") < 0;',
  "    if (onOff) {",
  "      if (wbIsOn(cur) === wbIsOn(value)) return;",
  '      dev[deviceId][controlId] = wbIsOn(value);',
  "    } else {",
  "      var n = Number(value);",
  "      if (!isNaN(Number(cur)) && Number(cur) === n) return;",
  "      dev[deviceId][controlId] = n;",
  "    }",
  '    log("[FIRE] " + cell + " -> " + value + " rule=" + ruleId);',
  "  };",
  "}",
  "",
].join("\n");

function ensureFlRtHelpers(src) {
  const text = String(src || "");
  if (text.includes("global.__proto__.flRtRead")) return { src: text, changed: false };
  return { src: FL_RT_HELPERS + text, changed: true };
}

function ensureFlRtStores(src) {
  const text = String(src || "");
  if (!/fl_rt_(?:cmd|mir)_/.test(text) || text.includes("var flRtEcho")) {
    return { src: text, changed: false };
  }
  const banner = [
    'var flRtEcho = typeof flRtEcho !== "undefined" ? flRtEcho : {};',
    'var flRtLastBri = typeof flRtLastBri !== "undefined" ? flRtLastBri : {};',
    "",
  ].join("\n");
  const atMap = text.indexOf("// fl_rt_map_begin");
  if (atMap >= 0) return { src: text.slice(0, atMap) + banner + text.slice(atMap), changed: true };
  const at = text.search(/defineRule\s*\(\s*["']fl_rt_/);
  if (at < 0) return { src: text.trimEnd() + "\n\n" + banner, changed: true };
  return { src: text.slice(0, at) + banner + text.slice(at), changed: true };
}
