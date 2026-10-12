/**
 * Имена контактов на щите. Merge по device+control, rules не трогаем.
 */
import fs from "node:fs";
import path from "node:path";
import {
  cardsFromHints,
  DESK_CARD_IDS,
  DESK_CARD_RU,
  liveDeskDeviceKey,
  pouredHintsForContact,
  readPouredChannelMarks,
  readPouredDeskSnapshot,
} from "./runtime-desk-rules-marks.mjs";

const MAX_NAME = 80;

export function deskMarkingPath() {
  const state = (process.env.FLOS_STATE_PATH || "/var/lib/reactor-edge/agent.state.json").trim();
  return path.join(path.dirname(state || "/var/lib/reactor-edge/agent.state.json"), "desk-marking.json");
}

function emptyDoc() {
  return { version: 2, shelves: {} };
}

export function readDeskMarking() {
  try {
    const raw = fs.readFileSync(deskMarkingPath(), "utf8");
    const json = JSON.parse(raw);
    const shelves = json?.shelves && typeof json.shelves === "object" ? json.shelves : {};
    return { version: 2, shelves };
  } catch {
    return emptyDoc();
  }
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
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n", "utf8");
}

function cleanCards(value) {
  if (!Array.isArray(value)) return null;
  const allow = new Set(DESK_CARD_IDS);
  return [...new Set(value.map((id) => String(id)).filter((id) => allow.has(id)))];
}

/** Merge one contact. Never deletes sibling channels. Never writes wb-rules. */
export function upsertDeskShelfMark(input) {
  const key = String(input?.deviceTopicKey ?? "").trim();
  const controlId = String(input?.controlId ?? "").trim();
  if (!key || !/^wb-[a-z0-9._-]+$/i.test(key)) return { ok: false, error: "bad_key" };
  if (!controlId || controlId.length > 40 || /\/devices\//i.test(controlId)) {
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
  if (!cur.name && !(cur.cards && cur.cards.length)) delete channels[controlId];
  else channels[controlId] = cur;
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
      return {
        ...ch,
        name,
        source: typed ? "desk" : pouredName ? "rules" : "",
        cards: deskCards,
        cardsSource: deskCards.length ? "desk" : "",
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
      const deskCards = Array.isArray(deskCh[controlId]?.cards) ? deskCh[controlId].cards : [];
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
  return {
    canPour: false,
    reason: "Превью. Диск не трогаем.",
    rows,
    gaps,
  };
}
