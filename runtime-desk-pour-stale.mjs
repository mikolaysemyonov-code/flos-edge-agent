/**
 * WB не удаляет ячейки virtual device при сужении defineVirtualDevice.
 * Прячем MQTT-призраки: meta/error = 1.
 * ever-seen = кольцо пушей ∪ прошлые применения — иначе checkout не видит ячейки
 * от промежуточного пуша, которых уже нет в текущем файле на диске.
 */
import fs from "node:fs";
import path from "node:path";

const HIDE_MARK = "flRtHideStaleControls";

function deployDir() {
  return (
    process.env.FLOS_WB_RULES_DEPLOY_DIR ||
    process.env.REACTOR_WB_RULES_DEPLOY_DIR ||
    "/etc/wb-rules"
  ).trim();
}

function everPath() {
  return path.join(deployDir(), ".integrator-backup", "flos-cell-ids.json");
}

export function extractFormLogicOsCellIds(src) {
  const text = String(src || "");
  const m = /defineVirtualDevice\s*\(\s*["']form_logic_os["'][\s\S]*?cells:\s*\{([\s\S]*?)\n\s*\}/.exec(text);
  if (!m) return [];
  const ids = [];
  for (const row of m[1].matchAll(/^\s*["']([^"']+)["']\s*:/gm)) {
    if (row[1]) ids.push(row[1]);
  }
  return ids;
}

export function loadEverFlosIds() {
  try {
    const raw = JSON.parse(fs.readFileSync(everPath(), "utf8"));
    return Array.isArray(raw?.ids) ? raw.ids.map((id) => String(id || "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function saveEverFlosIds(ids) {
  const next = [...new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean))].sort();
  fs.mkdirSync(path.dirname(everPath()), { recursive: true });
  const tmp = `${everPath()}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify({ ids: next, savedAt: new Date().toISOString() }), "utf8");
  fs.renameSync(tmp, everPath());
  return next;
}

/** Ячейки из всех снимков кольца main — чтобы прятать призраки прошлых пушей. */
export function collectFlosIdsFromReleaseRing(ring) {
  const ids = [];
  for (const rel of Array.isArray(ring) ? ring : []) {
    for (const f of rel?.files || []) {
      if (f?.filename !== "00_core.js" || typeof f.content !== "string") continue;
      ids.push(...extractFormLogicOsCellIds(f.content));
    }
  }
  return ids;
}

export function stripStaleHideBlock(src) {
  return String(src || "")
    .replace(
      /\/\/ FL OS — hide stale[\s\S]*?\(function flRtHideStaleControls\(\) \{[\s\S]*?\}\)\(\);\n*/g,
      "",
    )
    .replace(/\n{3,}/g, "\n\n");
}

/** @param {string} src @param {string[]} ghostIds */
export function appendFormLogicOsStaleHide(src, ghostIds) {
  const ghosts = [...new Set((ghostIds || []).map((id) => String(id || "").trim()).filter(Boolean))].sort();
  let text = stripStaleHideBlock(src);
  if (!ghosts.length) return { content: text, changed: text !== String(src || ""), ghostCount: 0 };
  const lines = ghosts.map(
    (id) =>
      `    publish(${JSON.stringify(`/devices/form_logic_os/controls/${id}/meta/error`)}, "1", 0, true);`,
  );
  const block = [
    "",
    "// FL OS — hide stale virtual cells after remapping (MQTT retained ghosts)",
    `(function ${HIDE_MARK}() {`,
    "  try {",
    ...lines,
    '    log("FL OS: hid stale form_logic_os controls");',
    "  } catch (e) {",
    '    log("FL OS stale hide: " + e);',
    "  }",
    "})();",
    "",
  ].join("\n");
  return { content: text.trimEnd() + "\n" + block, changed: true, ghostCount: ghosts.length };
}

/** previousIds \ nextIds — что исчезло из cells и должно скрыться. */
export function staleGhostIds(previousIds, nextIds) {
  const keep = new Set((nextIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  return [...new Set((previousIds || []).map((id) => String(id || "").trim()).filter((id) => id && !keep.has(id)))];
}

/**
 * Собрать ever-seen и спрятать всё лишнее относительно activeIds.
 * @param {string} coreSrc
 * @param {{ beforeIds?: string[], ringIds?: string[], extraIds?: string[], persist?: boolean }} [known]
 */
export function prepareCoreWithStaleHide(coreSrc, known = {}) {
  const activeIds = extractFormLogicOsCellIds(coreSrc);
  const ever = [
    ...loadEverFlosIds(),
    ...(known.beforeIds || []),
    ...(known.ringIds || []),
    ...(known.extraIds || []),
    ...activeIds,
  ];
  if (known.persist !== false) saveEverFlosIds(ever);
  const ghosts = staleGhostIds(ever, activeIds);
  const hid = appendFormLogicOsStaleHide(coreSrc, ghosts);
  return { content: hid.content, ghostCount: hid.ghostCount, activeIds, changed: hid.changed };
}
