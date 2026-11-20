/**
 * Группы нагрузок стола: несколько приводов → одна ячейка FORM LOGIC OS.
 */
import { isDeskDriveControl } from "./runtime-desk-shelves.mjs";
import { liveDeskDeviceKey } from "./runtime-desk-rules-marks.mjs";
import { patchDeskDocument, readDeskDocument } from "./runtime-desk-marking.mjs";

function pairOpen(id) {
  const m = /^((?:Curtain|Actuator)\s+\d+\s+)Close$/i.exec(String(id || "").trim());
  return m ? m[1] + "Open" : String(id || "").trim();
}

function pairClose(id) {
  const m = /^((?:Curtain|Actuator)\s+\d+\s+)Open$/i.exec(String(id || "").trim());
  return m ? m[1] + "Close" : String(id || "").trim();
}

function esc(s) {
  return JSON.stringify(String(s ?? ""));
}

export function curtainGroupCellId(id) {
  return ("g_cu_" + String(id || "").replace(/[^a-zA-Z0-9]+/g, "_")).replace(/_+/g, "_").slice(0, 48);
}

export function listDeskLoadGroups() {
  const rows = readDeskDocument().loadGroups;
  return Array.isArray(rows) ? rows : [];
}

export function upsertDeskLoadGroup(input) {
  const room = String(input?.room || "").trim();
  const type = String(input?.type || "Штора").trim() || "Штора";
  const members = (Array.isArray(input?.members) ? input.members : [])
    .map((m) => ({
      deviceTopicKey: liveDeskDeviceKey(m?.deviceTopicKey),
      controlId: pairOpen(m?.controlId),
    }))
    .filter((m) => m.deviceTopicKey && isDeskDriveControl(m.controlId));
  if (!room) return { ok: false, error: "need_room" };
  if (!members.length) return { ok: false, error: "need_members" };
  const seen = new Set();
  const uniq = [];
  for (const m of members) {
    const k = m.deviceTopicKey + "\0" + m.controlId;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(m);
  }
  const title = room + " · " + type;
  const id = String(input?.id || "").trim() || `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const row = { id, kind: "curtain", room, type, title, members: uniq };
  const next = listDeskLoadGroups().filter((g) => g && g.id !== id);
  next.push(row);
  const written = patchDeskDocument({ loadGroups: next });
  if (written?.ok === false) return written;
  return { ok: true, group: row, groups: next };
}

export function deleteDeskLoadGroup(id) {
  const want = String(id || "").trim();
  if (!want) return { ok: false, error: "need_id" };
  const next = listDeskLoadGroups().filter((g) => g && g.id !== want);
  const written = patchDeskDocument({ loadGroups: next });
  if (written?.ok === false) return written;
  return { ok: true, groups: next };
}

function emitGroupEngine(g) {
  const cell = curtainGroupCellId(g.id);
  const opens = g.members.map((m) => liveDeskDeviceKey(m.deviceTopicKey) + "/" + pairOpen(m.controlId));
  const closes = g.members.map((m) => liveDeskDeviceKey(m.deviceTopicKey) + "/" + pairClose(m.controlId));
  const openList = opens.map((p) => esc(p)).join(", ");
  const closeList = closes.map((p) => esc(p)).join(", ");
  return [
    `defineRule("fl_rt_cmd_${cell}", {`,
    `  whenChanged: "form_logic_os/${cell}",`,
    "  then: function () {",
    "    try {",
    "      if (typeof flRtReady !== \"undefined\" && !flRtReady) return;",
    `      if (flRtEcho[${esc(cell)}]) return;`,
    `      var want = wbIsOn(readValue("form_logic_os/${cell}"));`,
    `      var paths = want ? [${openList}] : [${closeList}];`,
    `      flRtEcho[${esc(cell)}] = 1;`,
    `      for (var i = 0; i < paths.length; i++) wbActuatorSet(paths[i], 1, "fl_rt_cmd_${cell}", 50);`,
    `      setTimeout(function () { flRtEcho[${esc(cell)}] = 0; }, 400);`,
    `    } catch (e) { if (typeof wbRuleGuardCatch === "function") wbRuleGuardCatch("fl_rt_cmd_${cell}", e); }`,
    "  }",
    "});",
    `defineRule("fl_rt_mir_${cell}", {`,
    `  whenChanged: [${openList}],`,
    "  then: function () {",
    "    try {",
    `      if (flRtEcho[${esc(cell)}]) return;`,
    "      var on = false;",
    `      var opens = [${openList}];`,
    "      for (var i = 0; i < opens.length; i++) if (wbIsOn(readValue(opens[i]))) on = true;",
    `      if (wbIsOn(readValue("form_logic_os/${cell}")) !== on) {`,
    `        flRtEcho[${esc(cell)}] = 1;`,
    `        dev["form_logic_os"][${esc(cell)}] = on;`,
    `        setTimeout(function () { flRtEcho[${esc(cell)}] = 0; }, 200);`,
    "      }",
    `    } catch (e) { if (typeof wbRuleGuardCatch === "function") wbRuleGuardCatch("fl_rt_mir_${cell}", e); }`,
    "  }",
    "});",
  ].join("\n");
}

export function installDeskCurtainGroups(src, groups) {
  let text = String(src || "").replace(/\n*\/\/ fl_rt_cgrp_begin\n[\s\S]*?\/\/ fl_rt_cgrp_end\n?/g, "\n");
  const rows = (groups || []).filter((g) => g && g.kind === "curtain" && g.title && (g.members || []).length);
  if (!rows.length) return { content: text, changed: text !== String(src || "") };
  if (!/defineVirtualDevice\(\s*["']form_logic_os["']/.test(text)) {
    text = 'defineVirtualDevice("form_logic_os", {\n  title: "FORM LOGIC OS",\n  cells: {\n  }\n});\n' + text;
  }
  const cells = [];
  const engines = [];
  for (const g of rows) {
    const id = curtainGroupCellId(g.id);
    if (!text.includes(`"${id}"`) && !text.includes(`'${id}'`)) {
      cells.push(`    ${esc(id)}: { type: "switch", title: ${esc(g.title)}, value: false, forceDefault: true },`);
    }
    engines.push(emitGroupEngine(g));
  }
  if (cells.length) {
    const withCells = text.replace(/(cells:\s*\{)/, `$1\n${cells.join("\n")}`);
    if (withCells !== text) text = withCells;
  }
  const block = ["// fl_rt_cgrp_begin", ...engines, "// fl_rt_cgrp_end"].join("\n");
  text = String(text).trimEnd() + "\n\n" + block + "\n";
  return { content: text, changed: true };
}
