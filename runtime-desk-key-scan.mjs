/**
 * План клавиш по комнатам → привязка к Input/MCM8/WD14 по скану нажатий.
 * Имя на канале: «Комната · подпись».
 */
import fs from "node:fs";
import path from "node:path";
import {
  canonDeskRoom,
  deskInputBaseControl,
  deskMarkingPath,
  isDeskDeviceKey,
  patchDeskDocument,
  upsertDeskRoom,
  withShelfChannelName,
} from "./runtime-desk-marking.mjs";

export { deskInputBaseControl };

/** 150 клавиш на объекте — запас до 480, дальше план честно отказывает. */
const MAX_KEYS = 480;
const MAX_LABEL = 160;

function cleanLabel(value) {
  const s = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!s) return "";
  if (/\/devices\//i.test(s) || /^wb-[a-z0-9-]+_\d/i.test(s)) return "";
  return s.length > MAX_LABEL ? s.slice(0, MAX_LABEL) : s;
}

function cleanRoom(value) {
  const s = cleanLabel(value);
  if (!s || /·/.test(s)) return "";
  return s.slice(0, 80);
}

function shelvesWithoutKeyMark(shelves, row) {
  if (!row?.deviceTopicKey || !row?.controlId) return shelves;
  const expect = deskKeyMarkName(row.room, row.label, row.code);
  if (!expect) return shelves;
  const cur = shelves?.[row.deviceTopicKey]?.channels?.[row.controlId]?.name;
  if (String(cur || "") !== expect) return shelves;
  return withShelfChannelName(shelves, row.deviceTopicKey, row.controlId, "");
}

function newId(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function readRawDoc() {
  try {
    return JSON.parse(fs.readFileSync(deskMarkingPath(), "utf8"));
  } catch {
    return { version: 3, shelves: {}, solutions: [], rooms: [], keyPlan: [], linePlan: [] };
  }
}

function writeKeyPlan(plan) {
  const written = patchDeskDocument({ keyPlan: plan });
  if (written?.ok === false) return written;
  return { ok: true };
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
    const code = String(row?.code || "").trim();
    if (/^\d{3}$/.test(code)) item.code = code;
    const floor = Math.round(Number(row?.floor) || 0);
    if (floor >= 1 && floor <= 9) item.floor = floor;
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
  const written = writeKeyPlan(plan);
  if (written?.ok === false) return written;
  for (const k of plan) upsertDeskRoom(k.room);
  return { ok: true, keyPlan: listDeskKeyPlan() };
}

export function upsertDeskKeyPlanItem(input) {
  const plan = listDeskKeyPlan();
  const room = canonDeskRoom(input?.room);
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
  const twin = plan.find(
    (k) => k.id !== id && k.room.toLowerCase() === room.toLowerCase() && k.label.toLowerCase() === label.toLowerCase(),
  );
  if (twin) {
    if (!plan.some((k) => k.id === id)) return { ok: true, duplicate: true, key: twin, keyPlan: plan };
    return { ok: false, error: "duplicate_label", room: twin.room, label: twin.label };
  }
  const idx = plan.findIndex((k) => k.id === id);
  if (idx >= 0) plan[idx] = next;
  else plan.push(next);
  const written = writeKeyPlan(normalizePlan(plan));
  if (written?.ok === false) return written;
  return { ok: true, key: next, keyPlan: listDeskKeyPlan() };
}

/** Несколько подписей в одну комнату за раз (план до обхода сканом). */
export function upsertDeskKeyPlanBatch(input) {
  const room = canonDeskRoom(input?.room);
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
  }
  if (!labels.length) return { ok: false, error: "need_room_label" };
  upsertDeskRoom(room);
  const plan = listDeskKeyPlan();
  const before = plan.length;
  let duplicates = 0;
  let accepted = 0;
  for (const label of labels) {
    if (plan.length >= MAX_KEYS) break;
    const twin = plan.find(
      (k) => k.room.toLowerCase() === room.toLowerCase() && k.label.toLowerCase() === label.toLowerCase(),
    );
    accepted += 1;
    if (twin) {
      duplicates += 1;
      continue;
    }
    plan.push({ id: newId("key"), room, label });
  }
  const written = writeKeyPlan(normalizePlan(plan));
  if (written?.ok === false) return written;
  const keyPlan = listDeskKeyPlan();
  const kept = keyPlan.length - before;
  return {
    ok: true,
    added: labels.length,
    kept,
    duplicates,
    dropped: Math.max(0, labels.length - accepted),
    cap: MAX_KEYS,
    keyPlan,
  };
}

export function deleteDeskKeyPlanItem(id) {
  const want = String(id || "").trim();
  if (!want) return { ok: false, error: "need_id" };
  const doc = readRawDoc();
  const prev = normalizePlan(doc.keyPlan).find((k) => k.id === want);
  let shelves = doc.shelves && typeof doc.shelves === "object" ? doc.shelves : {};
  if (prev) shelves = shelvesWithoutKeyMark(shelves, prev);
  const plan = normalizePlan(doc.keyPlan).filter((k) => k.id !== want);
  const written = patchDeskDocument({ shelves, keyPlan: plan });
  if (written?.ok === false) return written;
  return { ok: true, keyPlan: plan };
}

export function deskKeyMarkName(room, label, code) {
  const r = cleanRoom(room);
  const l = cleanLabel(label);
  if (!r || !l) return "";
  const c = /^\d{3}$/.test(String(code || "")) ? String(code) + " " : "";
  return `${c}${r} · ${l}`.slice(0, 160);
}

/** Обход: три нажатия уже дали топик, комната и подпись пишутся вместе с ним. */
export function captureDeskKeyPlanItem(input) {
  const room = canonDeskRoom(input?.room);
  const label = cleanLabel(input?.label);
  if (!room || !label) return { ok: false, error: "need_room_label" };
  const dk = String(input?.deviceTopicKey || "").trim();
  const cid = deskInputBaseControl(input?.controlId);
  if (!isDeskDeviceKey(dk) || !cid) return { ok: false, error: "bad_bind" };
  const plan = listDeskKeyPlan();
  const taken = plan.find(
    (k) => k.deviceTopicKey === dk && (deskInputBaseControl(k.controlId) || k.controlId) === cid,
  );
  if (taken) {
    return { ok: false, error: "topic_taken", room: taken.room, label: taken.label, deviceTopicKey: dk, controlId: cid };
  }
  const code = String(input?.code || "").trim();
  const floor = Math.round(Number(input?.floor) || 0);
  let useLabel = label;
  if (/^\d{3}$/.test(code)) {
    let n = 2;
    const takenLabel = (name) =>
      plan.some((k) => k.code === code && k.label.toLowerCase() === name.toLowerCase());
    while (takenLabel(useLabel)) {
      useLabel = label + " " + n;
      n += 1;
    }
  } else {
    const twin = plan.find(
      (k) => k.room.toLowerCase() === room.toLowerCase() && k.label.toLowerCase() === label.toLowerCase(),
    );
    if (twin) return { ok: false, error: "duplicate_label", room: twin.room, label: twin.label };
  }
  if (plan.length >= MAX_KEYS) return { ok: false, error: "key_plan_full", cap: MAX_KEYS };
  upsertDeskRoom(room);
  const key = {
    id: newId("key"),
    room,
    label: useLabel,
    deviceTopicKey: dk,
    controlId: cid,
    boundAt: new Date().toISOString(),
  };
  if (/^\d{3}$/.test(code)) key.code = code;
  if (floor >= 1 && floor <= 9) key.floor = floor;
  const doc = readRawDoc();
  let shelves = doc.shelves && typeof doc.shelves === "object" ? doc.shelves : {};
  shelves = withShelfChannelName(shelves, dk, cid, deskKeyMarkName(room, useLabel, key.code));
  const written = patchDeskDocument({ shelves, keyPlan: normalizePlan([...plan, key]) });
  if (written?.ok === false) return written;
  return { ok: true, key, keyPlan: listDeskKeyPlan() };
}

export function bindDeskKeyPlanItem(input) {
  const id = String(input?.id || "").trim();
  const plan = listDeskKeyPlan();
  const row = plan.find((k) => k.id === id);
  if (!row) return { ok: false, error: "bad_key" };
  const dk = String(input?.deviceTopicKey || "").trim();
  const cid = deskInputBaseControl(input?.controlId);
  if (!isDeskDeviceKey(dk) || !cid) return { ok: false, error: "bad_bind" };
  const taken = plan.find(
    (k) => k.id !== id && k.deviceTopicKey === dk && (deskInputBaseControl(k.controlId) || k.controlId) === cid,
  );
  if (taken) {
    return { ok: false, error: "topic_taken", room: taken.room, label: taken.label, deviceTopicKey: dk, controlId: cid };
  }
  const doc = readRawDoc();
  let shelves = doc.shelves && typeof doc.shelves === "object" ? doc.shelves : {};
  if (row.deviceTopicKey && row.controlId && (row.deviceTopicKey !== dk || row.controlId !== cid)) {
    shelves = shelvesWithoutKeyMark(shelves, row);
  }
  const name = deskKeyMarkName(row.room, row.label, row.code);
  shelves = withShelfChannelName(shelves, dk, cid, name);
  const nextPlan = plan.map((k) =>
    k.id === id ? { ...k, deviceTopicKey: dk, controlId: cid, boundAt: new Date().toISOString() } : k,
  );
  const written = patchDeskDocument({ shelves, keyPlan: normalizePlan(nextPlan) });
  if (written?.ok === false) return written;
  return { ok: true, key: nextPlan.find((k) => k.id === id), keyPlan: listDeskKeyPlan() };
}

export function clearDeskKeyPlan() {
  const doc = readRawDoc();
  let shelves = doc.shelves && typeof doc.shelves === "object" ? doc.shelves : {};
  for (const row of normalizePlan(doc.keyPlan)) shelves = shelvesWithoutKeyMark(shelves, row);
  const written = patchDeskDocument({ shelves, keyPlan: [] });
  if (written?.ok === false) return written;
  return { ok: true, keyPlan: [] };
}

