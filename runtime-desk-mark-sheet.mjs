/**
 * Excel разметки: канал как «WB-MR6CU №128/К1», этаж, помещение, название.
 */
import zlib from "node:zlib";
import { upsertDeskShelfMark } from "./runtime-desk-marking.mjs";
import { completeDeskModuleChannels, formatDeskShelfLabel } from "./runtime-desk-shelves.mjs";
import { workbookXlsx } from "./runtime-desk-passport.mjs";

const HEAD = ["Канал", "Этаж", "Помещение", "Название"];

export function displayControl(controlId) {
  const id = String(controlId || "").trim();
  const k = /^K(\d+)$/i.exec(id);
  if (k) return "К" + k[1];
  const ch = /^Channel\s+(\d+)$/i.exec(id);
  if (ch) return "Канал " + ch[1];
  const d = /^(Curtain|Actuator)\s+(\d+)\s+(Open|Close)$/i.exec(id);
  if (d) {
    const fam = /^actuator$/i.test(d[1]) ? "Привод" : "Штора";
    return fam + " " + d[2] + " " + (/close/i.test(d[3]) ? "закрыть" : "открыть");
  }
  return id;
}

export function parseDisplayControl(raw) {
  const t = String(raw || "").trim();
  const k = /^[KК](\d+)$/i.exec(t);
  if (k) return "K" + k[1];
  const ch = /^(?:Канал|Channel)\s+(\d+)$/i.exec(t);
  if (ch) return "Channel " + ch[1];
  const d = /^(Штора|Привод|Curtain|Actuator)\s+(\d+)\s+(открыть|закрыть|Open|Close)$/i.exec(t);
  if (d) {
    const fam = /привод|actuator/i.test(d[1]) ? "Actuator" : "Curtain";
    return fam + " " + d[2] + " " + (/закр|close/i.test(d[3]) ? "Close" : "Open");
  }
  return t;
}

export function splitMarkName(name) {
  const parts = String(name || "").split(" · ").map((s) => s.trim()).filter(Boolean);
  const floorish = (s) => /^\d+(\s*эт\.?)?$/i.test(s);
  if (parts[0] && floorish(parts[0])) {
    return {
      floor: parts[0].replace(/\s*эт\.?$/i, ""),
      room: parts.length > 2 ? parts[1] : "",
      title: parts.length > 2 ? parts.slice(2).join(" · ") : parts[1] || "",
    };
  }
  if (parts.length >= 2) return { floor: "", room: parts[0], title: parts.slice(1).join(" · ") };
  return { floor: "", room: "", title: parts[0] || "" };
}

export function joinMarkName(floor, room, title) {
  const bits = [];
  const fl = String(floor || "").trim().replace(/\s*эт\.?$/i, "");
  if (fl) bits.push(fl);
  if (String(room || "").trim()) bits.push(String(room).trim());
  if (String(title || "").trim()) bits.push(String(title).trim());
  return bits.join(" · ");
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
      const split = splitMarkName(ch?.name || ch?.title || "");
      rows.push({
        channel: module + "/" + displayControl(control),
        device,
        control,
        floor: split.floor,
        room: split.room,
        title: split.title,
      });
    }
  }
  return rows;
}

export function markSheetXlsx(rows) {
  return workbookXlsx([
    {
      name: "Разметка",
      headers: HEAD,
      rows: (rows || []).map((r) => [r.channel, r.floor, r.room, r.title]),
    },
  ]);
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

function tableToMarks(header, body, shelves) {
  const head = header.map((h) => String(h || "").trim().toLowerCase());
  const idx = (...names) => names.reduce((found, n) => (found >= 0 ? found : head.indexOf(n)), -1);
  const iCh = idx("канал", "channel");
  const iFloor = idx("этаж", "floor");
  const iRoom = idx("помещение", "room", "zone");
  const iTitle = idx("название", "name", "title");
  const catalog = markSheetRows(shelves);
  const byChannel = new Map(catalog.map((r) => [r.channel.toLowerCase(), r]));
  const out = [];
  for (const cells of body) {
    const channel = String(cells[iCh] || "").trim();
    if (!channel) continue;
    const hit = byChannel.get(channel.toLowerCase());
    const slash = channel.lastIndexOf("/");
    const control = parseDisplayControl(slash >= 0 ? channel.slice(slash + 1) : channel);
    const name = joinMarkName(cells[iFloor], cells[iRoom], cells[iTitle]);
    if (!name) continue;
    out.push({
      deviceTopicKey: hit?.device || "",
      controlId: hit?.control || control,
      name,
    });
  }
  return out.filter((r) => r.deviceTopicKey && r.controlId);
}

export function parseMarkSheetCsv(text, shelves = []) {
  const raw = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = raw.split("\n").filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = lines[0].includes(";") ? ";" : ",";
  const rows = lines.map((l) => splitCsvLine(l, sep));
  return tableToMarks(rows[0], rows.slice(1), shelves);
}

function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from("PK\x05\x06"));
  if (end < 0) return {};
  const count = buf.readUInt16LE(end + 10);
  let o = buf.readUInt32LE(end + 16);
  const files = {};
  for (let n = 0; n < count; n += 1) {
    const method = buf.readUInt16LE(o + 10);
    const comp = buf.readUInt32LE(o + 20);
    const nameLen = buf.readUInt16LE(o + 28);
    const extra = buf.readUInt16LE(o + 30);
    const comment = buf.readUInt16LE(o + 32);
    const local = buf.readUInt32LE(o + 42);
    const name = buf.subarray(o + 46, o + 46 + nameLen).toString("utf8");
    const locName = buf.readUInt16LE(local + 26);
    const locExtra = buf.readUInt16LE(local + 28);
    const payload = buf.subarray(local + 30 + locName + locExtra, local + 30 + locName + locExtra + comp);
    files[name] = method === 8 ? zlib.inflateRawSync(payload) : payload;
    o += 46 + nameLen + extra + comment;
  }
  return files;
}

function cellText(c, strings) {
  const t = /t="([^"]+)"/.exec(c)?.[1];
  if (t === "s") {
    const v = /<v>([^<]*)<\/v>/.exec(c);
    return strings[Number(v?.[1] || 0)] || "";
  }
  const inline = /<t[^>]*>([^<]*)<\/t>/.exec(c);
  if (inline) return inline[1];
  const v = /<v>([^<]*)<\/v>/.exec(c);
  return v ? v[1] : "";
}

export function parseMarkSheetXlsx(buf, shelves = []) {
  const files = unzip(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
  const shared = String(files["xl/sharedStrings.xml"] || "");
  const strings = [...shared.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join(""),
  );
  const sheet = String(files["xl/worksheets/sheet1.xml"] || "");
  const table = [];
  for (const row of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const c of row[1].matchAll(/<c[^>]*>([\s\S]*?)<\/c>/g)) cells.push(cellText(c[0], strings));
    if (cells.some((x) => String(x).trim())) table.push(cells);
  }
  if (table.length < 2) return [];
  return tableToMarks(table[0], table.slice(1), shelves);
}

export function parseMarkSheet(body, shelves = []) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body || "");
  if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) return parseMarkSheetXlsx(buf, shelves);
  return parseMarkSheetCsv(buf.toString("utf8"), shelves);
}

export function applyMarkSheetRows(rows) {
  let named = 0;
  for (const row of rows) {
    const out = upsertDeskShelfMark({
      deviceTopicKey: row.deviceTopicKey,
      controlId: row.controlId,
      ...(row.name ? { name: row.name } : {}),
    });
    if (out?.ok && row.name) named += 1;
  }
  return { ok: true, rows: rows.length, named };
}
