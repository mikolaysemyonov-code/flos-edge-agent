/**
 * Инвентарь integrator-шардов на диске: файлы + defineRule из 40_rules*.
 * Без тел файлов в health (только имена и id).
 */

const USER_SHARD_RE = /^40_rules.*\.js$/i;
const DEFINE_RULE_RE = /defineRule\s*\(\s*["']([^"']+)["']/g;
const MAX_IDS = 200;

export function parseDefineRuleIds(source) {
  const ids = [];
  const re = new RegExp(DEFINE_RULE_RE.source, "g");
  let m;
  while ((m = re.exec(String(source ?? "")))) {
    if (m[1]) ids.push(m[1]);
  }
  return ids;
}

function unique(ids) {
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function buildRulesInventory(files, revisionId) {
  const list = Array.isArray(files) ? files : [];
  const userIds = [];
  const fileRows = [];
  for (const file of list) {
    const filename = String(file?.filename ?? "").trim();
    if (!filename) continue;
    const content = String(file?.content ?? "");
    fileRows.push({
      filename,
      bytes: Buffer.byteLength(content, "utf8"),
    });
    if (USER_SHARD_RE.test(filename)) {
      userIds.push(...parseDefineRuleIds(content));
    }
  }
  const uniqueIds = unique(userIds);
  const rev = typeof revisionId === "string" && revisionId.trim() ? revisionId.trim() : null;
  return {
    revisionId: rev,
    files: fileRows,
    userDefineRuleIds: uniqueIds.slice(0, MAX_IDS),
    userDefineRuleCount: uniqueIds.length,
  };
}
