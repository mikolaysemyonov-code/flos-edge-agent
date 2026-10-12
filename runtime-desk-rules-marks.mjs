/**
 * Имена контактов из залитых 40_rules*. Не пишем rules — только читаем.
 */
import fs from "node:fs";
import path from "node:path";
import { canonicalDeskShelfKey, formatDeskShelfLabel, isDeskShelfChannelControl } from "./runtime-desk-shelves.mjs";

function deployDir() {
  return (
    process.env.FLOS_WB_RULES_DEPLOY_DIR ||
    process.env.REACTOR_WB_RULES_DEPLOY_DIR ||
    "/etc/wb-rules"
  ).trim();
}

/** controlId → title из defineVirtualDevice cells. */
export function parseCellTitles(source) {
  const titles = {};
  const re = /"([^"]+)":\s*\{\s*type:\s*"[^"]+"\s*,\s*title:\s*"((?:\\.|[^"\\])*)"/g;
  let m;
  while ((m = re.exec(String(source ?? "")))) {
    const id = m[1];
    const title = m[2].replace(/\\"/g, '"').trim();
    if (id && title && !/^FORM LOGIC/i.test(title)) titles[id] = title;
  }
  return titles;
}

/** Live MQTT id: desk/rules often write wb-mr6c-v3_* / wb-mr6c_*. */
export function liveDeskDeviceKey(raw) {
  let s = String(raw ?? "").trim().toLowerCase();
  if (/^wb-mr6c_\d/.test(s)) s = `wb-mr6cu_${s.slice("wb-mr6c_".length)}`;
  if (/^wb-mr6c-v3_/.test(s)) s = `wb-mr6cv3_${s.slice("wb-mr6c-v3_".length)}`;
  if (s.startsWith("wb-mrm2_") && !s.startsWith("wb-mrm2-mini_")) {
    s = `wb-mrm2-mini_${s.slice("wb-mrm2_".length)}`;
  }
  return canonicalDeskShelfKey(s);
}

function putMark(out, deviceKey, controlId, name) {
  const key = liveDeskDeviceKey(deviceKey);
  const cid = String(controlId ?? "").trim();
  const n = String(name ?? "").trim();
  if (!key || !cid || !n) return;
  if (!out[key]) out[key] = {};
  if (!out[key][cid]) out[key][cid] = n;
}

/** Пара controlId → физика из fl_rt_cmd_/fl_rt_mir_ и ячеек title. */
export function parseChannelMarksFromRules(source) {
  const text = String(source ?? "");
  const titles = parseCellTitles(text);
  const out = {};
  const ruleRe =
    /defineRule\s*\(\s*['"](fl_rt_(?:cmd|mir)_)([^'"]+)['"][\s\S]*?(?=defineRule\s*\(|$)/g;
  let m;
  while ((m = ruleRe.exec(text))) {
    const controlId = m[2];
    const chunk = m[0];
    const cell = /['"](wb-[a-z0-9-]+_\d+(?:_\d+)?)\/([^'"]+)['"]/i.exec(chunk);
    if (!cell) continue;
    const title = titles[controlId] || titles[controlId.replace(/_+$/, "")];
    if (title) putMark(out, cell[1], cell[2], title.replace(/\s*·\s*яркость$/i, ""));
  }
  return out;
}

function isIntegratorShardName(name) {
  return /^(00_|15_|20_|30_|40_rules).*\.js$/i.test(name) || name === "40_rules_integrator.js";
}

function listShardFiles() {
  const dir = deployDir();
  try {
    return fs.readdirSync(dir).filter(isIntegratorShardName).map((name) => ({
      filename: name,
      content: fs.readFileSync(path.join(dir, name), "utf8"),
    }));
  } catch {
    return [];
  }
}

export function readPouredChannelMarks() {
  const out = {};
  for (const file of listShardFiles()) {
    try {
      const parsed = parseChannelMarksFromRules(file.content);
      for (const [dev, ch] of Object.entries(parsed)) {
        if (!out[dev]) out[dev] = {};
        Object.assign(out[dev], ch);
      }
    } catch {
      /* skip unreadable shard */
    }
  }
  return out;
}

function uniqueContacts(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const k = `${row.deviceTopicKey}|${row.controlId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  return out;
}

/** Список залитых defineRule без тел: id, имя, контакты. Mirror/bri не дублируем. */
export function parsePouredRuleRows(source, filename) {
  const text = String(source ?? "");
  const titles = parseCellTitles(text);
  const file = String(filename ?? "");
  const rows = [];
  const ruleRe = /defineRule\s*\(\s*['"]([^'"]+)['"][\s\S]*?(?=defineRule\s*\(|$)/g;
  let m;
  while ((m = ruleRe.exec(text))) {
    const id = m[1];
    if (/^fl_rt_(mir|bri|temp)_/.test(id)) continue;
    const contacts = [];
    const cellRe = /['"](wb-[a-z0-9-]+_\d+(?:_\d+)?)\/([^'"]+)['"]/gi;
    let c;
    while ((c = cellRe.exec(m[0]))) {
      const deviceTopicKey = liveDeskDeviceKey(c[1]);
      const controlId = c[2];
      if (!isDeskShelfChannelControl(controlId, deviceTopicKey)) continue;
      contacts.push({ deviceTopicKey, controlId });
    }
    const uniq = uniqueContacts(contacts);
    if (!uniq.length && !/^fl_rt_cmd_/.test(id)) continue;
    const stem = id.replace(/^fl_rt_cmd_/, "");
    const title = (titles[stem] || titles[id] || "").replace(/\s*·\s*яркость$/i, "");
    const kind = /^fl_rt_cmd_/.test(id) ? "marking" : /authored_|nodes_v1_|40_rules/i.test(`${id} ${file}`) ? "user" : "core";
    if (kind === "core") continue;
    rows.push({ id, title, kind, file, contacts: uniq });
  }
  return rows;
}

function scenarioFamilyId(id) {
  return String(id).replace(/_(long|shortlong|hold_release|short|double|release)$/i, "");
}

function humanScenarioTitle(id) {
  if (/dim_hold/i.test(id)) return "Дим-удержание";
  if (/all_off/i.test(id)) return "Все выкл";
  if (/button_toggle/i.test(id)) return "Переключение";
  return "Сценарий";
}

function scenarioHint(r) {
  const di = (r.contacts || []).find((c) => /^Input /i.test(c.controlId));
  const c = di || (r.contacts || [])[0];
  if (!c) return "";
  const sku = formatDeskShelfLabel(c.deviceTopicKey);
  return sku ? `${sku} · ${c.controlId}` : c.controlId;
}

function disambiguateScenarioTitles(rows) {
  const counts = new Map();
  for (const r of rows) {
    if (r.kind !== "user") continue;
    counts.set(r.title, (counts.get(r.title) || 0) + 1);
  }
  return rows.map((r) => {
    if (r.kind !== "user" || (counts.get(r.title) || 0) < 2) return r;
    const hint = scenarioHint(r);
    return hint ? { ...r, title: `${r.title} · ${hint}` } : r;
  });
}

export function collapsePouredRuleRows(rows) {
  const marking = [];
  const groups = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r.kind === "marking") {
      marking.push(r);
      continue;
    }
    const fam = scenarioFamilyId(r.id);
    const prev = groups.get(fam);
    groups.set(fam, {
      id: fam,
      title: humanScenarioTitle(r.id),
      kind: "user",
      file: r.file,
      contacts: uniqueContacts([...(prev?.contacts || []), ...(r.contacts || [])]),
    });
  }
  marking.sort((a, b) => String(a.title).localeCompare(String(b.title), "ru"));
  return disambiguateScenarioTitles(disambiguateMarkingTitles([...marking, ...groups.values()]));
}

function disambiguateMarkingTitles(rows) {
  const counts = new Map();
  for (const r of rows) {
    if (r.kind !== "marking") continue;
    const t = String(r.title ?? "");
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  return rows.map((r) => {
    if (r.kind !== "marking" || (counts.get(r.title) || 0) < 2) return r;
    const knob = r.contacts?.[0]?.controlId;
    return knob ? { ...r, title: `${r.title} · ${knob}` } : r;
  });
}

export const DESK_CARD_IDS = ["light_button_toggle", "light_dim_hold_mcm", "light_all_off"];
export const DESK_CARD_RU = {
  light_button_toggle: "Переключение",
  light_dim_hold_mcm: "Дим-удержание",
  light_all_off: "Все выкл",
};

export function cardsFromHints(hints) {
  const set = new Set(Array.isArray(hints) ? hints : []);
  return DESK_CARD_IDS.filter((id) => set.has(DESK_CARD_RU[id]));
}

/** На полке — имя карточки, без «· Channel 3 · MCM8». */
export function shortPouredHint(title) {
  return String(title || "")
    .replace(/\s*·\s*WB-.+$/i, "")
    .replace(/\s*·\s*(Channel|Input|K)\s+\S+$/i, "")
    .trim();
}

/** Сценарии на контакте: что поправить, без тел rules. */
export function pouredHintsForContact(rules, deviceTopicKey, controlId) {
  const key = liveDeskDeviceKey(deviceTopicKey);
  const cid = String(controlId ?? "").trim();
  if (!key || !cid) return [];
  const titles = [];
  const seen = new Set();
  for (const r of Array.isArray(rules) ? rules : []) {
    if (r.kind === "marking") continue;
    const hit = (r.contacts || []).some(
      (c) => liveDeskDeviceKey(c.deviceTopicKey) === key && String(c.controlId) === cid,
    );
    if (!hit) continue;
    const t = shortPouredHint(r.title);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    titles.push(t);
  }
  return titles;
}

export function readPouredDeskSnapshot() {
  const files = listShardFiles();
  const rules = [];
  for (const file of files) {
    rules.push(...parsePouredRuleRows(file.content, file.filename));
  }
  const collapsed = collapsePouredRuleRows(rules);
  let revisionId = "";
  try {
    const hashPath = (
      process.env.FLOS_WB_RULES_RELEASE_HASH_PATH ||
      process.env.REACTOR_WB_RULES_RELEASE_HASH_PATH ||
      "/etc/formlogic/current_release.hash"
    ).trim();
    revisionId = fs.readFileSync(hashPath, "utf8").trim();
  } catch {
    revisionId = "";
  }
  return {
    revisionId,
    files: files.map((f) => ({ filename: f.filename, bytes: Buffer.byteLength(f.content, "utf8") })),
    rules: collapsed.slice(0, 80),
    ruleCount: collapsed.length,
  };
}
