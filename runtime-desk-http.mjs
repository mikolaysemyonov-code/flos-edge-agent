/**
 * Локальный стол пуска (как HA :8123): страница с контейнера + скан MQTT на щите.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyMarksToShelves,
  buildDeskPourPreview,
  clearDeskProject,
  clearDeskShelvesMarking,
  deskMarkingPath,
  listDeskRooms,
  readDeskMarking,
  upsertDeskRoom,
  upsertDeskShelfMark,
} from "./runtime-desk-marking.mjs";
import {
  deskSolutionCatalog,
  deleteDeskSolution,
  listDeskSolutions,
  upsertDeskSolution,
} from "./runtime-desk-solutions.mjs";
import { buildFieldCertificate } from "./runtime-desk-field-cert.mjs";
import {
  cardsFromHints,
  pouredHintsForContact,
  pouredButtonsForContact,
  pouredLoadsForContact,
  readPouredChannelMarks,
  readPouredDeskSnapshot,
} from "./runtime-desk-rules-marks.mjs";
import { formatDeskShelfLabel, groupDeskShelves, rememberDeskShelves } from "./runtime-desk-shelves.mjs";
import { assessDeskCanPour, buildDeskPourPackage } from "./runtime-desk-pour.mjs";
import {
  actuateDeskChannel,
  deskInputClosed,
  isDeskInputControl,
} from "./runtime-desk-actuate.mjs";
import {
  bindDeskKeyPlanItem,
  deleteDeskKeyPlanItem,
  listDeskKeyPlan,
  replaceDeskKeyPlan,
  upsertDeskKeyPlanBatch,
  upsertDeskKeyPlanItem,
} from "./runtime-desk-key-scan.mjs";
import {
  bindDeskLinePlanItem,
  deleteDeskLinePlanItem,
  deskBeaconCandidates,
  listDeskLinePlan,
  upsertDeskLinePlanBatch,
  upsertDeskLinePlanItem,
} from "./runtime-desk-line-beacon.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

let mqttScanHandler = null;

export function setRuntimeMqttScanHandler(fn) {
  mqttScanHandler = typeof fn === "function" ? fn : null;
}

export function serveCommissionDesk(_req, res) {
  const file = path.join(HERE, "desk.html");
  try {
    const html = fs.readFileSync(file, "utf8");
    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(html);
    return true;
  } catch {
    res.statusCode = 503;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("Стол пуска не в образе — обновите агент (desk.html).");
    return true;
  }
}

const DESK_FILES = {
  "/desk.css": { name: "desk.css", type: "text/css; charset=utf-8" },
  "/desk.js": { name: "desk.js", type: "text/javascript; charset=utf-8" },
};

export function serveCommissionDeskFile(urlPath, res) {
  const spec = DESK_FILES[urlPath];
  if (!spec) return false;
  try {
    const body = fs.readFileSync(path.join(HERE, spec.name));
    res.statusCode = 200;
    res.setHeader("content-type", spec.type);
    res.setHeader("cache-control", "no-store");
    res.end(body);
    return true;
  } catch {
    res.statusCode = 503;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("Нет " + spec.name);
    return true;
  }
}

function lastShelvesPath() {
  return path.join(path.dirname(deskMarkingPath()), "desk-last-shelves.json");
}

export function readLastDeskShelves() {
  try {
    const json = JSON.parse(fs.readFileSync(lastShelvesPath(), "utf8"));
    const shelves = Array.isArray(json?.shelves) ? json.shelves : [];
    return {
      ok: true,
      cached: true,
      brokerLabel: typeof json?.brokerLabel === "string" ? json.brokerLabel : "",
      shelves,
    };
  } catch {
    return { ok: true, cached: true, shelves: [] };
  }
}

function withPouredHints(shelves) {
  const rules = readPouredDeskSnapshot().rules || [];
  const marks = readPouredChannelMarks();
  const rows = Array.isArray(shelves) ? shelves : [];
  return rows.map((s) => ({
    ...s,
    channels: (Array.isArray(s.channels) ? s.channels : []).map((ch) => {
      const hints = pouredHintsForContact(rules, s.deviceTopicKey, ch.controlId);
      const deskCards = Array.isArray(ch.cards) && ch.cards.length ? ch.cards : [];
      const cards = deskCards.length ? deskCards : cardsFromHints(hints);
      const pouredLoads = pouredLoadsForContact(rules, marks, s.deviceTopicKey, ch.controlId);
      const pouredButtons = pouredButtonsForContact(rules, marks, s.deviceTopicKey, ch.controlId);
      return {
        ...ch,
        hints,
        cards,
        cardsSource: deskCards.length ? "desk" : cards.length ? "rules" : "",
        name: ch.name,
        source: ch.source || "",
        loads: pouredLoads,
        binds: [],
        buttons: pouredButtons,
      };
    }),
  }));
}

export function writeLastDeskShelves(shelves, brokerLabel) {
  const file = lastShelvesPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        version: 1,
        savedAt: new Date().toISOString(),
        brokerLabel: brokerLabel || "",
        shelves: Array.isArray(shelves) ? shelves : [],
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

export async function handleRuntimeMqttScan(req, res) {
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "GET") {
    const last = readLastDeskShelves();
    last.shelves = withPouredHints(applyMarksToShelves(last.shelves));
    jsonEnd(res, 200, last);
    return;
  }
  if (typeof mqttScanHandler !== "function") {
    res.statusCode = 501;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: "scan_not_wired" }));
    return;
  }
  let body = {};
  if (method === "POST") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    if (raw.trim()) {
      try {
        body = JSON.parse(raw);
      } catch {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: false, error: "invalid_json" }));
        return;
      }
    }
  }
  try {
    const out = await mqttScanHandler(body);
    if (out?.ok && Array.isArray(out.snapshot?.entries)) {
      const grouped = groupDeskShelves(out.snapshot.entries);
      const merged = rememberDeskShelves(readLastDeskShelves().shelves, grouped);
      out.shelves = withPouredHints(applyMarksToShelves(merged));
      if (out.shelves.length) {
        writeLastDeskShelves(
          out.shelves.map(({ name: _n, room: _r, channels, ...row }) => ({
            ...row,
            channels: Array.isArray(channels)
              ? channels.map((c) =>
                  c && Object.prototype.hasOwnProperty.call(c, "lastValue")
                    ? { controlId: c.controlId, lastValue: c.lastValue }
                    : { controlId: c.controlId },
                )
              : [],
          })),
          out.brokerLabel,
        );
      }
    }
    res.statusCode = out?.ok ? 200 : 409;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(out ?? { ok: false, error: "empty_scan" }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: String(err?.message ?? err) }));
  }
}

function jsonEnd(res, status, obj) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

export async function handleRuntimeDeskMarking(req, res) {
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "GET") {
    jsonEnd(res, 200, { ok: true, ...readDeskMarking(), rooms: listDeskRooms() });
    return;
  }
  if (method !== "PUT" && method !== "POST") {
    jsonEnd(res, 405, { ok: false, error: "method" });
    return;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let body = {};
  try {
    const raw = Buffer.concat(chunks).toString("utf8");
    if (raw.trim()) body = JSON.parse(raw);
  } catch {
    jsonEnd(res, 400, { ok: false, error: "invalid_json" });
    return;
  }
  if (body.clear === "project" || body.clearProject === true) {
    jsonEnd(res, 200, clearDeskProject());
    return;
  }
  if (body.clear === true || body.clear === "shelves") {
    jsonEnd(res, 200, clearDeskShelvesMarking());
    return;
  }
  if (body.room && !body.deviceTopicKey) {
    const out = upsertDeskRoom(body.room);
    jsonEnd(res, out.ok ? 200 : 400, out);
    return;
  }
  const out = upsertDeskShelfMark(body);
  jsonEnd(res, out.ok ? 200 : 400, out);
}

export function handleRuntimeDeskPourPreview(_req, res) {
  const snap = readPouredDeskSnapshot();
  const out = buildDeskPourPreview(readDeskMarking(), readPouredChannelMarks(), snap.rules || []);
  const gate = assessDeskCanPour(out);
  jsonEnd(res, 200, {
    ok: true,
    ...out,
    canPour: gate.canPour,
    canPourNames: gate.canPourNames,
    canPourRules: gate.canPourRules,
    canRepair: gate.canRepair,
    reason: gate.reason,
  });
}

export function handleRuntimeDeskPourBuild(_req, res) {
  const pkg = buildDeskPourPackage();
  jsonEnd(res, pkg.ok ? 200 : 400, { ok: Boolean(pkg.ok), ...pkg });
}

export { buildDeskPourPackage, assessDeskCanPour };

export async function handleRuntimeDeskKeyPlan(req, res) {
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "GET") {
    jsonEnd(res, 200, { ok: true, keyPlan: listDeskKeyPlan() });
    return;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let body = {};
  try {
    const raw = Buffer.concat(chunks).toString("utf8");
    if (raw.trim()) body = JSON.parse(raw);
  } catch {
    jsonEnd(res, 400, { ok: false, error: "invalid_json" });
    return;
  }
  if (method === "DELETE" || body.delete) {
    jsonEnd(res, 200, deleteDeskKeyPlanItem(body.delete || body.id));
    return;
  }
  if (body.replace === true && Array.isArray(body.keyPlan)) {
    jsonEnd(res, 200, replaceDeskKeyPlan(body.keyPlan));
    return;
  }
  if (body.bind === true || (body.deviceTopicKey && body.controlId && body.id && body.bind !== false)) {
    jsonEnd(res, 200, bindDeskKeyPlanItem(body));
    return;
  }
  if (method !== "PUT" && method !== "POST") {
    jsonEnd(res, 405, { ok: false, error: "method" });
    return;
  }
  if (Array.isArray(body.labels) || typeof body.labelsText === "string") {
    const out = upsertDeskKeyPlanBatch(body);
    jsonEnd(res, out.ok ? 200 : 400, out);
    return;
  }
  const out = upsertDeskKeyPlanItem(body);
  jsonEnd(res, out.ok ? 200 : 400, out);
}

export async function handleRuntimeDeskLinePlan(req, res) {
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "GET") {
    jsonEnd(res, 200, { ok: true, linePlan: listDeskLinePlan() });
    return;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let body = {};
  try {
    const raw = Buffer.concat(chunks).toString("utf8");
    if (raw.trim()) body = JSON.parse(raw);
  } catch {
    jsonEnd(res, 400, { ok: false, error: "invalid_json" });
    return;
  }
  if (method === "DELETE" || body.delete) {
    jsonEnd(res, 200, deleteDeskLinePlanItem(body.delete || body.id));
    return;
  }
  if (body.candidates === true && Array.isArray(body.shelves)) {
    jsonEnd(res, 200, {
      ok: true,
      candidates: deskBeaconCandidates(body.shelves, { includeNamed: body.includeNamed === true }),
    });
    return;
  }
  if (body.bind === true || (body.deviceTopicKey && body.controlId && body.id && body.bind !== false)) {
    jsonEnd(res, 200, bindDeskLinePlanItem(body));
    return;
  }
  if (method !== "PUT" && method !== "POST") {
    jsonEnd(res, 405, { ok: false, error: "method" });
    return;
  }
  if (Array.isArray(body.labels) || typeof body.labelsText === "string") {
    const out = upsertDeskLinePlanBatch(body);
    jsonEnd(res, out.ok ? 200 : 400, out);
    return;
  }
  const out = upsertDeskLinePlanItem(body);
  jsonEnd(res, out.ok ? 200 : 400, out);
}

export async function handleRuntimeDeskSolutions(req, res) {
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "GET") {
    jsonEnd(res, 200, { ok: true, catalog: deskSolutionCatalog(), solutions: listDeskSolutions() });
    return;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let body = {};
  try {
    const raw = Buffer.concat(chunks).toString("utf8");
    if (raw.trim()) body = JSON.parse(raw);
  } catch {
    jsonEnd(res, 400, { ok: false, error: "invalid_json" });
    return;
  }
  if (method === "DELETE" || body.delete) {
    jsonEnd(res, 200, deleteDeskSolution(body.delete || body.id));
    return;
  }
  if (method !== "PUT" && method !== "POST") {
    jsonEnd(res, 405, { ok: false, error: "method" });
    return;
  }
  const out = upsertDeskSolution(body);
  jsonEnd(res, out.ok ? 200 : 400, out);
}

export function handleRuntimeDeskPoured(_req, res) {
  const snap = readPouredDeskSnapshot();
  const rules = (snap.rules || []).map((r) => ({
    ...r,
    contacts: (r.contacts || []).map((c) => ({
      ...c,
      label: formatDeskShelfLabel(c.deviceTopicKey) || c.deviceTopicKey,
    })),
  }));
  jsonEnd(res, 200, { ok: true, ...snap, rules });
}

/** Полевой сертификат: checklist + passport JSON. */
export function handleRuntimeFieldCert(req, res, live = {}) {
  const last = readLastDeskShelves();
  const out = buildFieldCertificate({
    ...live,
    shelves: last.shelves || [],
  });
  jsonEnd(res, 200, out);
}

/**
 * POST /runtime/desk-actuate — прозвонка нагрузки (on/off/pulse).
 * GET  /runtime/desk-actuate?deviceTopicKey=&controlId= — live входа (замкнуто?).
 */
export async function handleRuntimeDeskActuate(req, res) {
  const method = (req.method ?? "GET").toUpperCase();
  const url = new URL(req.url || "/runtime/desk-actuate", "http://local");
  if (method === "GET") {
    const deviceTopicKey = String(url.searchParams.get("deviceTopicKey") || "").trim();
    const controlId = String(url.searchParams.get("controlId") || "").trim();
    if (!deviceTopicKey || !controlId) {
      jsonEnd(res, 400, { ok: false, error: "need_contact" });
      return;
    }
    const shelves = readLastDeskShelves().shelves || [];
    const shelf = shelves.find((s) => s && s.deviceTopicKey === deviceTopicKey);
    const ch = (shelf?.channels || []).find((c) => c && c.controlId === controlId);
    const lastValue = ch && Object.prototype.hasOwnProperty.call(ch, "lastValue") ? ch.lastValue : null;
    const input = isDeskInputControl(controlId, deviceTopicKey);
    jsonEnd(res, 200, {
      ok: true,
      deviceTopicKey,
      controlId,
      input,
      lastValue,
      closed: input ? deskInputClosed(lastValue) : null,
      on: !input && deskInputClosed(lastValue),
    });
    return;
  }
  if (method !== "POST") {
    jsonEnd(res, 405, { ok: false, error: "method" });
    return;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let body = {};
  try {
    const raw = Buffer.concat(chunks).toString("utf8");
    if (raw.trim()) body = JSON.parse(raw);
  } catch {
    jsonEnd(res, 400, { ok: false, error: "invalid_json" });
    return;
  }
  const out = await actuateDeskChannel(body);
  if (out.ok && body.deviceTopicKey && body.controlId) {
    const desired = String(body.desired || out.desired || "").toLowerCase();
    if (desired === "on" || desired === "off") {
      const shelves = readLastDeskShelves().shelves || [];
      const next = shelves.map((s) => {
        if (!s || s.deviceTopicKey !== body.deviceTopicKey) return s;
        return {
          ...s,
          channels: (s.channels || []).map((c) => {
            if (!c || c.controlId !== body.controlId) return c;
            return {
              ...c,
              lastValue: desired === "on" ? (out.value ?? "1") : "0",
            };
          }),
        };
      });
      writeLastDeskShelves(next, readLastDeskShelves().brokerLabel);
    }
  }
  jsonEnd(res, out.ok ? 200 : 409, out);
}
