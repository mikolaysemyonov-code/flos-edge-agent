/**
 * План световых линий → обратный скан (маяк): мигаем кандидатами, «Это она» → имя на канале.
 */
import fs from "node:fs";
import path from "node:path";
import {
  deskMarkingPath,
  isDeskDeviceKey,
  upsertDeskRoom,
  upsertDeskShelfMark,
} from "./runtime-desk-marking.mjs";

const MAX_LINES = 120;
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
    return { version: 3, shelves: {}, solutions: [], rooms: [], keyPlan: [], linePlan: [] };
  }
}

function writeLinePlan(plan) {
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
        keyPlan: Array.isArray(prev.keyPlan) ? prev.keyPlan : [],
        linePlan: plan,
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
    const id = String(row?.id || "").trim() || newId("line");
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
    if (out.length >= MAX_LINES) break;
  }
  return out;
}

/** Свет/реле для маяка — не входы, не шторы, не счётчики. */
export function isDeskBeaconLoad(controlId, deviceTopicKey) {
  const c = String(controlId || "").trim();
  const key = String(deviceTopicKey || "").toLowerCase();
  if (!c) return false;
  if (/Short Press Counter$/i.test(c)) return false;
  if (/^Input\s+/i.test(c) || /^EXT\d+_IN/i.test(c) || /^[A-D]\d+_IN/i.test(c)) return false;
  if (/^(Curtain|Actuator)\s+\d+\s+(Open|Close)$/i.test(c)) return false;
  if (/brightness|temperature|palette|error|voltage|current|power|frequency|energy|status|offline|auto-change/i.test(c)) {
    return false;
  }
  if (/^Channel\s+\d+$/i.test(c) || /^CCT\d+$/i.test(c) || /^RGB\d+$/i.test(c)) return true;
  if (/^K\d+$/i.test(c)) {
    if (/mwac|msw|mcm|mdi|map12|mao|mdm/i.test(key) && !/mr|relay|gpio|led|wu|wb-mr/i.test(key)) {
      return false;
    }
    return true;
  }
  return false;
}

export function listDeskLinePlan() {
  return normalizePlan(readRawDoc().linePlan);
}

export function upsertDeskLinePlanItem(input) {
  const plan = listDeskLinePlan();
  const room = cleanRoom(input?.room);
  const label = cleanLabel(input?.label);
  if (!room || !label) return { ok: false, error: "need_room_label" };
  upsertDeskRoom(room);
  const id = String(input?.id || "").trim() || newId("line");
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
  writeLinePlan(normalizePlan(plan));
  return { ok: true, line: next, linePlan: listDeskLinePlan() };
}

export function upsertDeskLinePlanBatch(input) {
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
    last = upsertDeskLinePlanItem({ room, label });
    if (!last.ok) return last;
  }
  return { ok: true, added: labels.length, linePlan: listDeskLinePlan() };
}

export function deleteDeskLinePlanItem(id) {
  const want = String(id || "").trim();
  if (!want) return { ok: false, error: "need_id" };
  const plan = listDeskLinePlan().filter((k) => k.id !== want);
  writeLinePlan(plan);
  return { ok: true, linePlan: plan };
}

export function deskLineMarkName(room, label) {
  const r = cleanRoom(room);
  const l = cleanLabel(label);
  if (!r || !l) return "";
  return `${r} · ${l}`.slice(0, 80);
}

export function bindDeskLinePlanItem(input) {
  const id = String(input?.id || "").trim();
  const plan = listDeskLinePlan();
  const row = plan.find((k) => k.id === id);
  if (!row) return { ok: false, error: "bad_line" };
  const dk = String(input?.deviceTopicKey || "").trim();
  const cid = String(input?.controlId || "").trim();
  if (!isDeskDeviceKey(dk) || !cid || !isDeskBeaconLoad(cid, dk)) {
    return { ok: false, error: "bad_bind" };
  }
  const name = deskLineMarkName(row.room, row.label);
  const mark = upsertDeskShelfMark({ deviceTopicKey: dk, controlId: cid, name });
  if (!mark.ok) return mark;
  return upsertDeskLinePlanItem({
    id,
    room: row.room,
    label: row.label,
    deviceTopicKey: dk,
    controlId: cid,
  });
}

export function clearDeskLinePlan() {
  writeLinePlan([]);
  return { ok: true, linePlan: [] };
}

/** led | relay — для фильтра маяка и разного времени удержания. */
export function deskBeaconKind(controlId, deviceTopicKey) {
  const c = String(controlId || "").trim();
  const key = String(deviceTopicKey || "").toLowerCase();
  if (/led|ampled|dali|mdali/i.test(key) || /^Channel\s+\d+$/i.test(c) || /^CCT\d+$/i.test(c) || /^RGB\d+$/i.test(c)) {
    return "led";
  }
  if (/^K\d+$/i.test(c)) return "relay";
  return "relay";
}

/**
 * Подсказка длительности для pulse/аудита (маяк на столе — ручной шаг, без авто-таймера).
 */
export function deskBeaconHoldMs(kind) {
  if (kind === "led") return 3200;
  return 900;
}

/**
 * Кандидаты маяка из полок: сначала без имени, потом уже именованные (перепривязка).
 * @param {Array<{deviceTopicKey:string,channels?:Array}>} shelves
 * @param {{includeNamed?:boolean, family?: 'led'|'relay'|'all'}} opts
 */
export function deskBeaconCandidates(shelves, opts = {}) {
  const includeNamed = opts.includeNamed === true;
  const family = /^(led|relay)$/i.test(String(opts.family || ""))
    ? String(opts.family).toLowerCase()
    : "all";
  const free = [];
  const named = [];
  for (const s of Array.isArray(shelves) ? shelves : []) {
    const dk = String(s?.deviceTopicKey || "").trim();
    if (!dk || !isDeskDeviceKey(dk)) continue;
    for (const ch of Array.isArray(s.channels) ? s.channels : []) {
      const cid = String(ch?.controlId || "").trim();
      if (!isDeskBeaconLoad(cid, dk)) continue;
      const kind = deskBeaconKind(cid, dk);
      if (family !== "all" && kind !== family) continue;
      const name = String(ch?.name || "").trim();
      const row = {
        deviceTopicKey: dk,
        controlId: cid,
        name,
        kind,
        holdMs: deskBeaconHoldMs(kind),
        label: name || dk + "/" + cid,
      };
      if (name) named.push(row);
      else free.push(row);
    }
  }
  return includeNamed ? free.concat(named) : free.length ? free : named;
}
