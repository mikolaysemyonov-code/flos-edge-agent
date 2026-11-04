/**
 * Паспорт разметки: Excel для флешки и архива проекта.
 * Снимок стола (клавиши, нагрузки, связи). Не пишет правила.
 */
import { readDeskDocument } from "./runtime-desk-marking.mjs";
import { deskInputBaseControl } from "./runtime-desk-key-scan.mjs";
import { deskSolutionCatalog, DESK_CONTINUOUS_CARD_IDS, findScheduleOutputClash } from "./runtime-desk-solutions.mjs";
import { formatDeskShelfLabel, isDeskDriveControl, parseDeskDeviceKey } from "./runtime-desk-shelves.mjs";
import { isLoadControl } from "./runtime-desk-rules-marks.mjs";

export function mqttControlTopic(deviceTopicKey, controlId) {
  const dev = String(deviceTopicKey || "").trim();
  const cid = String(controlId || "").trim();
  if (!dev || !cid) return "";
  return `/devices/${dev}/controls/${cid}`;
}

function planControlBase(controlId) {
  return deskInputBaseControl(controlId) || String(controlId || "").trim();
}

export function pressTopic(deviceTopicKey, controlId) {
  const base = deskInputBaseControl(controlId);
  if (base && /^Input\s+/i.test(base)) {
    if (/mcm/i.test(String(deviceTopicKey || ""))) return mqttControlTopic(deviceTopicKey, base);
    return mqttControlTopic(deviceTopicKey, base + " Single Press Counter");
  }
  return mqttControlTopic(deviceTopicKey, controlId);
}

function loadKind(deviceTopicKey, controlId) {
  const cid = String(controlId || "").trim();
  const type = parseDeskDeviceKey(deviceTopicKey)?.type || "";
  if (isDeskDriveControl(cid)) return "Штора / привод";
  if (/^Channel /i.test(cid) && /led|ampled/i.test(type)) return "Свет";
  if (/^Channel /i.test(cid) && /mao/i.test(type)) return "Аналоговый выход";
  if (/^K\d+$/i.test(cid)) return "Реле";
  if (/^Channel /i.test(cid)) return "Выход";
  if (/^Input /i.test(cid) || /^EXT\d+_IN/i.test(cid) || /^[A-D]\d+_IN/i.test(cid)) return "Кнопка / вход";
  return "Канал";
}

function moduleLabel(deviceTopicKey) {
  return formatDeskShelfLabel(deviceTopicKey) || String(deviceTopicKey || "");
}

function splitRoomTitle(name) {
  const s = String(name || "").trim();
  const i = s.indexOf(" · ");
  if (i > 0) {
    const room = s.slice(0, i).trim();
    const title = s.slice(i + 3).trim();
    return { room, title: title || s };
  }
  return { room: "", title: s };
}

function keyRows(doc) {
  const rows = [];
  const seen = new Set();
  for (const k of doc.keyPlan || []) {
    const dev = k.deviceTopicKey || "";
    const cid = k.controlId || "";
    const key = dev && cid ? dev + "/" + cid : "";
    if (key) seen.add(key);
    rows.push([
      k.room || "",
      k.label || "",
      dev ? moduleLabel(dev) : "",
      cid,
      mqttControlTopic(dev, cid),
      dev && cid ? pressTopic(dev, cid) : "",
      dev ? "привязана" : "ещё не сканировали",
    ]);
  }
  for (const [dev, shelf] of Object.entries(doc.shelves || {})) {
    const channels = shelf?.channels || {};
    for (const [cid, ch] of Object.entries(channels)) {
      if (loadKind(dev, cid) !== "Кнопка / вход") continue;
      const name = String(ch?.name || "").trim();
      if (!name) continue;
      const key = dev + "/" + cid;
      if (seen.has(key)) continue;
      seen.add(key);
      const split = splitRoomTitle(name);
      rows.push([
        split.room,
        split.title,
        moduleLabel(dev),
        cid,
        mqttControlTopic(dev, cid),
        pressTopic(dev, cid),
        "имя на канале",
      ]);
    }
  }
  return sortRows(rows);
}

function sortRows(rows) {
  return rows.slice().sort((a, b) => {
    const room = String(a[0] || "").localeCompare(String(b[0] || ""), "ru");
    if (room) return room;
    return String(a[1] || "").localeCompare(String(b[1] || ""), "ru");
  });
}

function loadRows(doc) {
  const rows = [];
  const seen = new Set();
  for (const line of doc.linePlan || []) {
    const dev = line.deviceTopicKey || "";
    const cid = line.controlId || "";
    const key = dev && cid ? dev + "/" + cid : "plan:" + line.id;
    seen.add(key);
    rows.push([
      line.room || "",
      line.label || "",
      dev ? loadKind(dev, cid) : "Линия",
      dev ? moduleLabel(dev) : "",
      cid,
      mqttControlTopic(dev, cid),
      dev ? "привязана" : "ещё не найдена",
    ]);
  }
  for (const [dev, shelf] of Object.entries(doc.shelves || {})) {
    for (const [cid, ch] of Object.entries(shelf?.channels || {})) {
      if (!isLoadControl(cid)) continue;
      const name = String(ch?.name || "").trim();
      if (!name) continue;
      const key = dev + "/" + cid;
      if (seen.has(key)) continue;
      seen.add(key);
      const split = splitRoomTitle(name);
      rows.push([
        split.room,
        split.title,
        loadKind(dev, cid),
        moduleLabel(dev),
        cid,
        mqttControlTopic(dev, cid),
        "имя на канале",
      ]);
    }
  }
  return sortRows(rows);
}

function shelfHasControl(shelves, deviceTopicKey, controlId) {
  const shelf = (shelves || []).find((s) => s.deviceTopicKey === deviceTopicKey);
  if (!shelf) return false;
  const want = planControlBase(controlId);
  return (shelf.channels || []).some((ch) => {
    const cid = String(ch?.controlId || "");
    return cid === want || planControlBase(cid) === want;
  });
}

function gapRows(doc, shelves) {
  const rows = [];
  const bus = Array.isArray(shelves) ? shelves : [];
  for (const k of doc.keyPlan || []) {
    if (k.deviceTopicKey && k.controlId) continue;
    rows.push(["Клавиша без топика", k.room || "", k.label || "", "Три одиночных нажатия на объекте"]);
  }
  for (const line of doc.linePlan || []) {
    if (line.deviceTopicKey && line.controlId) continue;
    rows.push(["Линия без канала", line.room || "", line.label || "", "Маяк или имя на канале"]);
  }
  const byTopic = new Map();
  for (const k of doc.keyPlan || []) {
    if (!k.deviceTopicKey || !k.controlId) continue;
    const topic = k.deviceTopicKey + "/" + planControlBase(k.controlId);
    const list = byTopic.get(topic) || [];
    list.push(k);
    byTopic.set(topic, list);
  }
  for (const [topic, list] of byTopic) {
    if (list.length < 2) continue;
    rows.push([
      "Один топик на несколько клавиш",
      list.map((k) => k.room || "").join(", "),
      list.map((k) => k.label || "").join(" · "),
      topic,
    ]);
  }
  const byLine = new Map();
  for (const line of doc.linePlan || []) {
    if (!line.deviceTopicKey || !line.controlId) continue;
    const topic = line.deviceTopicKey + "/" + line.controlId;
    const list = byLine.get(topic) || [];
    list.push(line);
    byLine.set(topic, list);
  }
  for (const [topic, list] of byLine) {
    if (list.length < 2) continue;
    rows.push([
      "Один канал на несколько линий",
      list.map((k) => k.room || "").join(", "),
      list.map((k) => k.label || "").join(" · "),
      topic,
    ]);
  }
  const byDrive = new Map();
  for (const sol of doc.solutions || []) {
    if (!DESK_CONTINUOUS_CARD_IDS.has(sol?.solutionId)) continue;
    for (const t of Array.isArray(sol.targets) ? sol.targets : []) {
      if (!t?.deviceTopicKey || !t?.controlId) continue;
      const topic = t.deviceTopicKey + "/" + t.controlId;
      const list = byDrive.get(topic) || [];
      list.push(sol.title || sol.solutionId || "");
      byDrive.set(topic, list);
    }
  }
  for (const [topic, list] of byDrive) {
    if (list.length < 2) continue;
    rows.push(["Два постоянных правила на один выход", "", list.join(" · "), topic]);
  }
  const schedule = findScheduleOutputClash(doc.solutions || []);
  if (schedule) {
    rows.push([
      "Расписание и постоянное правило на одном выходе",
      "",
      schedule.other || "",
      schedule.deviceTopicKey + "/" + schedule.controlId,
    ]);
  }
  if (bus.length) {
    for (const k of doc.keyPlan || []) {
      if (!k.deviceTopicKey || !k.controlId) continue;
      if (shelfHasControl(bus, k.deviceTopicKey, k.controlId)) continue;
      rows.push([
        "Топик не виден на шине",
        k.room || "",
        k.label || "",
        mqttControlTopic(k.deviceTopicKey, k.controlId),
      ]);
    }
    const claimed = new Set(
      (doc.keyPlan || [])
        .filter((k) => k.deviceTopicKey && k.controlId)
        .map((k) => k.deviceTopicKey + "/" + planControlBase(k.controlId)),
    );
    const seenInput = new Set();
    for (const shelf of bus) {
      for (const ch of shelf.channels || []) {
        const base = deskInputBaseControl(ch?.controlId);
        if (!base) continue;
        const key = shelf.deviceTopicKey + "/" + base;
        if (seenInput.has(key) || claimed.has(key)) continue;
        seenInput.add(key);
        const named = String(doc.shelves?.[shelf.deviceTopicKey]?.channels?.[base]?.name || "").trim();
        const dev = String(shelf.deviceTopicKey || "");
        const blob = base + " " + named + " " + dev;
        const kind = /leak|reed|motion|water|alarm|протеч|геркон|движен|wb-mwac|wb-msw|wb-m1w2/i.test(blob)
          ? "Датчик, не клавиша"
          : named
            ? "Вход с именем, не в плане клавиш"
            : "Вход на шине без клавиши";
        rows.push([
          kind,
          named ? splitRoomTitle(named).room || moduleLabel(shelf.deviceTopicKey) : moduleLabel(shelf.deviceTopicKey),
          named ? splitRoomTitle(named).title || base : base,
          mqttControlTopic(shelf.deviceTopicKey, base),
        ]);
      }
    }
  }
  return sortRows(rows);
}

function shieldRows(shelves) {
  const rows = [];
  for (const s of Array.isArray(shelves) ? shelves : []) {
    const channels = Array.isArray(s.channels) ? s.channels : [];
    let inputs = 0;
    let loads = 0;
    for (const ch of channels) {
      const cid = String(ch?.controlId || "");
      if (/Counter$/i.test(cid)) continue;
      if (/^Input\s+/i.test(cid) || /^EXT\d+_IN/i.test(cid) || /^[A-D]\d+_IN/i.test(cid)) inputs += 1;
      else if (isLoadControl(cid) || isDeskDriveControl(cid)) loads += 1;
    }
    rows.push([
      moduleLabel(s.deviceTopicKey),
      s.deviceTopicKey || "",
      String(channels.length),
      String(inputs),
      String(loads),
    ]);
  }
  return rows;
}

function linkRows(doc) {
  const titles = new Map((deskSolutionCatalog() || []).map((c) => [c.id, c.title]));
  const rows = [];
  for (const sol of doc.solutions || []) {
    const trig = sol.trigger;
    const targets = Array.isArray(sol.targets) ? sol.targets : [];
    const loads = targets
      .map((t) => mqttControlTopic(t.deviceTopicKey, t.controlId))
      .filter(Boolean)
      .join("; ");
    const names = targets
      .map((t) => {
        const ch = doc.shelves?.[t.deviceTopicKey]?.channels?.[t.controlId];
        return String(ch?.name || t.controlId || "").trim();
      })
      .filter(Boolean)
      .join("; ");
    rows.push([
      titles.get(sol.solutionId) || sol.title || sol.solutionId || "",
      trig ? mqttControlTopic(trig.deviceTopicKey, trig.controlId) : "",
      names,
      loads,
    ]);
  }
  return rows;
}

export function buildDeskPassportSheets(doc, now = new Date(), extra = {}) {
  const stamp = now.toISOString().slice(0, 16).replace("T", " ");
  const scan = extra?.scan && typeof extra.scan === "object" ? extra.scan : null;
  const busShelves = Array.isArray(extra?.shelves) ? extra.shelves : [];
  const keys = doc.keyPlan || [];
  const lines = doc.linePlan || [];
  const unboundKeys = keys.filter((k) => !k.deviceTopicKey || !k.controlId).length;
  const unboundLines = lines.filter((k) => !k.deviceTopicKey || !k.controlId).length;
  const gaps = gapRows(doc, busShelves);
  const about = [];
  if (doc?.unreadable) {
    about.push(["ВНИМАНИЕ", "Файл стола не читается. Этот снимок пустой, диск не переписан."]);
  }
  if (scan?.truncated) {
    about.push([
      "ВНИМАНИЕ",
      "Скан шины обрезан. Части модулей в файле нет. " + (scan.omittedDeviceHint || "скачайте после полного «Обновить»."),
    ]);
  }
  if (scan?.shortScan) {
    const miss = [];
    if (Number(scan.modulesMissing) > 0) miss.push(scan.modulesMissing + " модулей");
    if (Number(scan.channelsMissing) > 0) miss.push(scan.channelsMissing + " каналов");
    const who = miss.length ? " Не ответили " + miss.join(" и ") + "." : "";
    about.push([
      "ВНИМАНИЕ",
      "Последний спокойный скан увидел " +
        scan.modulesSeen +
        " модулей из " +
        scan.modulesBefore +
        "." +
        who +
        " В файле оставлены полки прошлого полного снимка. Нажмите «Обновить», когда ответит весь щит.",
    ]);
  }
  if (!scan) {
    about.push(["Скан шины", "Полный снимок ещё не сохранён. На объекте нажмите «Обновить» и скачайте файл снова."]);
  } else if (scan.settled === false) {
    about.push(["Скан шины", "Зеркало ещё дописывалось. Подождите и нажмите «Обновить» ещё раз."]);
  } else if (scan.shortScan) {
    about.push(["Скан шины", "Часть модулей или каналов прошлого снимка не ответила. Файл домой не везти, пока щит не ответит целиком."]);
  } else if (!scan.truncated) {
    about.push(["Скан шины", "Полный снимок сохранён"]);
  }
  about.push(
    ["Паспорт разметки щита", ""],
    ["Снято", stamp + " UTC"],
    ["Зачем", "Файл для флешки и архива проекта. По нему видно, какая клавиша какой канал щита включает."],
    ["Как читали клавиши", "Комната и подпись, затем три одиночных нажатия — в столбце «Топик входа» появляется адрес на шине."],
    ["Чего файл не делает", "Не заменяет правила на контроллере и не заливает их сам. Это снимок разметки."],
    ["Клавиш в плане", String(keys.length)],
    ["Клавиш без топика", String(unboundKeys)],
    ["Линий в плане", String(lines.length)],
    ["Линий без канала", String(unboundLines)],
    ["Связей", String((doc.solutions || []).length)],
    ["Модулей в снимке", String(busShelves.length)],
    ["Топиков в снимке", scan?.topicCount != null ? String(scan.topicCount) : ""],
    ["Дыр", gaps.length ? String(gaps.length) + " — лист «Дыры»" : "нет"],
  );
  return [
    { name: "О файле", headers: ["Поле", "Значение"], rows: about, header: false },
    {
      name: "Дыры",
      headers: ["Что не закрыто", "Комната", "Название", "Что сделать на объекте"],
      rows: gaps,
    },
    {
      name: "Клавиши",
      headers: ["Комната", "Где и что включает", "Модуль щита", "Канал", "Топик входа", "Топик одиночного нажатия", "Статус"],
      rows: keyRows(doc),
    },
    {
      name: "Нагрузки",
      headers: ["Комната", "Название", "Тип", "Модуль щита", "Канал", "Топик", "Статус"],
      rows: loadRows(doc),
    },
    {
      name: "Щит",
      headers: ["Модуль", "Адрес на шине", "Каналов в снимке", "Входов", "Нагрузок"],
      rows: shieldRows(busShelves),
    },
    {
      name: "Связи",
      headers: ["Карточка", "Топик кнопки или датчика", "Что включает", "Топики нагрузок"],
      rows: linkRows(doc),
    },
  ];
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n & 0xffff);
  return b;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
}

/** ZIP без сжатия. Флаг UTF-8 и живая дата — иначе Excel и Numbers файл не берут. */
export function zipStore(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const stamp = dosDateTime();
  const flag = 0x0800;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const crc = crc32(data);
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(flag),
      u16(0),
      u16(stamp.dosTime),
      u16(stamp.dosDate),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      data,
    ]);
    locals.push(local);
    centrals.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(flag),
        u16(0),
        u16(stamp.dosTime),
        u16(stamp.dosDate),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    offset += local.length;
  }
  const central = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, central, eocd]);
}

function xml(s) {
  return String(s ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Нулевая дата в ZIP — частая причина, по которой Excel молча не открывает файл. */
function dosDateTime(date = new Date()) {
  const y = Math.max(1980, date.getFullYear());
  const dosDate = ((y - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  return { dosDate, dosTime };
}

function colName(index) {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sheetXml(headers, rows, withHeader) {
  const all = withHeader === false ? rows : [headers, ...rows];
  const widths = headers.map((h, i) => {
    let n = String(h || "").length;
    for (const row of rows) n = Math.max(n, String(row[i] ?? "").length);
    return Math.min(48, Math.max(12, n + 2));
  });
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  const body = all
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const style = withHeader !== false && r === 0 ? ` s="1"` : "";
          return `<c r="${colName(c)}${r + 1}" t="inlineStr"${style}><is><t>${xml(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<cols>${cols}</cols>
<sheetData>${body}</sheetData>
</worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2">
  <font><sz val="11"/><name val="Calibri"/></font>
  <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
  <fill><patternFill patternType="none"/></fill>
  <fill><patternFill patternType="gray125"/></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF1F3D32"/></patternFill></fill>
</fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="2">
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  <xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"/>
</cellXfs>
</styleSheet>`;

export function workbookXlsx(sheets) {
  const sheetFiles = sheets.map((sheet, i) => ({
    name: `xl/worksheets/sheet${i + 1}.xml`,
    data: sheetXml(sheet.headers, sheet.rows, sheet.header),
  }));
  const workbookSheets = sheets
    .map((sheet, i) => `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("");
  const workbookRels = sheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join("");
  const overrides = sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("");
  return zipStore([
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${overrides}
</Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${workbookSheets}</sheets>
</workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${workbookRels}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    { name: "xl/styles.xml", data: STYLES },
    ...sheetFiles,
  ]);
}

export function buildDeskPassportXlsx(doc = readDeskDocument(), now = new Date(), extra) {
  return workbookXlsx(buildDeskPassportSheets(doc, now, extra));
}
