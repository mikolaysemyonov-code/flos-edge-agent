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
  return { version: 3, shelves: {}, solutions: [] };
}

export function readDeskDocument() {
  try {
    const raw = fs.readFileSync(deskMarkingPath(), "utf8");
    const json = JSON.parse(raw);
    const shelves = json?.shelves && typeof json.shelves === "object" ? json.shelves : {};
    const solutions = Array.isArray(json?.solutions) ? json.solutions : [];
    return { version: 3, shelves, solutions };
  } catch {
    return emptyDoc();
  }
}

export function readDeskMarking() {
  const doc = readDeskDocument();
  return { version: 2, shelves: doc.shelves };
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
  const shelves = doc?.shelves && typeof doc.shelves === "object" ? doc.shelves : {};
  const solutions = Array.isArray(doc?.solutions) ? doc.solutions : prev.solutions;
  fs.writeFileSync(
    file,
    JSON.stringify({ version: 3, shelves, solutions }, null, 2) + "\n",
    "utf8",
  );
}

function cleanCards(value) {
  if (!Array.isArray(value)) return null;
  return exclusiveDeskCards(value);
}

export function isDeskDeviceKey(key) {
  const s = String(key ?? "").trim();
  return /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(s) && !/\/devices\//i.test(s);
}

function cleanBinds(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const b of value) {
    const deviceTopicKey = String(b?.deviceTopicKey ?? "").trim();
    const controlId = String(b?.controlId ?? "").trim();
    if (!isDeskDeviceKey(deviceTopicKey)) continue;
    if (!isLoadControl(controlId)) continue;
    const id = deviceTopicKey + "::" + controlId;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ deviceTopicKey, controlId });
  }
  return out;
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
  if (input?.binds !== undefined) {
    const binds = cleanBinds(input.binds);
    if (!binds.length) delete cur.binds;
    else cur.binds = binds;
  }
  if (!cur.name && !(cur.cards && cur.cards.length) && !(cur.binds && cur.binds.length)) {
    delete channels[controlId];
  } else channels[controlId] = cur;
  if (Object.keys(channels).length === 0) delete doc.shelves[key];
  else doc.shelves[key] = { ...prev, channels };
  writeDoc(doc);
  return { ok: true, shelves: doc.shelves };
}

export function applyMarksToShelves(shelves, doc = readDeskMarking(), poured = readPouredChannelMarks()) {
  const marks = doc?.shelves ?? {};
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
      const binds = Array.isArray(local?.[ch.controlId]?.binds) ? local[ch.controlId].binds : [];
      return {
        ...ch,
        name,
        source: typed ? "desk" : pouredName ? "rules" : "",
        cards: deskCards,
        cardsSource: deskCards.length ? "desk" : "",
        binds,
      };
    });
    return { ...s, channels, name: "" };
  });
}

function sameCards(a, b) {
  return [...(a || [])].sort().join(",") === [...(b || [])].sort().join(",");
}

function cardRu(ids) {
  return (ids || []).map((id) => DESK_CARD_RU[id] || id);
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
      else if (deskName && pouredName && deskName !== pouredName) status = "name";
      else if (deskName && !pouredName) status = "new_name";
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
    const na = Number(/(\d+)\s*$/.exec(a.controlId)?.[1] || 0);
    const nb = Number(/(\d+)\s*$/.exec(b.controlId)?.[1] || 0);
    return na - nb;
  });
  return {
    canPour: false,
    reason: "Превью. Диск не трогаем.",
    rows,
    gaps,
  };
}
