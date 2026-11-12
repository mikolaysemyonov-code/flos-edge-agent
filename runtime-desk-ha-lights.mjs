/**
 * Свет, который уже переключают правила на щите.
 * Источник — 00_core.js и 40_rules_user.js, не вся шина.
 */
import { formatDeskShelfLabel } from "./runtime-desk-shelves.mjs";

function blockBetween(src, startMark, endMark) {
  const i = src.indexOf(startMark);
  if (i < 0) return "";
  const j = endMark ? src.indexOf(endMark, i + startMark.length) : -1;
  return src.slice(i, j < 0 ? src.length : j);
}

function parseRows(block, kind) {
  const rows = [];
  for (const line of String(block || "").split("\n")) {
    const m = /vSw:\s*"([^"]+)".*?pDev:\s*"([^"]+)".*?pSw:\s*"([^"]+)"/.exec(line);
    if (!m) continue;
    rows.push({ cellId: m[1], deviceTopicKey: m[2], controlId: m[3], kind });
  }
  return rows;
}

function parseTitles(src) {
  const titles = new Map();
  const re = /"(d_[A-Za-z0-9_]+)"\s*:\s*\{\s*type:\s*"switch"\s*,\s*title:\s*"((?:\\.|[^"\\])*)"/g;
  let m;
  while ((m = re.exec(src))) titles.set(m[1], m[2].replace(/\\"/g, '"'));
  return titles;
}

function cellsInRules(src) {
  const ids = new Set();
  const re = /form_logic_os(?:\/|"\]\[")(d_[A-Za-z0-9_]+)/g;
  let m;
  while ((m = re.exec(src))) {
    if (!/_bri$/i.test(m[1])) ids.add(m[1]);
  }
  return ids;
}

function pathsInRules(src) {
  const paths = new Set();
  const re = /wbActuatorSet\(\s*"([^"\n]+)\/(Channel \d+|K\d+)"/g;
  let m;
  while ((m = re.exec(src))) paths.add(m[1] + "\0" + m[2]);
  return paths;
}

/** @returns {{deviceTopicKey:string,controlId:string,cellId:string,kind:string,hardware:string,title:string,named:boolean}[]} */
export function deskHaLights(coreSrc, rulesSrc) {
  const core = String(coreSrc || "");
  const rules = String(rulesSrc || "");
  const dimmers = parseRows(blockBetween(core, "var dimmersConfig", "var relaysConfig"), "dimmer");
  const relays = parseRows(blockBetween(core, "var relaysConfig", "dimmersConfig.forEach"), "relay");
  const byCell = new Map();
  const byPath = new Map();
  for (const row of [...dimmers, ...relays]) {
    if (/^(Curtain|Actuator)\s/i.test(row.controlId)) continue;
    byCell.set(row.cellId, row);
    byPath.set(row.deviceTopicKey + "\0" + row.controlId, row);
  }
  const titles = parseTitles(core);
  const want = new Set();
  for (const id of cellsInRules(rules)) {
    if (byCell.has(id)) want.add(id);
  }
  for (const path of pathsInRules(rules)) {
    const row = byPath.get(path);
    if (row) want.add(row.cellId);
  }
  const lights = [];
  for (const id of want) {
    const row = byCell.get(id);
    const hardware = (formatDeskShelfLabel(row.deviceTopicKey) || row.deviceTopicKey) + " · " + row.controlId;
    const title = titles.get(id) || hardware;
    lights.push({
      deviceTopicKey: row.deviceTopicKey,
      controlId: row.controlId,
      cellId: id,
      kind: row.kind,
      hardware,
      title,
      named: title !== hardware,
    });
  }
  lights.sort((a, b) => a.hardware.localeCompare(b.hardware, "ru", { numeric: true }));
  return lights;
}
