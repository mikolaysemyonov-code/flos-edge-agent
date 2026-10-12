/**
 * Имена контактов из залитых 40_rules*. Не пишем rules — только читаем.
 */
import fs from "node:fs";
import path from "node:path";
import { canonicalDeskShelfKey } from "./runtime-desk-shelves.mjs";

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

function putMark(out, deviceKey, controlId, name) {
  const key = canonicalDeskShelfKey(deviceKey);
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
    /defineRule\s*\(\s*"(fl_rt_(?:cmd|mir)_)([^"]+)"[\s\S]*?(?=defineRule\s*\(|$)/g;
  let m;
  while ((m = ruleRe.exec(text))) {
    const controlId = m[2];
    const chunk = m[0];
    const cell = /"(wb-[a-z0-9-]+_\d+(?:_\d+)?)\/([^"]+)"/i.exec(chunk);
    if (!cell) continue;
    const title = titles[controlId] || titles[controlId.replace(/_+$/, "")];
    if (title) putMark(out, cell[1], cell[2], title.replace(/\s*·\s*яркость$/i, ""));
  }
  return out;
}

export function readPouredChannelMarks() {
  const dir = deployDir();
  const out = {};
  let files = [];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of files) {
    if (!/^40_rules.*\.js$/i.test(name) && name !== "40_rules_integrator.js") continue;
    try {
      const parsed = parseChannelMarksFromRules(fs.readFileSync(path.join(dir, name), "utf8"));
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
