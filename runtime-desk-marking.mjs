/**
 * Имена полок на щите. Рядом с agent.state, merge по ключу, rules не трогаем.
 */
import fs from "node:fs";
import path from "node:path";

const MAX_NAME = 80;

export function deskMarkingPath() {
  const state = (process.env.FLOS_STATE_PATH || "/var/lib/reactor-edge/agent.state.json").trim();
  return path.join(path.dirname(state || "/var/lib/reactor-edge/agent.state.json"), "desk-marking.json");
}

function emptyDoc() {
  return { version: 1, shelves: {} };
}

export function readDeskMarking() {
  try {
    const raw = fs.readFileSync(deskMarkingPath(), "utf8");
    const json = JSON.parse(raw);
    const shelves = json?.shelves && typeof json.shelves === "object" ? json.shelves : {};
    return { version: 1, shelves };
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

/** Merge one shelf. Never deletes other keys. Never writes wb-rules. */
export function upsertDeskShelfMark(input) {
  const key = String(input?.deviceTopicKey ?? "").trim();
  if (!key || !/^wb-[a-z0-9._-]+$/i.test(key)) {
    return { ok: false, error: "bad_key" };
  }
  const name = cleanName(input?.name);
  const room = cleanName(input?.room);
  const doc = readDeskMarking();
  const prev = doc.shelves[key] && typeof doc.shelves[key] === "object" ? doc.shelves[key] : {};
  if (!name) {
    delete doc.shelves[key];
  } else {
    doc.shelves[key] = { ...prev, name, ...(room ? { room } : {}) };
  }
  const file = deskMarkingPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n", "utf8");
  return { ok: true, shelves: doc.shelves };
}

export function applyMarksToShelves(shelves, doc = readDeskMarking()) {
  const marks = doc?.shelves ?? {};
  return (Array.isArray(shelves) ? shelves : []).map((s) => {
    const mark = marks[s.deviceTopicKey];
    const name = typeof mark?.name === "string" ? mark.name : "";
    const room = typeof mark?.room === "string" ? mark.room : "";
    return { ...s, name, room };
  });
}
