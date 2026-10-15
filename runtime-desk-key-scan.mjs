/**
 * План клавиш по комнатам → привязка к Input/MCM8/WD14 по скану нажатий.
 * Имя на канале: «Комната · подпись».
 */
import fs from "node:fs";
import path from "node:path";
import {
  deskMarkingPath,
  isDeskDeviceKey,
  upsertDeskRoom,
  upsertDeskShelfMark,
} from "./runtime-desk-marking.mjs";

const MAX_KEYS = 120;
const MAX_LABEL = 60;

function cleanLabel(value) {
  const s = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!s || s.length > MAX_LABEL) return "";
  if (/\/devices\//i.test(s) || /^wb-[a-z0-9-]+_\d/i.test(s)) return "";
  return s;
}

function cleanRoom(value) {
  const s = cleanLabel(value);
  if (!s || /·/.test(s)) return "";
  return s.slice(0, 40);
}

function newId(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function readRawDoc() {
  try {
    return JSON.parse(fs.readFileSync(deskMarkingPath(), "utf8"));
  } catch {
    return { version: 3, shelves: {}, solutions: [], rooms: [], keyPlan: [] };
  }
}

function writeKeyPlan(plan) {
  const file = deskMarkingPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const prev = readRawDoc();
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        version: 3,
        shelves: prev.shelves && typeof prev.shelves === "object" ? prev.shelves : {},
        solutions: Array.isArray(prev.solutions) ? prev.solutions : [],
        rooms: Array.isArray(prev.rooms) ? prev.rooms : [],
        keyPlan: plan,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

function normalizePlan(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const row of raw) {
    const id = String(row?.id || "").trim() || newId("key");
    const room = cleanRoom(row?.room);
    const label = cleanLabel(row?.label);
    if (!room || !label) continue;
    const item = { id, room, label };
    const dk = String(row?.deviceTopicKey || "").trim();
    const cid = String(row?.controlId || "").trim();
    if (dk && cid && isDeskDeviceKey(dk)) {
      item.deviceTopicKey = dk;
      item.controlId = cid;
      if (row?.boundAt) item.boundAt = String(row.boundAt);
    }
    out.push(item);
    if (out.length >= MAX_KEYS) break;
  }
  return out;
}

export function listDeskKeyPlan() {
  return normalizePlan(readRawDoc().keyPlan);
}

export function replaceDeskKeyPlan(keys) {
  const plan = normalizePlan(keys);
  writeKeyPlan(plan);
  for (const k of plan) upsertDeskRoom(k.room);
  return { ok: true, keyPlan: plan };
}

export function upsertDeskKeyPlanItem(input) {
  const plan = listDeskKeyPlan();
  const room = cleanRoom(input?.room);
  const label = cleanLabel(input?.label);
  if (!room || !label) return { ok: false, error: "need_room_label" };
  upsertDeskRoom(room);
  const id = String(input?.id || "").trim() || newId("key");
  const next = { id, room, label };
  if (input?.clearBind) {
    /* unbound */
  } else if (input?.deviceTopicKey && input?.controlId) {
    const dk = String(input.deviceTopicKey).trim();
    const cid = String(input.controlId).trim();
    if (!isDeskDeviceKey(dk) || !cid) return { ok: false, error: "bad_bind" };
    next.deviceTopicKey = dk;
    next.controlId = cid;
    next.boundAt = new Date().toISOString();
  } else {
    const prev = plan.find((k) => k.id === id);
    if (prev?.deviceTopicKey && prev?.controlId) {
      next.deviceTopicKey = prev.deviceTopicKey;
      next.controlId = prev.controlId;
      if (prev.boundAt) next.boundAt = prev.boundAt;
    }
  }
  const idx = plan.findIndex((k) => k.id === id);
  if (idx >= 0) plan[idx] = next;
  else plan.push(next);
  writeKeyPlan(normalizePlan(plan));
  return { ok: true, key: next, keyPlan: listDeskKeyPlan() };
}

/** Несколько подписей в одну комнату за раз (план до обхода сканом). */
export function upsertDeskKeyPlanBatch(input) {
  const room = cleanRoom(input?.room);
  if (!room) return { ok: false, error: "need_room_label" };
  const raw = Array.isArray(input?.labels)
    ? input.labels
    : String(input?.labelsText || input?.label || "")
        .split(/\r?\n/)
        .map((s) => s.trim());
  const labels = [];
  const seen = new Set();
  for (const item of raw) {
    const label = cleanLabel(item);
    if (!label) continue;
    const k = label.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    labels.push(label);
    if (labels.length >= 40) break;
  }
  if (!labels.length) return { ok: false, error: "need_room_label" };
  let last = { ok: false, error: "need_room_label" };
  for (const label of labels) {
    last = upsertDeskKeyPlanItem({ room, label });
    if (!last.ok) return last;
  }
  return { ok: true, added: labels.length, keyPlan: listDeskKeyPlan() };
}

export function deleteDeskKeyPlanItem(id) {
  const want = String(id || "").trim();
  if (!want) return { ok: false, error: "need_id" };
  const plan = listDeskKeyPlan().filter((k) => k.id !== want);
  writeKeyPlan(plan);
  return { ok: true, keyPlan: plan };
}

export function deskKeyMarkName(room, label) {
  const r = cleanRoom(room);
  const l = cleanLabel(label);
  if (!r || !l) return "";
  return `${r} · ${l}`.slice(0, 80);
}

export function bindDeskKeyPlanItem(input) {
  const id = String(input?.id || "").trim();
  const plan = listDeskKeyPlan();
  const row = plan.find((k) => k.id === id);
  if (!row) return { ok: false, error: "bad_key" };
  const dk = String(input?.deviceTopicKey || "").trim();
  const cid = String(input?.controlId || "")
    .trim()
    .replace(/\s+Short Press Counter$/i, "")
    .trim();
  if (!isDeskDeviceKey(dk) || !cid) return { ok: false, error: "bad_bind" };
  const name = deskKeyMarkName(row.room, row.label);
  const mark = upsertDeskShelfMark({ deviceTopicKey: dk, controlId: cid, name });
  if (!mark.ok) return mark;
  return upsertDeskKeyPlanItem({
    id,
    room: row.room,
    label: row.label,
    deviceTopicKey: dk,
    controlId: cid,
  });
}

export function clearDeskKeyPlan() {
  writeKeyPlan([]);
  return { ok: true, keyPlan: [] };
}

/** Input base from "Input 3" or "Input 3 Short Press Counter". */
export function deskInputBaseControl(controlId) {
  const c = String(controlId || "").trim();
  const m = /^(Input\s+[A-Z]?\d+)\s+Short Press Counter$/i.exec(c);
  if (m) return m[1];
  if (/^Input\s+[A-Z]?\d+$/i.test(c)) return c;
  if (/^EXT\d+_IN\d+$/i.test(c) || /^[A-D]\d+_IN\d+$/i.test(c)) return c;
  return "";
}
