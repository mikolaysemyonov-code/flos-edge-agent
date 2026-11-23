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
  readDeskDocument,
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
import {
  deleteDeskLoadGroup,
  listDeskLoadGroups,
  upsertDeskLoadGroup,
} from "./runtime-desk-groups.mjs";
import { buildFieldCertificate } from "./runtime-desk-field-cert.mjs";
import {
  cardsFromHints,
  pouredHintsForContact,
  pouredButtonsForContact,
  pouredLoadsForContact,
  readPouredChannelMarks,
  readPouredDeskSnapshot,
} from "./runtime-desk-rules-marks.mjs";
import { applyDeskScanShelves, deskScanGap, formatDeskShelfLabel, groupDeskShelves } from "./runtime-desk-shelves.mjs";
import { deskHaLights } from "./runtime-desk-ha-lights.mjs";
import {
  deskHaStatus,
  disableDeskHaBridge,
  startDeskHaBridge,
  syncHaDaliState,
} from "./runtime-desk-ha-bridge.mjs";
import { assessDeskCanPour, buildDeskPourPackage } from "./runtime-desk-pour.mjs";
import {
  actuateDeskChannel,
  deskInputClosed,
  isDeskInputControl,
} from "./runtime-desk-actuate.mjs";
import {
  countDaliBusAddresses,
  daliGatewaysFromShelves,
  firstDaliGatewayFromShelves,
  parseDaliChannelId,
  pickDaliScanBusId,
} from "./runtime-desk-dali.mjs";
import {
  applyDaliGroupMembers,
  daliBridgeStatus,
  daliGroupTempCommands,
  daliSendCommands,
  installDaliBridge,
  listDaliGateways,
  memberAddrsOf,
  readDaliGroupMembers,
  resolveDaliBusId,
  scanDaliBus,
} from "./runtime-desk-dali-rpc.mjs";
import {
  daliActuateProofLine,
  daliProbeLine,
  followDaliGroup,
  probeDaliLatency,
  proveDaliActuate,
  verifyDaliGroupOnBus,
} from "./runtime-desk-dali-probe.mjs";
import {
  bindDeskKeyPlanItem,
  captureDeskKeyPlanItem,
  captureDeskKeyDraft,
  patchDeskKeyRow,
  deleteDeskKeyPlanItem,
  listDeskKeyPlan,
  replaceDeskKeyPlan,
  upsertDeskKeyPlanBatch,
  upsertDeskKeyPlanItem,
} from "./runtime-desk-key-scan.mjs";
import { addDeskRoom, listDeskWalk, setDeskSite } from "./runtime-desk-walk.mjs";
import {
  bindDeskLinePlanItem,
  markDeskBeaconChannel,
  deleteDeskLinePlanItem,
  deskBeaconCandidates,
  listDeskLinePlan,
  upsertDeskLinePlanBatch,
  upsertDeskLinePlanItem,
} from "./runtime-desk-line-beacon.mjs";
import { assessDeskHealth, DESK_TIME_ZONES, deskTimeZoneById } from "./runtime-desk-health.mjs";
import {
  cleanDeskPassword,
  deskGateAllows,
  deskSessionCookie,
  hashDeskPassword,
  openDeskSession,
  readDeskGate,
  verifyDeskPassword,
  writeDeskGate,
} from "./runtime-desk-gate.mjs";
import {
  deskAuditTargets,
  listDeskAuditRuns,
  saveDeskAuditRun,
} from "./runtime-desk-audit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

let mqttScanHandler = null;
let clockSetter = null;
let rootSetter = null;

export function setRuntimeMqttScanHandler(fn) {
  mqttScanHandler = typeof fn === "function" ? fn : null;
}

export function setRuntimeClockSetter(fn) {
  clockSetter = typeof fn === "function" ? fn : null;
}

export function setRuntimeRootSetter(fn) {
  rootSetter = typeof fn === "function" ? fn : null;
}

export function serveCommissionDesk(_req, res) {
  const file = path.join(HERE, "desk.html");
  try {
    let html = fs.readFileSync(file, "utf8");
    const token = (
      process.env.FLOS_RUNTIME_HTTP_AUTH_TOKEN ||
      process.env.REACTOR_RUNTIME_HTTP_AUTH_TOKEN ||
      ""
    ).trim();
    if (token && !readDeskGate()) {
      const safe = token.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
      html = html.replace(
        "<head>",
        `<head>\n  <meta name="flos-desk-token" content="${safe}" />`,
      );
    }
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

function readLastDeskShelvesFile() {
  const file = lastShelvesPath();
  if (!fs.existsSync(file)) return null;
  try {
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!json || typeof json !== "object" || Array.isArray(json)) return { unreadable: true };
    return json;
  } catch {
    return { unreadable: true };
  }
}

export function readLastDeskShelves() {
  const json = readLastDeskShelvesFile();
  if (!json) return { ok: true, cached: true, shelves: [], scan: null };
  if (json.unreadable) return { ok: false, error: "cache_unreadable", cached: true, shelves: [], scan: null };
  const shelves = Array.isArray(json?.shelves) ? json.shelves : [];
  return {
    ok: true,
    cached: true,
    brokerLabel: typeof json?.brokerLabel === "string" ? json.brokerLabel : "",
    shelves,
    scan: json?.scan && typeof json.scan === "object" ? json.scan : null,
  };
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

export function writeLastDeskShelves(shelves, brokerLabel, scan) {
  const file = lastShelvesPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const prev = readLastDeskShelvesFile();
  const nextScan = scan === undefined ? (prev?.scan && typeof prev.scan === "object" ? prev.scan : null) : scan;
  const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`;
  fs.writeFileSync(
    tmp,
    JSON.stringify(
      {
        version: 1,
        savedAt: new Date().toISOString(),
        brokerLabel: brokerLabel || "",
        scan: nextScan,
        shelves: Array.isArray(shelves) ? shelves : [],
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  fs.renameSync(tmp, file);
}

/** Живой опрос входов меняет значения. Состав модулей берётся только из полного снимка MQTT. */

export async function handleRuntimeMqttScan(req, res) {
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "GET") {
    const last = readLastDeskShelves();
    if (last.error === "cache_unreadable") {
      jsonEnd(res, 409, { ok: false, error: "cache_unreadable" });
      return;
    }
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
      const partial = body?.inputsOnly === true || Boolean(String(body?.deviceTopicKey || "").trim());
      const grouped = groupDeskShelves(out.snapshot.entries);
      const prevRead = readLastDeskShelves();
      const prev = prevRead.ok ? prevRead : { shelves: [] };
      const modulesBefore = Array.isArray(prev.shelves) ? prev.shelves.length : 0;
      const modulesSeen = grouped.length;
      const gap = deskScanGap(prev.shelves, grouped);
      const modulesMissing = gap.modulesMissing;
      const channelsMissing = gap.channelsMissing;
      const shortScan = false;
      const ready = !partial && out.scan?.settled === true && out.scan?.truncated !== true;
      const merged = applyDeskScanShelves(prev.shelves, grouped, { partial, ready });
      out.shelves = withPouredHints(applyMarksToShelves(merged));
      const grew = Array.isArray(merged) && merged.length > modulesBefore;
      if (!partial && out.scan && typeof out.scan === "object") {
        out.scan = { ...out.scan, modulesBefore, modulesSeen, modulesMissing, channelsMissing, shortScan };
      }
      if (ready || grew || (partial && out.shelves.length)) {
        const scanMeta = partial
          ? undefined
          : {
              truncated: out.scan?.truncated === true,
              discoverableDeviceCount: out.scan?.discoverableDeviceCount ?? null,
              topicCount: out.scan?.topicCount ?? null,
              omittedDeviceHint: out.scan?.omittedDeviceHint || null,
              settled: out.scan?.settled === true,
              modulesBefore,
              modulesSeen,
              modulesMissing,
              channelsMissing,
              shortScan,
              offlineDeviceCount: Number(out.scan?.offlineDeviceCount) || 0,
              savedAt: new Date().toISOString(),
            };
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
          scanMeta,
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

function markingBlocked() {
  const doc = readDeskDocument();
  if (!doc.unreadable) return null;
  return { ok: false, error: "marking_unreadable" };
}

export async function handleRuntimeDeskMarking(req, res) {
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "GET") {
    const blocked = markingBlocked();
    jsonEnd(res, 200, blocked || { ok: true, ...readDeskMarking(), rooms: listDeskRooms() });
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
    const blocked = markingBlocked();
    jsonEnd(res, 200, blocked || { ok: true, keyPlan: listDeskKeyPlan(), ...listDeskWalk() });
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
    const out = replaceDeskKeyPlan(body.keyPlan);
    jsonEnd(res, out.ok ? 200 : 400, out);
    return;
  }
  if (body.site && typeof body.site === "object") {
    const out = setDeskSite(body.site);
    jsonEnd(res, out.ok ? 200 : 400, out);
    return;
  }
  if (body.addRoom && typeof body.addRoom === "object") {
    const out = addDeskRoom(body.addRoom);
    jsonEnd(res, out.ok ? 200 : 400, out);
    return;
  }
  if (body.draft === true) {
    jsonEnd(res, 200, captureDeskKeyDraft(body));
    return;
  }
  if (body.patch === true) {
    jsonEnd(res, 200, patchDeskKeyRow(body));
    return;
  }
  if (body.capture === true) {
    jsonEnd(res, 200, captureDeskKeyPlanItem(body));
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
    const blocked = markingBlocked();
    jsonEnd(res, 200, blocked || { ok: true, linePlan: listDeskLinePlan() });
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
      candidates: deskBeaconCandidates(body.shelves, {
        includeNamed: body.includeNamed === true,
        family: body.family,
      }),
    });
    return;
  }
  if (body.mark === true) {
    jsonEnd(res, 200, markDeskBeaconChannel(body));
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

function gateView(req) {
  const locked = Boolean(readDeskGate());
  const open = deskGateAllows(req?.headers?.cookie, false);
  return { ok: true, locked, open: locked ? open : true };
}

export async function handleRuntimeDeskGate(req, res) {
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "GET") {
    jsonEnd(res, 200, gateView(req));
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
  const action = body?.action === "open" ? "open" : "set";
  const password = cleanDeskPassword(body?.password);
  const again = String(body?.again ?? "");
  const existing = readDeskGate();
  if (action === "open") {
    if (!existing || !password || !verifyDeskPassword(password, existing)) {
      jsonEnd(res, 401, { ok: false, error: "password" });
      return;
    }
  } else {
    if (!password || again !== password) {
      jsonEnd(res, 400, { ok: false, error: "password_mismatch" });
      return;
    }
    if (existing) {
      const session = deskGateAllows(req?.headers?.cookie, false);
      const currentOk = verifyDeskPassword(String(body?.current ?? ""), existing);
      if (!session && !currentOk) {
        jsonEnd(res, 401, { ok: false, error: "desk_locked" });
        return;
      }
    }
    writeDeskGate(hashDeskPassword(password));
  }
  const token = openDeskSession();
  res.setHeader("set-cookie", deskSessionCookie(token));
  jsonEnd(res, 200, { ok: true, locked: true, open: true });
}

export async function handleRuntimeDeskRoot(req, res) {
  if ((req.method ?? "GET").toUpperCase() !== "POST") {
    jsonEnd(res, 405, { ok: false, error: "method" });
    return;
  }
  if (!readDeskGate()) {
    jsonEnd(res, 409, { ok: false, error: "need_interface_password" });
    return;
  }
  if (!deskGateAllows(req?.headers?.cookie, false)) {
    jsonEnd(res, 401, { ok: false, error: "desk_locked" });
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
  const password = cleanDeskPassword(body?.password);
  if (!password || String(body?.again ?? "") !== password) {
    jsonEnd(res, 400, { ok: false, error: "password_mismatch" });
    return;
  }
  if (!rootSetter) {
    jsonEnd(res, 503, { ok: false, error: "root_unavailable" });
    return;
  }
  try {
    await rootSetter(password);
    jsonEnd(res, 200, { ok: true });
  } catch {
    jsonEnd(res, 502, { ok: false, error: "root_set_failed" });
  }
}

export async function handleRuntimeDeskClock(req, res) {
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "GET") {
    jsonEnd(res, 200, { ok: true, zones: DESK_TIME_ZONES });
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
  const zone = deskTimeZoneById(body?.zone);
  if (!zone) {
    jsonEnd(res, 400, { ok: false, error: "unknown_zone" });
    return;
  }
  if (!clockSetter) {
    jsonEnd(res, 503, { ok: false, error: "clock_unavailable" });
    return;
  }
  try {
    const clock = await clockSetter(zone.id);
    jsonEnd(res, 200, { ok: true, zone: zone.id, clock: clock || null });
  } catch {
    jsonEnd(res, 502, { ok: false, error: "clock_set_failed" });
  }
}

export async function handleRuntimeDeskHealth(req, res) {
  const method = (req.method ?? "GET").toUpperCase();
  let shelves = [];
  if (method === "POST") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    try {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.trim()) {
        const body = JSON.parse(raw);
        if (Array.isArray(body.shelves)) shelves = body.shelves;
      }
    } catch {
      jsonEnd(res, 400, { ok: false, error: "invalid_json" });
      return;
    }
  }
  const blocked = markingBlocked();
  if (blocked) {
    jsonEnd(res, 409, blocked);
    return;
  }
  const health = assessDeskHealth(shelves, {
    keyPlan: listDeskKeyPlan(),
    linePlan: listDeskLinePlan(),
    solutions: listDeskSolutions(),
  });
  jsonEnd(res, 200, { ok: true, ...health });
}

export async function handleRuntimeDeskAudit(req, res) {
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "GET") {
    jsonEnd(res, 200, { ok: true, runs: listDeskAuditRuns() });
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
  if (body.targets === true && Array.isArray(body.shelves)) {
    jsonEnd(res, 200, { ok: true, targets: deskAuditTargets(body.shelves) });
    return;
  }
  jsonEnd(res, 200, saveDeskAuditRun(body));
}

export async function handleRuntimeDeskGroups(req, res) {
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "GET") {
    const blocked = markingBlocked();
    jsonEnd(res, 200, blocked || { ok: true, groups: listDeskLoadGroups() });
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
    jsonEnd(res, 200, deleteDeskLoadGroup(body.delete || body.id));
    return;
  }
  if (method !== "PUT" && method !== "POST") {
    jsonEnd(res, 405, { ok: false, error: "method" });
    return;
  }
  const out = upsertDeskLoadGroup(body);
  jsonEnd(res, out.ok ? 200 : 400, out);
}

export async function handleRuntimeDeskSolutions(req, res) {
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "GET") {
    const blocked = markingBlocked();
    jsonEnd(res, 200, blocked || { ok: true, catalog: deskSolutionCatalog(), solutions: listDeskSolutions() });
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

/** GET/POST /runtime/desk-ha — сырой мост на Mosquitto mini-PC (HA). */
export async function handleRuntimeDeskHa(req, res) {
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "GET") {
    jsonEnd(res, 200, deskHaStatus());
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
  if (body.enabled === false || body.stop === true) {
    jsonEnd(res, 200, disableDeskHaBridge());
    return;
  }
  const out = startDeskHaBridge(body);
  jsonEnd(res, out.ok ? 200 : 400, out);
}

export function handleRuntimeDeskHaLights(_req, res) {
  const dir = (
    process.env.FLOS_WB_RULES_DEPLOY_DIR ||
    process.env.REACTOR_WB_RULES_DEPLOY_DIR ||
    "/etc/wb-rules"
  ).trim();
  let core = "";
  let rules = "";
  try { core = fs.readFileSync(path.join(dir, "00_core.js"), "utf8"); } catch { core = ""; }
  try { rules = fs.readFileSync(path.join(dir, "40_rules_user.js"), "utf8"); } catch { rules = ""; }
  jsonEnd(res, 200, { ok: true, lights: deskHaLights(core, rules) });
}

/** Текст 40_rules_user.js с диска щита. Только этот файл, без пути из запроса. */
export function handleRuntimeDeskRulesFile(_req, res) {
  const dir = (
    process.env.FLOS_WB_RULES_DEPLOY_DIR ||
    process.env.REACTOR_WB_RULES_DEPLOY_DIR ||
    "/etc/wb-rules"
  ).trim();
  const filename = "40_rules_user.js";
  try {
    const content = fs.readFileSync(path.join(dir, filename), "utf8");
    jsonEnd(res, 200, { ok: true, filename, content });
  } catch {
    jsonEnd(res, 200, { ok: true, filename, content: "" });
  }
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
  let out = await actuateDeskChannel(body);
  const parsed = parseDaliChannelId(body.controlId);
  const desiredAct = String(body.desired || out.desired || "").toLowerCase();
  if (parsed?.kind === "group" && desiredAct === "temp") {
    const mired = Number(body.temp ?? out.value);
    const busId = await resolveDaliBusId(body.deviceTopicKey, parsed.bus);
    const sent = await daliSendCommands(busId, daliGroupTempCommands(parsed.group, mired), 8_000);
    out = {
      ...out,
      ok: sent?.ok !== false,
      via: "dt8",
      busId,
      error: sent?.ok === false ? sent.error : out.error,
    };
    syncHaDaliState(body.deviceTopicKey, parsed.channelId, 100, mired);
  } else if (parsed && (parsed.kind === "group" || parsed.kind === "addr")) {
    const desired = desiredAct;
    const pct = desired === "off" ? 0 : desired === "level" ? Number(body.level ?? out.value) : 100;
    const members =
      parsed.kind === "group"
        ? (readDeskMarking()?.shelves?.[body.deviceTopicKey]?.channels?.[parsed.channelId]?.members || [])
        : [parsed.channelId];
    const proof = await proveDaliActuate({
      gateway: body.deviceTopicKey,
      controlId: parsed.channelId,
      members,
      pct,
    });
    out = {
      ...out,
      ...proof,
      line: daliActuateProofLine(proof),
      ok: Boolean(out.ok || proof.ok),
    };
    if (out.ok && parsed.kind === "group") {
      const n = Number.isFinite(pct) ? pct : 100;
      syncHaDaliState(body.deviceTopicKey, parsed.channelId, n);
    }
  }
  if (out.ok && body.deviceTopicKey && body.controlId) {
    const desired = String(body.desired || out.desired || "").toLowerCase();
    if (desired === "on" || desired === "off" || desired === "level") {
      const heard = new Set(Array.isArray(out.followed) ? out.followed : []);
      const shelves = readLastDeskShelves().shelves || [];
      const next = shelves.map((s) => {
        if (!s || s.deviceTopicKey !== body.deviceTopicKey) return s;
        return {
          ...s,
          channels: (s.channels || []).map((c) => {
            if (!c) return c;
            const isTarget = c.controlId === body.controlId;
            const isMember = heard.has(c.controlId);
            if (!isTarget && !isMember) return c;
            if (parsed && !heard.size && isTarget) return c;
            const lastValue =
              desired === "off" ? "0" : desired === "level" ? String(body.level ?? out.value ?? "0") : (out.value ?? "1");
            return { ...c, lastValue };
          }),
        };
      });
      writeLastDeskShelves(next, readLastDeskShelves().brokerLabel);
    }
  }
  jsonEnd(res, out.ok ? 200 : 409, out);
}

/** POST /runtime/desk-dali-group — состав группы на шине + имя на столе. */
export async function handleRuntimeDeskDaliGroup(req, res) {
  if ((req.method ?? "GET").toUpperCase() !== "POST") {
    jsonEnd(res, 405, { ok: false, error: "method" });
    return;
  }
  const blocked = markingBlocked();
  if (blocked) {
    jsonEnd(res, 409, blocked);
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
  const gateway = String(body.gateway || body.deviceTopicKey || "").trim();
  const parsed = parseDaliChannelId(body.controlId);
  if (!gateway || parsed?.kind !== "group") {
    jsonEnd(res, 400, { ok: false, error: "need_group" });
    return;
  }
  const members = [...new Set((Array.isArray(body.members) ? body.members : []).map((m) => String(m || "").trim()))]
    .filter((m) => parseDaliChannelId(m)?.kind === "addr" && parseDaliChannelId(m).bus === parsed.bus);
  const prev = readDeskMarking()?.shelves?.[gateway]?.channels?.[parsed.channelId]?.members;
  const prevSet = new Set(Array.isArray(prev) ? prev : []);
  const nextSet = new Set(members);
  const addAddrs = memberAddrsOf(members.filter((m) => !prevSet.has(m)));
  const removeAddrs = memberAddrsOf([...prevSet].filter((m) => !nextSet.has(m)));
  const name = typeof body.name === "string" ? body.name : undefined;
  const marked = upsertDeskShelfMark({
    deviceTopicKey: gateway,
    controlId: parsed.channelId,
    name,
    members,
  });
  if (!marked.ok) {
    jsonEnd(res, 409, { ok: false, error: marked.error || "desk_group" });
    return;
  }
  const bus = await applyDaliGroupMembers({
    gateway,
    bus: parsed.bus,
    group: parsed.group,
    addAddrs,
    removeAddrs,
    memberControlIds: members,
  });
  const proof = await verifyDaliGroupOnBus({
    gateway,
    controlId: parsed.channelId,
    members,
    apply: false,
  });
  jsonEnd(res, 200, {
    ok: true,
    controlId: parsed.channelId,
    members,
    marked: true,
    bus,
    onBus: proof.members,
    missing: proof.missing,
    extra: proof.extra,
    match: proof.ok === true,
    error: bus.ok || bus.skipped ? undefined : bus.error || "dali_group",
  });
}

/** POST /runtime/desk-dali-probe — секундомер клавиша→лампа или проверка группы. */
export async function handleRuntimeDeskDaliProbe(req, res) {
  if ((req.method ?? "GET").toUpperCase() !== "POST") {
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
  const gateway = String(body.gateway || body.deviceTopicKey || "").trim();
  const controlId = String(body.controlId || "").trim();
  if (body.kind === "group" || body.verify === true) {
    const members = Array.isArray(body.members) ? body.members : [];
    const proof = await verifyDaliGroupOnBus({ gateway, controlId, members });
    const follow = proof.ok
      ? await followDaliGroup({ gateway, controlId, members, timeoutMs: 5000 })
      : { ok: false, followed: [], silent: members, of: members.length };
    jsonEnd(res, 200, {
      ...proof,
      follow,
      line: proof.ok
        ? (follow.ok
          ? "Группа на шине: " + follow.followed.length + " из " + follow.of + " пошли за группой"
          : "Состав на шине есть, но лампы не пошли за группой")
        : "Группа на шине не подтвердилась",
    });
    return;
  }
  const probe = await probeDaliLatency({ gateway, controlId, timeoutMs: body.timeoutMs });
  jsonEnd(res, probe.ok ? 200 : 409, { ...probe, line: daliProbeLine(probe) });
}

/** GET/POST /runtime/desk-dali-bridge — статус / apt wb-mqtt-dali на хосте щита. */
export async function handleRuntimeDeskDaliBridge(req, res) {
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "GET") {
    const host = daliBridgeStatus();
    const listed = await listDaliGateways();
    const fromMqtt = Array.isArray(listed.gateways) ? listed.gateways : [];
    const fromShelves = daliGatewaysFromShelves(readLastDeskShelves().shelves);
    const seen = new Set();
    const gateways = [];
    for (const g of [...fromMqtt, ...fromShelves]) {
      const id = String(g?.id || g?.gatewayId || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      gateways.push({ id, name: String(g?.name || id), buses: Array.isArray(g?.buses) ? g.buses : undefined });
    }
    jsonEnd(res, 200, { ...host, gateways, listError: listed.ok ? undefined : listed.error });
    return;
  }
  if (method !== "POST") {
    jsonEnd(res, 405, { ok: false, error: "method" });
    return;
  }
  const blocked = markingBlocked();
  if (blocked) {
    jsonEnd(res, 409, blocked);
    return;
  }
  jsonEnd(res, 200, installDaliBridge());
}

/** POST /runtime/desk-dali-scan — Editor/ScanBus шины 1/2/3. */
export async function handleRuntimeDeskDaliScan(req, res) {
  if ((req.method ?? "GET").toUpperCase() !== "POST") {
    jsonEnd(res, 405, { ok: false, error: "method" });
    return;
  }
  const blocked = markingBlocked();
  if (blocked) {
    jsonEnd(res, 409, blocked);
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
  const bus = Number(body.bus);
  if (!Number.isFinite(bus) || bus < 1 || bus > 3) {
    jsonEnd(res, 400, { ok: false, error: "need_bus" });
    return;
  }
  let gateway = String(body.gateway || "").trim();
  const listed = await listDaliGateways();
  if (!gateway) gateway = String(listed.gateways?.[0]?.id || "").trim();
  if (!gateway) gateway = firstDaliGatewayFromShelves(readLastDeskShelves().shelves);
  const busId = pickDaliScanBusId(listed.gateways, bus, gateway);
  if (!busId) {
    jsonEnd(res, 409, {
      ok: false,
      error: "need_gateway",
      detail: listed.error || "Сначала установите wb-mqtt-dali и дождитесь шлюза на MQTT.",
    });
    return;
  }
  const out = await scanDaliBus(busId);
  const gw = gateway || busId.replace(/_bus_\d+$/, "");
  if (!out.ok) {
    jsonEnd(res, 409, { ...out, gateway: gw, bus, busId });
    return;
  }
  let shelves = readLastDeskShelves().shelves || [];
  if (typeof mqttScanHandler === "function") {
    try {
      const snap = await mqttScanHandler({ scanMs: 10_000 });
      if (snap?.ok && Array.isArray(snap.snapshot?.entries)) {
        const grouped = groupDeskShelves(snap.snapshot.entries);
        const prev = readLastDeskShelves();
        const merged = applyDeskScanShelves(prev.shelves || [], grouped, { partial: false, ready: true });
        shelves = withPouredHints(applyMarksToShelves(merged));
        writeLastDeskShelves(
          shelves.map(({ name: _n, room: _r, channels, ...row }) => ({
            ...row,
            channels: Array.isArray(channels)
              ? channels.map(({ name: _cn, room: _cr, hints: _h, cards: _c, binds: _b, buttons: _bt, loads: _l, ...ch }) => ch)
              : [],
          })),
          prev.brokerLabel,
        );
      }
    } catch {
      /* скан шины уже прошёл */
    }
  }
  const groups = [];
  const shelf = (shelves || []).find((s) => s.deviceTopicKey === gw);
  for (const ch of shelf?.channels || []) {
    const parsedG = parseDaliChannelId(ch.controlId);
    if (parsedG?.kind !== "group" || parsedG.bus !== bus) continue;
    const got = await readDaliGroupMembers(gw, parsedG.bus, parsedG.group);
    if (got.ok) {
      upsertDeskShelfMark({ deviceTopicKey: gw, controlId: parsedG.channelId, members: got.members });
      groups.push({ controlId: parsedG.channelId, members: got.members });
    }
  }
  shelves = withPouredHints(applyMarksToShelves(readLastDeskShelves().shelves || shelves));
  const addrCount = countDaliBusAddresses(shelves, bus, gw);
  jsonEnd(res, 200, {
    ...out,
    ok: true,
    gateway: gw,
    bus,
    busId,
    addrCount,
    groups,
    shelves,
  });
}
