/**
 * WB не удаляет ячейки virtual device при сужении defineVirtualDevice.
 * Прячем MQTT-призраки: meta/error = 1.
 */

const HIDE_MARK = "flRtHideStaleControls";

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
