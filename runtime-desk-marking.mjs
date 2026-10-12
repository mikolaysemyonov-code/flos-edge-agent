/**
 * Имена контактов на щите. Merge по device+control, rules не трогаем.
 */
import fs from "node:fs";
import path from "node:path";
import { liveDeskDeviceKey, readPouredChannelMarks } from "./runtime-desk-rules-marks.mjs";

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

/** Merge one contact. Never deletes sibling channels. Never writes wb-rules. */
export function upsertDeskShelfMark(input) {
  const key = String(input?.deviceTopicKey ?? "").trim();
  const controlId = String(input?.controlId ?? "").trim();
  if (!key || !/^wb-[a-z0-9._-]+$/i.test(key)) return { ok: false, error: "bad_key" };
  if (!controlId || controlId.length > 40 || /\/devices\//i.test(controlId)) {
    return { ok: false, error: "need_control" };
  }
  const name = cleanName(input?.name);
  const doc = readDeskMarking();
  const prev = doc.shelves[key] && typeof doc.shelves[key] === "object" ? doc.shelves[key] : {};
  const channels = prev.channels && typeof prev.channels === "object" ? { ...prev.channels } : {};
  if (!name) delete channels[controlId];
  else channels[controlId] = { name };
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
      return { ...ch, name, source: typed ? "desk" : pouredName ? "rules" : "" };
    });
    return { ...s, channels, name: "" };
  });
}
