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

const MAX_NAME = 80;

export function deskMarkingPath() {
  const state = (process.env.FLOS_STATE_PATH || "/var/lib/reactor-edge/agent.state.json").trim();
  return path.join(path.dirname(state || "/var/lib/reactor-edge/agent.state.json"), "desk-marking.json");
}

function emptyDoc() {
  return { version: 3, shelves: {}, solutions: [], rooms: [], keyPlan: [] };
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
  return out.slice(0, 40);
}

export function readDeskDocument() {
  try {
    const raw = fs.readFileSync(deskMarkingPath(), "utf8");
    const json = JSON.parse(raw);
    const shelves = json?.shelves && typeof json.shelves === "object" ? json.shelves : {};
    const solutions = Array.isArray(json?.solutions) ? json.solutions : [];
    return {
      version: 3,
      shelves: dropBindsFromShelves(shelves).shelves,
      solutions,
      rooms: cleanRooms(json?.rooms),
      keyPlan: Array.isArray(json?.keyPlan) ? json.keyPlan : [],
    };
  } catch {
    return emptyDoc();
  }
}

export function listDeskRooms() {
  return readDeskDocument().rooms;
}

export function upsertDeskRoom(name) {
  const room = cleanName(name);
  if (!room || /·/.test(room)) return { ok: false, error: "need_room" };
  const doc = readDeskDocument();
  const rooms = cleanRooms([...(doc.rooms || []), room]);
  writeDoc({ ...doc, rooms });
  return { ok: true, rooms };
}

export function readDeskMarking() {
  const doc = readDeskDocument();
  return { version: 2, shelves: doc.shelves };
}

/** Стереть имена/карточки со стола. Комнаты и типовые не трогаем. Щит не пишем. */
export function clearDeskShelvesMarking() {
  const doc = readDeskDocument();
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
  let clearedShelves = 0;
  for (const shelf of Object.values(doc.shelves || {})) {
    const ch = shelf?.channels && typeof shelf.channels === "object" ? shelf.channels : {};
    clearedShelves += Object.keys(ch).length;
  }
  const clearedSolutions = Array.isArray(doc.solutions) ? doc.solutions.length : 0;
  const clearedRooms = Array.isArray(doc.rooms) ? doc.rooms.length : 0;
  writeDoc({ shelves: {}, solutions: [], rooms: [], keyPlan: [] });
  return {
    ok: true,
    clearedShelves,
    clearedSolutions,
    clearedRooms,
    cleared: clearedShelves + clearedSolutions + clearedRooms,
  };
}

function cleanName(value) {
  const s = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!s || s.length > MAX_NAME) return "";
  if (/\/devices\//i.test(s) || /^wb-[a-z0-9-]+_\d/i.test(s)) return "";
  return s;
}

function writeDoc(doc) {
  const file = deskMarkingPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const prev = readDeskDocument();
  const shelves = dropBindsFromShelves(
    doc?.shelves && typeof doc.shelves === "object" ? doc.shelves : {},
  ).shelves;
  const solutions = Array.isArray(doc?.solutions) ? doc.solutions : prev.solutions;
  const rooms = Array.isArray(doc?.rooms) ? cleanRooms(doc.rooms) : prev.rooms;
  const keyPlan = Array.isArray(doc?.keyPlan) ? doc.keyPlan : prev.keyPlan || [];
  fs.writeFileSync(
    file,
    JSON.stringify({ version: 3, shelves, solutions, rooms, keyPlan }, null, 2) + "\n",
    "utf8",
  );
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

export function isDeskDeviceKey(key) {
  const s = String(key ?? "").trim();
  return /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(s) && !/\/devices\//i.test(s);
}

/** Merge one contact. Never deletes sibling channels. Never writes wb-rules. */
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
