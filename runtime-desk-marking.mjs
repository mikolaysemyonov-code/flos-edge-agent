/**
 * Имена контактов на щите. Merge по device+control, rules не трогаем.
 */
import fs from "node:fs";
import path from "node:path";
import {
  cardsFromHints,
  DESK_CARD_RU,
  exclusiveDeskCards,
  isLoadControl,
  liveDeskDeviceKey,
  pouredHintsForContact,
  readPouredChannelMarks,
  readPouredDeskSnapshot,
} from "./runtime-desk-rules-marks.mjs";
import { parseDeskDeviceKey } from "./runtime-desk-shelves.mjs";

const MAX_NAME = 160;

export function deskMarkingPath() {
  const state = (process.env.FLOS_STATE_PATH || "/var/lib/reactor-edge/agent.state.json").trim();
  return path.join(path.dirname(state || "/var/lib/reactor-edge/agent.state.json"), "desk-marking.json");
}

function emptyDoc() {
  return {
    version: 3,
    shelves: {},
    solutions: [],
    rooms: [],
    keyPlan: [],
    linePlan: [],
    site: { kind: "", floors: 1 },
    roomBook: [],
  };
}

function cleanRooms(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of value) {
    const s = cleanName(raw);
    if (!s || /·/.test(s)) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out.slice(0, 80);
}

export function readDeskDocument() {
  const file = deskMarkingPath();
  if (!fs.existsSync(file)) return emptyDoc();
  try {
    const raw = fs.readFileSync(file, "utf8");
    const json = JSON.parse(raw);
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return { ...emptyDoc(), unreadable: true };
    }
    const shelves = json.shelves && typeof json.shelves === "object" ? json.shelves : {};
    const solutions = Array.isArray(json.solutions) ? json.solutions : [];
    return {
      version: 3,
      shelves: dropBindsFromShelves(shelves).shelves,
      solutions,
      rooms: cleanRooms(json.rooms),
      keyPlan: Array.isArray(json.keyPlan) ? json.keyPlan : [],
      linePlan: Array.isArray(json.linePlan) ? json.linePlan : [],
      site: json.site && typeof json.site === "object" ? json.site : { kind: "", floors: 1 },
      roomBook: Array.isArray(json.roomBook) ? json.roomBook : [],
    };
  } catch {
    return { ...emptyDoc(), unreadable: true };
  }
}

export function listDeskRooms() {
  return readDeskDocument().rooms;
}

/** Одно написание комнаты: «холл» не заводит вторую комнату рядом с «Холл». */
export function canonDeskRoom(name) {
  const s = cleanName(name);
  if (!s || /·/.test(s)) return "";
  const cut = s.slice(0, 80);
  const doc = readDeskDocument();
  const pools = []
    .concat(doc.rooms || [])
    .concat((doc.keyPlan || []).map((k) => k && k.room))
    .concat((doc.linePlan || []).map((k) => k && k.room));
  const hit = pools.find((r) => String(r || "").toLowerCase() === cut.toLowerCase());
  return hit ? String(hit) : cut;
}

export function upsertDeskRoom(name) {
  const room = canonDeskRoom(name);
  if (!room) return { ok: false, error: "need_room" };
  const doc = readDeskDocument();
  if (doc.unreadable) return { ok: false, error: "marking_unreadable" };
  if ((doc.rooms || []).some((r) => r === room)) return { ok: true, rooms: doc.rooms, room };
  const rooms = cleanRooms([...(doc.rooms || []), room]);
  const written = writeDoc({ ...doc, rooms });
  if (written?.ok === false) return written;
  return { ok: true, rooms, room };
}

export function readDeskMarking() {
  const doc = readDeskDocument();
  return { version: 2, shelves: doc.shelves };
}

/** Стереть имена/карточки со стола. Комнаты и типовые не трогаем. Щит не пишем. */
export function clearDeskShelvesMarking() {
  const doc = readDeskDocument();
  if (doc.unreadable) return { ok: false, error: "marking_unreadable" };
  let cleared = 0;
  for (const shelf of Object.values(doc.shelves || {})) {
    const ch = shelf?.channels && typeof shelf.channels === "object" ? shelf.channels : {};
    cleared += Object.keys(ch).length;
  }
  writeDoc({ ...doc, shelves: {} });
  return { ok: true, cleared, rooms: doc.rooms, solutions: doc.solutions };
}

/**
 * Полный сброс стола: разметка + типовые + комнаты.
 * Шина MQTT и уже залитые wb-rules на контроллере не трогаем.
 */
export function clearDeskProject() {
  const doc = readDeskDocument();
  if (doc.unreadable) return { ok: false, error: "marking_unreadable" };
  let clearedShelves = 0;
  for (const shelf of Object.values(doc.shelves || {})) {
    const ch = shelf?.channels && typeof shelf.channels === "object" ? shelf.channels : {};
    clearedShelves += Object.keys(ch).length;
  }
  const clearedSolutions = Array.isArray(doc.solutions) ? doc.solutions.length : 0;
  const clearedRooms = Array.isArray(doc.rooms) ? doc.rooms.length : 0;
  const clearedKeyPlan = Array.isArray(doc.keyPlan) ? doc.keyPlan.length : 0;
  const clearedLinePlan = Array.isArray(doc.linePlan) ? doc.linePlan.length : 0;
  writeDoc({ shelves: {}, solutions: [], rooms: [], keyPlan: [], linePlan: [] });
  return {
    ok: true,
    clearedShelves,
    clearedSolutions,
    clearedRooms,
    clearedKeyPlan,
    clearedLinePlan,
    cleared:
      clearedShelves + clearedSolutions + clearedRooms + clearedKeyPlan + clearedLinePlan,
  };
}

function cleanName(value) {
  const s = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!s) return "";
  if (/\/devices\//i.test(s) || /^wb-[a-z0-9-]+_\d/i.test(s)) return "";
  return s.length > MAX_NAME ? s.slice(0, MAX_NAME) : s;
}

/**
 * Меняет только переданные поля. Остальное перечитывается с диска в момент записи,
 * чтобы сохранение карточки не затирало клавиши, линии и имена каналов.
 */
export function patchDeskDocument(patch) {
  const file = deskMarkingPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let prev = null;
  if (fs.existsSync(file)) {
    let json;
    try {
      json = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return { ok: false, error: "marking_unreadable" };
    }
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return { ok: false, error: "marking_unreadable" };
    }
    prev = {
      shelves: dropBindsFromShelves(json.shelves && typeof json.shelves === "object" ? json.shelves : {}).shelves,
      solutions: Array.isArray(json.solutions) ? json.solutions : [],
      rooms: cleanRooms(json.rooms),
      keyPlan: Array.isArray(json.keyPlan) ? json.keyPlan : [],
      linePlan: Array.isArray(json.linePlan) ? json.linePlan : [],
      site: json.site && typeof json.site === "object" ? json.site : { kind: "", floors: 1 },
      roomBook: Array.isArray(json.roomBook) ? json.roomBook : [],
    };
  } else {
    prev = emptyDoc();
  }
  const has = (key) => patch && Object.prototype.hasOwnProperty.call(patch, key);
  const shelves = has("shelves")
    ? dropBindsFromShelves(patch.shelves && typeof patch.shelves === "object" ? patch.shelves : {}).shelves
    : prev.shelves;
  const body = {
    version: 3,
    shelves,
    solutions: has("solutions") ? (Array.isArray(patch.solutions) ? patch.solutions : []) : prev.solutions,
    rooms: has("rooms") ? cleanRooms(patch.rooms) : prev.rooms,
    keyPlan: has("keyPlan") ? (Array.isArray(patch.keyPlan) ? patch.keyPlan : []) : prev.keyPlan || [],
    linePlan: has("linePlan") ? (Array.isArray(patch.linePlan) ? patch.linePlan : []) : prev.linePlan || [],
    site: has("site") ? patch.site : prev.site || { kind: "", floors: 1 },
    roomBook: has("roomBook") ? (Array.isArray(patch.roomBook) ? patch.roomBook : []) : prev.roomBook || [],
  };
  writeDeskFile(body);
  return { ok: true, ...body };
}

function writeDeskFile(body) {
  const file = deskMarkingPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`;
  fs.writeFileSync(tmp, JSON.stringify(body, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

/** Целиком кладёт черновик стола на место, даже если текущий файл порван. Правила щита не трогает. */
export function replaceDeskDocument(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "bad_json" };
  const shelvesIn = input.shelves;
  if (!shelvesIn || typeof shelvesIn !== "object" || Array.isArray(shelvesIn)) {
    return { ok: false, error: "bad_json" };
  }
  const body = {
    version: 3,
    shelves: dropBindsFromShelves(shelvesIn).shelves,
    solutions: Array.isArray(input.solutions) ? input.solutions : [],
    rooms: cleanRooms(input.rooms),
    keyPlan: collapseKeyPlan(input.keyPlan),
    linePlan: Array.isArray(input.linePlan) ? input.linePlan : [],
    site: input.site && typeof input.site === "object" ? input.site : { kind: "", floors: 1 },
    roomBook: Array.isArray(input.roomBook) ? input.roomBook : [],
  };
  const raw = JSON.stringify(body);
  if (raw.length > 2_000_000) return { ok: false, error: "too_large" };
  writeDeskFile(body);
  return { ok: true, restored: true, rooms: body.rooms, keyPlan: body.keyPlan, linePlan: body.linePlan };
}

function collapseKeyPlan(plan) {
  if (!Array.isArray(plan)) return [];
  return plan.map((row) => {
    if (!row || typeof row !== "object" || !row.controlId) return row;
    const base = deskInputBaseControl(row.controlId);
    if (!base || base === row.controlId) return row;
    return { ...row, controlId: base };
  });
}

function writeDoc(doc) {
  const patch = {};
  if (doc && Object.prototype.hasOwnProperty.call(doc, "shelves")) patch.shelves = doc.shelves;
  if (Array.isArray(doc?.solutions)) patch.solutions = doc.solutions;
  if (Array.isArray(doc?.rooms)) patch.rooms = doc.rooms;
  if (Array.isArray(doc?.keyPlan)) patch.keyPlan = doc.keyPlan;
  if (Array.isArray(doc?.linePlan)) patch.linePlan = doc.linePlan;
  if (doc?.site && typeof doc.site === "object") patch.site = doc.site;
  if (Array.isArray(doc?.roomBook)) patch.roomBook = doc.roomBook;
  return patchDeskDocument(patch);
}

function dropBindsFromShelves(shelves) {
  let dirty = false;
  const next = {};
  for (const [key, shelf] of Object.entries(shelves || {})) {
    const src = shelf?.channels && typeof shelf.channels === "object" ? shelf.channels : {};
    const channels = {};
    for (const [cid, ch] of Object.entries(src)) {
      if (!ch || typeof ch !== "object") continue;
      const row = { ...ch };
      if (row.binds) {
        delete row.binds;
        dirty = true;
      }
      if (!row.name && !(row.cards && row.cards.length)) {
        if (src[cid]) dirty = true;
        continue;
      }
      channels[cid] = row;
    }
    if (Object.keys(channels).length) next[key] = { ...shelf, channels };
    else if (Object.keys(src).length) dirty = true;
  }
  return { shelves: next, dirty };
}

function cleanCards(value) {
  if (!Array.isArray(value)) return null;
  return exclusiveDeskCards(value);
}

/** Input, или его счётчик — одна и та же клавиша. */
export function deskInputBaseControl(controlId) {
  const c = String(controlId || "").trim();
  const m = /^(Input\s+[A-Z]?\d+)\s+(?:Single|Shortlong|Short|Long|Double) Press Counter$/i.exec(c);
  if (m) return m[1];
  const pulse = /^(Input\s+[A-Z]?\d+)\s+counter$/i.exec(c);
  if (pulse) return pulse[1];
  if (/^Input\s+[A-Z]?\d+$/i.test(c)) return c;
  if (/^EXT\d+_IN\d+$/i.test(c) || /^[A-D]\d+_IN\d+$/i.test(c)) return c;
  return "";
}

/** Жест → суффикс провода. Short в коде стола = одиночное нажатие. */
const PRESS_ON_WIRE = { Short: "Single", Single: "Single", Long: "Long", Double: "Double", Shortlong: "Shortlong" };

/**
 * Кнопка Input N слушает счётчик жеста. EXT и Input A1 остаются уровнем.
 * Короткое нажатие — Single Press Counter: значение 2, 3, 28…, не 0/1.
 * wbIsOn(newValue) на таком числе всегда ложь, правило выходит и ничего не делает.
 * Сам Input N между опросами часто не успевает стать 1. Дим — Long / Shortlong.
 */
export function deskButtonCounter(controlId, kind = "Short", _deviceTopicKey = "") {
  const base = deskInputBaseControl(controlId);
  const wire = PRESS_ON_WIRE[kind] || "Single";
  if (base && /^Input\s+\d+$/i.test(base)) return `${base} ${wire} Press Counter`;
  if (base) return base;
  return String(controlId || "").trim();
}

/** Строка в then: на уровне входа действуем только в момент нажатия, не на отпускании. */
export function deskPressEdgeLine(whenPath) {
  const when = String(whenPath || "");
  if (/\/Input\s+[A-Z]?\d+$/i.test(when)) return "      if (!wbIsOn(newValue)) return;";
  if (/\scounter$/i.test(when) || /Press Counter$/i.test(when)) {
    return '      if (newValue === 0 || newValue === "0") return;';
  }
  return "";
}

export function isDeskDeviceKey(key) {
  const s = String(key ?? "").trim();
  return /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(s) && !/\/devices\//i.test(s);
}

/** Merge one contact. Never deletes sibling channels. Never writes wb-rules. */
/** Имя канала в копии полок, без записи на диск. Пустое имя снимает канал, если на нём нет карточек. */
/** Карточки канала в копии полок, без записи. Пустой список снимает карточки и канал, если имени нет. */
export function withShelfChannelCards(shelves, deviceTopicKey, controlId, cards) {
  const next = JSON.parse(JSON.stringify(shelves && typeof shelves === "object" ? shelves : {}));
  const key = String(deviceTopicKey || "").trim();
  const cid = String(controlId || "").trim();
  if (!key || !cid) return next;
  const shelf = next[key] && typeof next[key] === "object" ? next[key] : {};
  const channels = shelf.channels && typeof shelf.channels === "object" ? shelf.channels : {};
  const cur = channels[cid] && typeof channels[cid] === "object" ? { ...channels[cid] } : {};
  delete cur.binds;
  const cleaned = cleanCards(cards);
  if (!cleaned || cleaned.length === 0) delete cur.cards;
  else cur.cards = cleaned;
  if (!cur.name && !(Array.isArray(cur.cards) && cur.cards.length)) delete channels[cid];
  else channels[cid] = cur;
  if (Object.keys(channels).length === 0) delete next[key];
  else next[key] = { ...shelf, channels };
  return next;
}

export function withShelfChannelName(shelves, deviceTopicKey, controlId, name) {
  const next = JSON.parse(JSON.stringify(shelves && typeof shelves === "object" ? shelves : {}));
  const key = String(deviceTopicKey || "").trim();
  const cid = String(controlId || "").trim();
  if (!key || !cid) return next;
  const shelf = next[key] && typeof next[key] === "object" ? next[key] : {};
  const channels = shelf.channels && typeof shelf.channels === "object" ? shelf.channels : {};
  const cur = channels[cid] && typeof channels[cid] === "object" ? { ...channels[cid] } : {};
  delete cur.binds;
  const cleaned = cleanName(name);
  if (!cleaned) delete cur.name;
  else cur.name = cleaned;
  if (!cur.name && !(Array.isArray(cur.cards) && cur.cards.length)) delete channels[cid];
  else channels[cid] = cur;
  if (Object.keys(channels).length === 0) delete next[key];
  else next[key] = { ...shelf, channels };
  return next;
}

export function upsertDeskShelfMark(input) {
  const key = String(input?.deviceTopicKey ?? "").trim();
  const controlId = String(input?.controlId ?? "").trim();
  if (!key || !isDeskDeviceKey(key)) return { ok: false, error: "bad_key" };
  if (!controlId || controlId.length > 64 || /\/devices\//i.test(controlId)) {
    return { ok: false, error: "need_control" };
  }
  const doc = readDeskMarking();
  const prev = doc.shelves[key] && typeof doc.shelves[key] === "object" ? doc.shelves[key] : {};
  const channels = prev.channels && typeof prev.channels === "object" ? { ...prev.channels } : {};
  const cur = channels[controlId] && typeof channels[controlId] === "object" ? { ...channels[controlId] } : {};
  if (input?.name !== undefined) {
    const name = cleanName(input.name);
    if (!name) delete cur.name;
    else cur.name = name;
  }
  if (input?.cards !== undefined) {
    const cards = cleanCards(input.cards);
    if (!cards || cards.length === 0) delete cur.cards;
    else cur.cards = cards;
  }
  delete cur.binds;
  if (!cur.name && !(cur.cards && cur.cards.length)) {
    delete channels[controlId];
  } else channels[controlId] = cur;
  if (Object.keys(channels).length === 0) delete doc.shelves[key];
  else doc.shelves[key] = { ...prev, channels };
  writeDoc(doc);
  return { ok: true, shelves: doc.shelves };
}

export function applyMarksToShelves(shelves, doc = readDeskMarking(), poured = readPouredChannelMarks()) {
  try {
    const json = JSON.parse(fs.readFileSync(deskMarkingPath(), "utf8"));
    const dropped = dropBindsFromShelves(json?.shelves && typeof json.shelves === "object" ? json.shelves : {});
    if (dropped.dirty) {
      writeDoc({
        version: 3,
        shelves: dropped.shelves,
        solutions: Array.isArray(json.solutions) ? json.solutions : [],
        rooms: json.rooms,
        keyPlan: Array.isArray(json.keyPlan) ? json.keyPlan : [],
        linePlan: Array.isArray(json.linePlan) ? json.linePlan : [],
      });
    }
  } catch {
    /* no marking file yet */
  }
  const marks = (doc && doc.shelves) || readDeskDocument().shelves;
  return (Array.isArray(shelves) ? shelves : []).map((s) => {
    const local = marks[s.deviceTopicKey]?.channels;
    const fromRules =
      poured?.[s.deviceTopicKey] ??
      poured?.[liveDeskDeviceKey(s.deviceTopicKey)] ??
      {};
    const channels = (Array.isArray(s.channels) ? s.channels : []).map((ch) => {
      const typed = typeof local?.[ch.controlId]?.name === "string" ? local[ch.controlId].name : "";
      const pouredName = typeof fromRules[ch.controlId] === "string" ? fromRules[ch.controlId] : "";
      const name = typed || pouredName;
      const deskCards = Array.isArray(local?.[ch.controlId]?.cards) ? local[ch.controlId].cards : [];
      return {
        ...ch,
        name,
        source: typed ? "desk" : pouredName ? "rules" : "",
        cards: deskCards,
        cardsSource: deskCards.length ? "desk" : "",
        binds: [],
      };
    });
    return { ...s, channels, name: "" };
  });
}

function sameCards(a, b) {
  return [...(a || [])].sort().join(",") === [...(b || [])].sort().join(",");
}

function sameMarkName(a, b) {
  const norm = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
  return Boolean(norm(a)) && norm(a) === norm(b);
}

function cardRu(ids) {
  return (ids || []).map((id) => DESK_CARD_RU[id] || id);
}

function drivePairKey(deviceTopicKey, controlId) {
  const m = /^(Curtain|Actuator)\s+(\d+)\s+(Open|Close)$/i.exec(String(controlId || "").trim());
  return m ? String(deviceTopicKey) + "::" + m[1].toLowerCase() + ":" + m[2] : "";
}

function collapseDrivePairs(list) {
  const seen = new Set();
  const out = [];
  for (const r of Array.isArray(list) ? list : []) {
    const k = drivePairKey(r.deviceTopicKey, r.controlId);
    if (k) {
      if (seen.has(k)) continue;
      seen.add(k);
    }
    out.push(r);
  }
  return out;
}

/** Стол vs диск. Никогда не пишет wb-rules. */
export function buildDeskPourPreview(doc = readDeskMarking(), poured = readPouredChannelMarks(), rules) {
  const ruleRows = rules || readPouredDeskSnapshot().rules || [];
  const rows = [];
  const gaps = [];
  const deskShelves = doc?.shelves && typeof doc.shelves === "object" ? doc.shelves : {};
  const keys = new Set([...Object.keys(deskShelves), ...Object.keys(poured || {})]);
  for (const deviceTopicKey of keys) {
    const deskCh = deskShelves[deviceTopicKey]?.channels || {};
    const pouredCh = poured?.[deviceTopicKey] || poured?.[liveDeskDeviceKey(deviceTopicKey)] || {};
    const cids = new Set([...Object.keys(deskCh), ...Object.keys(typeof pouredCh === "object" ? pouredCh : {})]);
    for (const controlId of cids) {
      const deskName = typeof deskCh[controlId]?.name === "string" ? deskCh[controlId].name : "";
      const deskCards = isLoadControl(controlId) && Array.isArray(deskCh[controlId]?.cards)
        ? deskCh[controlId].cards
        : [];
      const pouredName = typeof pouredCh[controlId] === "string" ? pouredCh[controlId] : "";
      const pouredCards = cardsFromHints(pouredHintsForContact(ruleRows, deviceTopicKey, controlId));
      const name = deskName || pouredName;
      if (!name && !deskCards.length) continue;
      let status = "same";
      if (!name && deskCards.length) status = "blocked";
      else if (deskName && pouredName && !sameMarkName(deskName, pouredName)) status = "name";
      else if (deskName && !pouredName) {
        if (!isLoadControl(controlId)) continue;
        status = "new_name";
      }
      else if (deskCards.length && !sameCards(deskCards, pouredCards)) status = "card";
      else if (name && !deskCards.length && !pouredCards.length) {
        gaps.push({ deviceTopicKey, controlId, name, status: "no_card" });
        continue;
      }
      if (status === "same") continue;
      rows.push({
        deviceTopicKey,
        controlId,
        name,
        pouredName,
        cards: cardRu(deskCards),
        pouredCards: cardRu(pouredCards),
        status,
      });
    }
  }
  gaps.sort((a, b) => {
    const sa = parseDeskDeviceKey(a.deviceTopicKey)?.slave ?? 0;
    const sb = parseDeskDeviceKey(b.deviceTopicKey)?.slave ?? 0;
    if (sa !== sb) return sa - sb;
    const d = String(a.deviceTopicKey).localeCompare(String(b.deviceTopicKey));
    if (d) return d;
    const na = Number(/(\d+)/.exec(a.controlId)?.[1] || 0);
    const nb = Number(/(\d+)/.exec(b.controlId)?.[1] || 0);
    return na - nb;
  });
  const nextRows = collapseDrivePairs(rows);
  const nextGaps = collapseDrivePairs(gaps);
  const solutions = readDeskDocument().solutions;
  return {
    canPour: false,
    reason: "Превью. Диск не трогаем.",
    rows: nextRows,
    gaps: nextGaps,
    ready: {
      blocked: nextRows.filter((r) => r.status === "blocked").length,
      gaps: nextGaps.length,
      solutions: Array.isArray(solutions) ? solutions.length : 0,
      diffs: nextRows.length,
    },
  };
}
