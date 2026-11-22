/**
 * CSV разметки: выгрузка каналов щита → Excel → заливка имён обратно.
 */
import { upsertDeskShelfMark } from "./runtime-desk-marking.mjs";
import { completeDeskModuleChannels, formatDeskShelfLabel } from "./runtime-desk-shelves.mjs";

const HEAD = ["zone", "module", "device", "control", "topic", "kind", "name", "cards"];

function csvCell(value) {
  const s = String(value ?? "");
  if (/[",;\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function markSheetRows(shelves) {
  const rows = [];
  for (const shelf of completeDeskModuleChannels(shelves || [])) {
    const device = String(shelf?.deviceTopicKey || "").trim();
    if (!device) continue;
    const module = formatDeskShelfLabel(device) || device;
    for (const ch of Array.isArray(shelf.channels) ? shelf.channels : []) {
      const control = String(ch?.controlId || "").trim();
      if (!control) continue;
      const name = String(ch?.name || ch?.title || "").trim();
      const dot = name.indexOf(" · ");
      rows.push({
        zone: dot > 0 ? name.slice(0, dot).trim() : "",
        module,
        device,
        control,
        topic: `/devices/${device}/controls/${control}`,
        kind: String(ch?.kind || ""),
        name,
        cards: Array.isArray(ch?.cards) ? ch.cards.join(",") : "",
      });
    }
  }
  return rows;
}

export function markSheetCsv(rows) {
  const lines = [HEAD.join(";")];
  for (const r of rows) lines.push(HEAD.map((k) => csvCell(r[k])).join(";"));
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

function splitCsvLine(line, sep) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export function parseMarkSheetCsv(text) {
  const raw = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = raw.split("\n").filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = lines[0].includes(";") ? ";" : ",";
  const head = splitCsvLine(lines[0], sep).map((h) => h.trim().toLowerCase());
  const idx = (name) => head.indexOf(name);
  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line, sep);
    const get = (name) => {
      const i = idx(name);
      return i >= 0 ? String(cells[i] || "").trim() : "";
    };
    const device = get("device");
    const control = get("control");
    if (!device || !control) continue;
    let name = get("name");
    const zone = get("zone");
    if (zone && name && !name.includes(" · ")) name = `${zone} · ${name}`;
    else if (zone && !name) name = zone;
    rows.push({
      deviceTopicKey: device,
      controlId: control,
      name,
      cards: get("cards"),
    });
  }
  return rows;
}

export function applyMarkSheetRows(rows) {
  let named = 0;
  for (const row of rows) {
    const cards = String(row.cards || "")
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const out = upsertDeskShelfMark({
      deviceTopicKey: row.deviceTopicKey,
      controlId: row.controlId,
      ...(row.name ? { name: row.name } : {}),
      cards: cards.length ? cards : undefined,
    });
    if (out?.ok && row.name) named += 1;
  }
  return { ok: true, rows: rows.length, named };
}
