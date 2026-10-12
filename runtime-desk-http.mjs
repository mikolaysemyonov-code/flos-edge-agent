/**
 * Локальный стол пуска (как HA :8123): страница с контейнера + скан MQTT на щите.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyMarksToShelves,
  buildDeskPourPreview,
  deskMarkingPath,
  readDeskMarking,
  upsertDeskShelfMark,
} from "./runtime-desk-marking.mjs";
import {
  cardsFromHints,
  pouredHintsForContact,
  pouredButtonsForContact,
  pouredLoadsForContact,
  readPouredChannelMarks,
  readPouredDeskSnapshot,
} from "./runtime-desk-rules-marks.mjs";
import { formatDeskShelfLabel, groupDeskShelves, rememberDeskShelves } from "./runtime-desk-shelves.mjs";

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
  return (Array.isArray(shelves) ? shelves : []).map((s) => ({
    ...s,
    channels: (Array.isArray(s.channels) ? s.channels : []).map((ch) => {
      const hints = pouredHintsForContact(rules, s.deviceTopicKey, ch.controlId);
      const deskCards = Array.isArray(ch.cards) && ch.cards.length ? ch.cards : [];
      const cards = deskCards.length ? deskCards : cardsFromHints(hints);
      const loads = pouredLoadsForContact(rules, marks, s.deviceTopicKey, ch.controlId);
      const buttons = pouredButtonsForContact(rules, marks, s.deviceTopicKey, ch.controlId);
      const fromLoads = !ch.name && loads.length;
      return {
        ...ch,
        hints,
        cards,
        cardsSource: deskCards.length ? "desk" : cards.length ? "rules" : "",
        name: fromLoads ? loads.join(" · ") : ch.name,
        source: ch.source || (fromLoads ? "loads" : ""),
        loads: fromLoads ? [] : loads,
        buttons,
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
              ? channels.map((c) => ({ controlId: c.controlId }))
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
    jsonEnd(res, 200, { ok: true, ...readDeskMarking() });
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
  const out = upsertDeskShelfMark(body);
  jsonEnd(res, out.ok ? 200 : 400, out);
}

export function handleRuntimeDeskPourPreview(_req, res) {
  const snap = readPouredDeskSnapshot();
  const out = buildDeskPourPreview(readDeskMarking(), readPouredChannelMarks(), snap.rules || []);
  jsonEnd(res, 200, { ok: true, ...out });
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
