/**
 * TCP к PLAYER ZERO + зоны рядом с разметкой.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import {
  ECLER_TCP_PORT,
  eclerCommandFromPayload,
  eclerIsPlaying,
  eclerProbeFrame,
  eclerRpcFrames,
  eclerSetupSnapshot,
  eclerStatePayload,
  eclerTopics,
  normalizeEclerZone,
  parseEclerCommand,
  parseEclerReply,
} from "./runtime-desk-ecler.mjs";
import { deskMarkingPath } from "./runtime-desk-marking.mjs";

function configPath() {
  return path.join(path.dirname(deskMarkingPath()), "desk-ecler.json");
}

export function readDeskEclerConfig() {
  try {
    const json = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    const zones = Array.isArray(json?.zones) ? json.zones.map(normalizeEclerZone).filter(Boolean) : [];
    return { version: 1, zones };
  } catch {
    return { version: 1, zones: [] };
  }
}

export function writeDeskEclerConfig(cfg) {
  const zones = (Array.isArray(cfg?.zones) ? cfg.zones : []).map(normalizeEclerZone).filter(Boolean);
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, zones }, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
  return { version: 1, zones };
}

export function upsertDeskEclerZone(input) {
  const row = normalizeEclerZone(input);
  if (!row) return { ok: false, error: "bad_zone" };
  const cur = readDeskEclerConfig();
  const zones = cur.zones.filter((z) => z.id !== row.id && z.host !== row.host);
  zones.push(row);
  return { ok: true, ...writeDeskEclerConfig({ zones }) };
}

export function deleteDeskEclerZone(id) {
  const want = String(id || "").trim();
  const cur = readDeskEclerConfig();
  return { ok: true, ...writeDeskEclerConfig({ zones: cur.zones.filter((z) => z.id !== want) }) };
}

function zoneById(zoneId) {
  return readDeskEclerConfig().zones.find((z) => z.id === String(zoneId || "").trim()) || null;
}

export function eclerSendTcp(host, port, frames, timeoutMs) {
  const lines = (Array.isArray(frames) ? frames : []).filter(Boolean);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (out) => {
      if (settled) return;
      settled = true;
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(out);
    };
    const sock = net.connect({ host, port: port || ECLER_TCP_PORT });
    let buf = "";
    const ms = Math.max(500, Number(timeoutMs) || 4000);
    sock.setTimeout(ms);
    sock.on("connect", () => {
      for (const f of lines) sock.write(f.endsWith("\n") ? f : f + "\n");
    });
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      const parsed = parseEclerReply(buf);
      if (parsed) finish({ ...parsed, raw: buf });
    });
    sock.on("timeout", () => {
      const parsed = parseEclerReply(buf);
      finish(parsed ? { ...parsed, raw: buf } : { ok: false, error: "timeout", raw: buf });
    });
    sock.on("error", (err) => finish({ ok: false, error: String(err?.message || err || "tcp"), raw: buf }));
    sock.on("close", () => {
      if (settled) return;
      const parsed = parseEclerReply(buf);
      finish(parsed ? { ...parsed, raw: buf } : { ok: false, error: "closed", raw: buf });
    });
  });
}

let publishState = null;

export function bindDeskEclerPublish(fn) {
  publishState = typeof fn === "function" ? fn : null;
}

function emitState(zone, cmd, stats) {
  const topics = eclerTopics(zone.id);
  const body = eclerStatePayload(cmd, stats);
  try {
    if (publishState) publishState(topics.state, body, true);
  } catch {
    /* ignore */
  }
}

export async function probeDeskEclerZone(input) {
  const row = normalizeEclerZone(input) || zoneById(input?.id);
  if (!row) return { ok: false, error: "bad_zone" };
  const sent = await eclerSendTcp(row.host, row.port, [eclerProbeFrame()], 4000);
  const setup = eclerSetupSnapshot(sent?.body, sent?.body?.SourceList);
  return { ...sent, zone: row, setup };
}

const zoneTail = new Map();

function enqueueZone(zoneId, fn) {
  const prev = zoneTail.get(zoneId) || Promise.resolve();
  const next = prev.then(fn, fn);
  zoneTail.set(zoneId, next.catch(() => {}));
  return next;
}

async function resolveToggle(zone, cmd) {
  if (!cmd?.toggle) return cmd;
  const stats = await eclerSendTcp(zone.host, zone.port, [eclerProbeFrame()], 4000);
  if (eclerIsPlaying(stats?.body)) return { stop: true };
  const preset = cmd.preset != null ? cmd.preset : 1;
  return { play: true, preset };
}

export async function driveDeskEclerCommand(zoneId, payload) {
  const zone = zoneById(zoneId);
  if (!zone) return { ok: false, error: "unknown_zone" };
  return enqueueZone(zone.id, async () => {
    let cmd = eclerCommandFromPayload(payload);
    if (cmd.toggle) cmd = await resolveToggle(zone, cmd);
    const frames = eclerRpcFrames(cmd);
    if (!frames.length) return { ok: false, error: "empty_cmd", zone: zone.id, cmd };
    const sent = await eclerSendTcp(zone.host, zone.port, frames, 5000);
    emitState(zone, cmd, sent?.body);
    if (sent?.ok !== false && !cmd.volumeDir) {
      const stats = await eclerSendTcp(zone.host, zone.port, [eclerProbeFrame()], 2500);
      if (stats?.ok) emitState(zone, cmd, stats.body);
    }
    return { ...sent, zone: zone.id, cmd };
  });
}

export function onDeskEclerCommand(topic, buf) {
  const parsed = parseEclerCommand(topic);
  if (!parsed) return false;
  const text = buf ? buf.toString("utf8") : "";
  void driveDeskEclerCommand(parsed.zoneId, text);
  return true;
}
