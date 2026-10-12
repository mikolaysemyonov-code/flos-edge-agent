/**
 * Локальный стол пуска (как HA :8123): страница с контейнера + скан MQTT на щите.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { groupDeskShelves } from "./runtime-desk-shelves.mjs";

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

export async function handleRuntimeMqttScan(req, res) {
  if (typeof mqttScanHandler !== "function") {
    res.statusCode = 501;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: "scan_not_wired" }));
    return;
  }
  let body = {};
  if (req.method === "POST") {
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
      out.shelves = groupDeskShelves(out.snapshot.entries);
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
