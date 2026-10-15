/**
 * Журнал экспресс-аудита: импульс подписанных линий + снимок результата.
 * Сам pulse делает стол (actuate); сюда пишем лог сдачи.
 */
import fs from "node:fs";
import path from "node:path";
import { deskMarkingPath } from "./runtime-desk-marking.mjs";
import { isDeskBeaconLoad, deskBeaconKind } from "./runtime-desk-line-beacon.mjs";

const MAX_RUNS = 12;
const MAX_ROWS = 80;

function auditPath() {
  return path.join(path.dirname(deskMarkingPath()), "desk-audit-log.json");
}

function readLog() {
  try {
    const json = JSON.parse(fs.readFileSync(auditPath(), "utf8"));
    return Array.isArray(json?.runs) ? json.runs : [];
  } catch {
    return [];
  }
}

function writeLog(runs) {
  const file = auditPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, runs }, null, 2) + "\n", "utf8");
}

/** Подписанные нагрузки для аудита (свет/реле с именем). */
export function deskAuditTargets(shelves) {
  const out = [];
  for (const s of Array.isArray(shelves) ? shelves : []) {
    const dk = String(s?.deviceTopicKey || "").trim();
    for (const ch of Array.isArray(s?.channels) ? s.channels : []) {
      const cid = String(ch?.controlId || "").trim();
      const name = String(ch?.name || "").trim();
      if (!name || !isDeskBeaconLoad(cid, dk)) continue;
      out.push({
        deviceTopicKey: dk,
        controlId: cid,
        name,
        kind: deskBeaconKind(cid, dk),
      });
      if (out.length >= MAX_ROWS) return out;
    }
  }
  return out;
}

export function listDeskAuditRuns() {
  return readLog().slice(0, MAX_RUNS);
}

export function saveDeskAuditRun(input) {
  const rows = Array.isArray(input?.rows) ? input.rows : [];
  const clean = [];
  for (const r of rows) {
    const dk = String(r?.deviceTopicKey || "").trim();
    const cid = String(r?.controlId || "").trim();
    const name = String(r?.name || "").trim().slice(0, 80);
    if (!dk || !cid) continue;
    clean.push({
      deviceTopicKey: dk,
      controlId: cid,
      name,
      kind: r?.kind === "led" ? "led" : "relay",
      ok: r?.ok === true,
      error: r?.ok === true ? undefined : String(r?.error || "fail").slice(0, 80),
    });
    if (clean.length >= MAX_ROWS) break;
  }
  if (!clean.length) return { ok: false, error: "need_rows" };
  const okN = clean.filter((r) => r.ok).length;
  const run = {
    id: "audit_" + Date.now().toString(36),
    at: new Date().toISOString(),
    label: String(input?.label || "Экспресс-аудит").slice(0, 60),
    ok: okN === clean.length,
    okCount: okN,
    failCount: clean.length - okN,
    rows: clean,
  };
  const runs = [run, ...readLog()].slice(0, MAX_RUNS);
  writeLog(runs);
  return { ok: true, run, runs };
}
