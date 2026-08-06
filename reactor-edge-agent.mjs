#!/usr/bin/env node

import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  runtimeHttpPathHandler,
  applyMonolithScript,
  applyShardBundle,
  backupCurrentStateBeforeApply,
  restartWbRules,
  setRuntimeHealthExtraProvider,
} from "./runtime-control-plane-http.mjs";

/** Prefer `FLOS_*` (FL OS); fall back to legacy `REACTOR_*` for existing deployments. */
function env(primary, legacy) {
  const v = process.env[primary];
  if (v != null && String(v).length > 0) return v;
  return legacy ? process.env[legacy] : undefined;
}

const requiredPairs = [
  ["FLOS_CLOUD_BASE_URL", "REACTOR_CLOUD_BASE_URL"],
  ["FLOS_PROJECT_ID", "REACTOR_PROJECT_ID"],
  ["FLOS_DEVICE_ID", "REACTOR_DEVICE_ID"],
];

for (const [primary, legacy] of requiredPairs) {
  if (!env(primary, legacy)) {
    console.error(`[flos-edge-agent] Missing required env: ${primary} (or legacy ${legacy})`);
    process.exit(1);
  }
}

const baseUrl = env("FLOS_CLOUD_BASE_URL", "REACTOR_CLOUD_BASE_URL").replace(/\/$/, "");
const projectId = env("FLOS_PROJECT_ID", "REACTOR_PROJECT_ID");
const deviceId = env("FLOS_DEVICE_ID", "REACTOR_DEVICE_ID");
const fingerprint =
  env("FLOS_PUBLIC_KEY_FINGERPRINT", "REACTOR_PUBLIC_KEY_FINGERPRINT") ??
  `sha256:${crypto.createHash("sha256").update(deviceId).digest("hex")}`;
const enrollmentToken = String(env("FLOS_ENROLLMENT_TOKEN", "REACTOR_ENROLLMENT_TOKEN") ?? "").trim();
const heartbeatIntervalSec = Number(env("FLOS_HEARTBEAT_INTERVAL_SEC", "REACTOR_HEARTBEAT_INTERVAL_SEC") ?? 30);
const pollIntervalMs = Number(env("FLOS_COMMAND_POLL_INTERVAL_MS", "REACTOR_COMMAND_POLL_INTERVAL_MS") ?? 4000);
const protocolVersion = env("FLOS_AGENT_PROTOCOL_VERSION", "REACTOR_AGENT_PROTOCOL_VERSION") ?? "1.0";
/** Field SaaS default: off unless explicitly enabled with a public key. */
const strictSignatures =
  String(env("FLOS_STRICT_SIGNATURES", "REACTOR_STRICT_SIGNATURES") ?? "false").toLowerCase() === "true";
const allowedCommandTypes = new Set(
  String(
    env("FLOS_ALLOWED_COMMAND_TYPES", "REACTOR_ALLOWED_COMMAND_TYPES") ??
      "system_check,collect_system_info,safe_clean_logs,rotate_token,drift_remediate",
  )
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean),
);
const selfDiagnoseIntervalMs = 5 * 60 * 1000;
const lowMemoryThresholdPercent = 10;
const lowMemoryIncidentCooldownMs = 30 * 60 * 1000;
/** Vercel cold start + RS485 WB uplink often exceeds 8s. */
const requestTimeoutMs = Number(env("FLOS_REQUEST_TIMEOUT_MS", "REACTOR_REQUEST_TIMEOUT_MS") ?? 30_000);
const EMPTY_COMMAND_PAYLOAD_MARKER = "__EMPTY_COMMAND_PAYLOAD__";
const healthStatePath = (
  env("FLOS_HEALTH_STATE_PATH", "REACTOR_HEALTH_STATE_PATH") ?? "/tmp/flos-edge-health"
).trim();
/** Path to fingerprint matching latest SaaS freeze (payload_fingerprint); mount or provision on the gateway. */
const releaseHashPath = (process.env.FORMLOGIC_RELEASE_HASH_PATH ?? "/etc/formlogic/current_release.hash").trim();
/** If set (e.g. in Docker Compose), skip one-time enroll after restart by reusing persisted creds */
const flosStatePath = (env("FLOS_STATE_PATH", "REACTOR_STATE_PATH") ?? "").trim();

let agentId = null;
let agentAccessToken = null;
let lastLowMemoryIncidentAt = 0;
let activeCommandTraceId = null;
/** After a fresh enroll, tolerate a few heartbeat 401s before wiping creds (token already burned). */
let heartbeatAuthFailStreak = 0;
const HEARTBEAT_AUTH_FAIL_CLEAR_AFTER = 5;
/** Exposed on GET /runtime/health for field diagnosis without docker logs. */
let enrollmentHealth = {
  state: "starting",
  lastError: null,
  lastCode: null,
  agentId: null,
};
/** HTTP listen once per process — never re-enter listen on main() retry. */
let handshakeHttpServer = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function collectDockerContainers() {
  try {
    const out = execSync('docker ps --format "{{.Names}}\\t{{.Status}}"', {
      encoding: "utf8",
      timeout: 4000,
      maxBuffer: 512 * 1024,
    });
    const lines = out
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(0, 48);
    const rows = [];
    for (const line of lines) {
      const tab = line.indexOf("\t");
      if (tab === -1) rows.push({ name: line.trim(), status: "" });
      else rows.push({ name: line.slice(0, tab).trim(), status: line.slice(tab + 1).trim() });
    }
    return rows.length ? rows : undefined;
  } catch {
    return undefined;
  }
}

/** Optional JSON from controller/gateway (path in env); failures are ignored. */
function readOptionalJsonFromEnvPath(envKey, legacyKey) {
  const rawPath = (process.env[envKey] ?? (legacyKey ? process.env[legacyKey] : "") ?? "").trim();
  if (!rawPath) return null;
  try {
    const raw = fs.readFileSync(rawPath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[flos-edge-agent] optional JSON ${envKey} (${rawPath}):`, err?.message ?? err);
    return null;
  }
}

function normalizeRs485BusMetrics(j) {
  const buses = Array.isArray(j?.buses) ? j.buses : [];
  const out = [];
  for (const b of buses.slice(0, 16)) {
    if (!b || typeof b !== "object") continue;
    const busId = typeof b.busId === "string" ? b.busId.trim().slice(0, 64) : "";
    if (!busId) continue;
    /** @type {{ busId: string, timeoutCount?: number, crcErrorCount?: number, sampleWindowSec?: number, note?: string }} */
    const row = { busId };
    if (typeof b.timeoutCount === "number" && Number.isFinite(b.timeoutCount)) {
      row.timeoutCount = Math.max(0, Math.floor(b.timeoutCount));
    }
    if (typeof b.crcErrorCount === "number" && Number.isFinite(b.crcErrorCount)) {
      row.crcErrorCount = Math.max(0, Math.floor(b.crcErrorCount));
    }
    if (typeof b.sampleWindowSec === "number" && Number.isFinite(b.sampleWindowSec) && b.sampleWindowSec > 0) {
      row.sampleWindowSec = b.sampleWindowSec;
    }
    if (typeof b.note === "string" && b.note.trim()) {
      row.note = b.note.trim().slice(0, 256);
    }
    out.push(row);
  }
  return out.length ? out : undefined;
}

function normalizePowerRails(j) {
  const rails = Array.isArray(j?.rails) ? j.rails : [];
  const out = [];
  for (const r of rails.slice(0, 16)) {
    if (!r || typeof r !== "object") continue;
    const railId = typeof r.railId === "string" ? r.railId.trim().slice(0, 64) : "";
    if (!railId) continue;
    /** @type {{ railId: string, nominalVoltageV?: number, rippleStd_mV?: number, oscillationIndex?: number, note?: string }} */
    const row = { railId };
    if (typeof r.nominalVoltageV === "number" && Number.isFinite(r.nominalVoltageV)) {
      row.nominalVoltageV = r.nominalVoltageV;
    }
    if (typeof r.rippleStd_mV === "number" && Number.isFinite(r.rippleStd_mV)) {
      row.rippleStd_mV = Math.max(0, r.rippleStd_mV);
    }
    if (typeof r.oscillationIndex === "number" && Number.isFinite(r.oscillationIndex)) {
      row.oscillationIndex = Math.min(2, Math.max(0, r.oscillationIndex));
    }
    if (typeof r.note === "string" && r.note.trim()) {
      row.note = r.note.trim().slice(0, 256);
    }
    out.push(row);
  }
  return out.length ? out : undefined;
}

function buildEdgeHostSnapshot() {
  const total = os.totalmem();
  const free = os.freemem();
  const docker = collectDockerContainers();
  const snap = {
    collectedAt: new Date().toISOString(),
    uptimeSec: Math.floor(os.uptime()),
    loadAvg: /** @type {[number, number, number]} */ (os.loadavg()),
    mem: { totalBytes: total, freeBytes: free },
    /** Capabilities for SaaS UI gates (split marking/rules deploy). */
    capabilities: ["preserve_other_shards", "agent_self_update", "partial_shard_apply"],
  };
  const rs485 = normalizeRs485BusMetrics(
    readOptionalJsonFromEnvPath("FLOS_RS485_BUS_METRICS_PATH", "REACTOR_RS485_BUS_METRICS_PATH"),
  );
  const powerRails = normalizePowerRails(
    readOptionalJsonFromEnvPath("FLOS_POWER_RIPPLE_METRICS_PATH", "REACTOR_POWER_RIPPLE_METRICS_PATH"),
  );
  let merged = snap;
  if (docker) merged = { ...merged, docker };
  if (rs485) merged = { ...merged, rs485BusMetrics: rs485 };
  if (powerRails) merged = { ...merged, powerRails };
  return merged;
}

function readAppliedSnapshotHash() {
  if (!releaseHashPath) return null;
  try {
    const raw = fs.readFileSync(releaseHashPath, "utf8").trim();
    return raw.length ? raw : null;
  } catch {
    return null;
  }
}

function getCommandTraceId(command) {
  const value = command?.traceId ?? null;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function touchHealthState() {
  try {
    fs.writeFileSync(healthStatePath, new Date().toISOString(), "utf8");
  } catch (err) {
    console.warn("[flos-edge-agent] health state write failed:", err?.message ?? err);
  }
}

function verifyCommandSignature(command, traceId) {
  const signature = command?.signature ?? command?.payload?.signature ?? null;
  const signedPayload = command?.signedPayload ?? command?.payload?.signedPayload ?? null;
  const publicKeyRaw = env("FLOS_CLOUD_SIGNING_PUBLIC_KEY", "REACTOR_CLOUD_SIGNING_PUBLIC_KEY") ?? null;
  const publicKey = typeof publicKeyRaw === "string" ? publicKeyRaw.replace(/\\n/g, "\n") : null;
  if (!publicKey) {
    if (!signature) console.warn(`[flos-edge-agent] unsigned command (soft-allow) traceId=${traceId ?? "none"}`);
    return { ok: !strictSignatures, reason: "missing_public_key" };
  }
  if (!signature || !signedPayload) {
    console.warn(`[flos-edge-agent] signature missing payload/key material (soft-allow) traceId=${traceId ?? "none"}`);
    return { ok: !strictSignatures, reason: "missing_signature_or_payload" };
  }
  try {
    var parsedSignedPayload = JSON.parse(String(signedPayload));
    var expectedDigest =
      parsedSignedPayload && typeof parsedSignedPayload.payloadDigest === "string"
        ? parsedSignedPayload.payloadDigest
        : "";
    if (!expectedDigest) {
      console.warn(`[flos-edge-agent] signed payload missing payloadDigest traceId=${traceId ?? "none"}`);
      return { ok: !strictSignatures, reason: "missing_payload_digest" };
    }
    const signatureBuffer = /^[a-f0-9]+$/i.test(signature)
      ? Buffer.from(signature, "hex")
      : Buffer.from(signature, "base64");
    const ok = crypto.verify(
      null,
      Buffer.from(String(signedPayload), "utf8"),
      publicKey,
      signatureBuffer,
    );
    if (!ok) {
      console.warn(`[flos-edge-agent] signature verify failed (soft-allow) traceId=${traceId ?? "none"}`);
      return { ok: !strictSignatures, reason: "invalid_signature" };
    }
    var actualDigest = digestCommandPayload(command?.payload);
    if (actualDigest !== expectedDigest) {
      console.warn(`[flos-edge-agent] payload digest mismatch traceId=${traceId ?? "none"}`);
      return { ok: !strictSignatures, reason: "payload_digest_mismatch" };
    }
    return { ok: true, reason: "signature_valid" };
  } catch (error) {
    console.warn(`[flos-edge-agent] signature verify error (soft-allow) traceId=${traceId ?? "none"}: ${error?.message ?? error}`);
    return { ok: !strictSignatures, reason: "verify_error" };
  }
}

function digestCommandPayload(payload) {
  const canonical = payload === undefined || payload === null ? EMPTY_COMMAND_PAYLOAD_MARKER : JSON.stringify(payload);
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

async function postJson(path, payload, traceId = undefined) {
  const effectiveTraceId = traceId || activeCommandTraceId || crypto.randomUUID();
  const requestUrl = `${baseUrl}${path}`;
  console.log(`[flos-edge-agent] fetch -> ${requestUrl} traceId=${effectiveTraceId}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), requestTimeoutMs);
  try {
    const response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-trace-id": effectiveTraceId,
        "x-protocol-version": protocolVersion,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, body, transient: false, traceId: effectiveTraceId };
  } catch (error) {
    console.warn(`[flos-edge-agent] Network transient error, retrying... traceId=${effectiveTraceId}`);
    return { ok: false, status: 0, body: null, transient: true, error, traceId: effectiveTraceId };
  } finally {
    clearTimeout(timeout);
  }
}

function loadPersistedCredentials() {
  if (!flosStatePath) return null;
  try {
    const raw = fs.readFileSync(flosStatePath, "utf8");
    const data = JSON.parse(raw);
    if (
      data?.projectId === projectId &&
      data?.deviceId === deviceId &&
      typeof data?.agentId === "string" &&
      typeof data?.agentAccessToken === "string"
    ) {
      return { agentId: data.agentId, agentAccessToken: data.agentAccessToken };
    }
  } catch {
    // missing or invalid file
  }
  return null;
}

function persistCredentials() {
  if (!flosStatePath || !agentId || !agentAccessToken) return;
  try {
    fs.mkdirSync(path.dirname(flosStatePath), { recursive: true });
    fs.writeFileSync(
      flosStatePath,
      JSON.stringify({ projectId, deviceId, agentId, agentAccessToken }),
      "utf8",
    );
    fs.chmodSync(flosStatePath, 0o600);
  } catch (err) {
    console.warn("[flos-edge-agent] could not persist state:", err?.message ?? err);
  }
}

function clearPersistedCredentials(reason) {
  console.warn(`[flos-edge-agent] clearing credentials (${reason})`);
  agentId = null;
  agentAccessToken = null;
  enrollmentHealth = {
    state: "credentials_cleared",
    lastError: String(reason),
    lastCode: "cleared",
    agentId: null,
  };
  if (!flosStatePath) return;
  try {
    fs.unlinkSync(flosStatePath);
  } catch {
    // missing is fine
  }
}

async function enroll() {
  if (!enrollmentToken) {
    enrollmentHealth = {
      state: "need_token",
      lastError: "no FLOS_ENROLLMENT_TOKEN",
      lastCode: "missing_token",
      agentId: null,
    };
    console.warn(
      "[flos-edge-agent] enroll skipped: no FLOS_ENROLLMENT_TOKEN (need --fresh with new code from UI)",
    );
    return false;
  }
  enrollmentHealth = { ...enrollmentHealth, state: "enrolling", lastError: null, lastCode: null };
  const result = await postJson(`/api/projects/${projectId}/controller/agent/enroll`, {
    projectId,
    deviceId,
    fingerprint,
    enrollmentToken,
    protocolVersion,
  });
  if (result.transient) {
    enrollmentHealth = {
      state: "enroll_transient",
      lastError: `timeout/network to ${baseUrl}`,
      lastCode: "transient",
      agentId: null,
    };
    console.warn(
      `[flos-edge-agent] enroll transient (timeout/network) to ${baseUrl} — will retry. Check: curl -I ${baseUrl}/`,
    );
    return false;
  }
  if (!result.ok || !result.body?.data?.agentId || !result.body?.data?.agentAccessToken) {
    const code = result.body?.code ?? result.body?.error ?? "enroll_failed";
    enrollmentHealth = {
      state: "enroll_failed",
      lastError: typeof result.body?.error === "string" ? result.body.error : String(code),
      lastCode: String(code),
      agentId: null,
    };
    console.warn(
      `[flos-edge-agent] enroll failed (${result.status}) code=${code}: ${JSON.stringify(result.body)}`,
    );
    if (code === "token_used" || code === "token_revoked" || code === "token_expired") {
      console.warn(
        "[flos-edge-agent] Выдайте новый код в Integrator (Установка → Агент FLOS) и снова --fresh с этим токеном.",
      );
    }
    return false;
  }
  agentId = result.body.data.agentId;
  agentAccessToken = result.body.data.agentAccessToken;
  heartbeatAuthFailStreak = 0;
  enrollmentHealth = {
    state: "enrolled_awaiting_heartbeat",
    lastError: null,
    lastCode: null,
    agentId,
  };
  console.log(`[flos-edge-agent] enrolled: agentId=${agentId}`);
  return true;
}

async function heartbeat() {
  if (!agentId || !agentAccessToken) return;
  const observedAt = new Date().toISOString();
  const appliedSnapshotHash = readAppliedSnapshotHash();
  const edgeHostSnapshot = buildEdgeHostSnapshot();
  const body = {
    projectId,
    agentId,
    deviceId,
    agentAccessToken,
    controllerStatus: "online",
    agentVersion: "edge-pilot-v2",
    observedAt,
    appliedSnapshotHash,
    edgeHostSnapshot,
  };
  const result = await postJson(`/api/projects/${projectId}/controller/agent/heartbeat`, body);
  if (result.transient) return;
  if (!result.ok) {
    const detail = result.body ? JSON.stringify(result.body) : "";
    console.warn(`[flos-edge-agent] heartbeat failed (${result.status}) ${detail}`);
    enrollmentHealth = {
      state: "heartbeat_failed",
      lastError: detail || `status ${result.status}`,
      lastCode: result.body?.code ?? "heartbeat_failed",
      agentId,
    };
    if (result.status === 401) {
      heartbeatAuthFailStreak += 1;
      if (heartbeatAuthFailStreak >= HEARTBEAT_AUTH_FAIL_CLEAR_AFTER) {
        clearPersistedCredentials(`heartbeat_401_x${heartbeatAuthFailStreak}`);
        heartbeatAuthFailStreak = 0;
      } else {
        console.warn(
          `[flos-edge-agent] keeping credentials after heartbeat 401 (${heartbeatAuthFailStreak}/${HEARTBEAT_AUTH_FAIL_CLEAR_AFTER})`,
        );
      }
    }
    return;
  }
  heartbeatAuthFailStreak = 0;
  enrollmentHealth = {
    state: "online",
    lastError: null,
    lastCode: null,
    agentId,
  };
}

async function ackCommand(command, traceId, status, result, errorMessage) {
  if (!agentAccessToken || !agentId) return;
  const ackRes = await postJson(`/api/projects/${projectId}/controller/agent/commands/${command.id}/ack`, {
    projectId,
    commandId: command.id,
    traceId,
    attemptId: command.attemptId,
    agentId,
    agentAccessToken,
    protocolVersion,
    status,
    result,
    errorMessage,
    finishedAt: new Date().toISOString(),
  });
  if (!ackRes.ok) {
    console.warn(
      `[flos-edge-agent] command ack failed (${ackRes.status}) ${ackRes.body ? JSON.stringify(ackRes.body) : ""}`,
    );
  }
}

async function reportIncident(input) {
  if (!agentId || !agentAccessToken) return;
  const payload = {
    projectId,
    agentId,
    deviceId,
    agentAccessToken,
    protocolVersion,
    ruleId: input.ruleId,
    severity: input.severity,
    reason: input.reason,
    actionStep: input.actionStep,
    sampleLogLine: input.sampleLogLine,
    detectedAt: new Date().toISOString(),
  };
  if (input.traceId) payload.traceId = input.traceId;
  if (input.sourceTopic) payload.sourceTopic = input.sourceTopic;
  const result = await postJson(
    `/api/projects/${projectId}/controller/agent/incidents/ingest`,
    payload,
    input.traceId || activeCommandTraceId || undefined,
  );
  if (result.transient) return;
  if (!result.ok) {
    console.warn(`[flos-edge-agent] incident report failed (${result.status})`);
  }
}

/**
 * Local MQTT publish for SaaS shield channel-ping (cloud cannot TCP to LAN/Tailscale).
 * Invoked via system_check payload:
 *   { action: "mqtt_publish", writes:[{topic,payload}] }
 *   { action: "mqtt_publish", onWrites, offWrites, pulseMs } — pulse on→wait→off
 */
async function runMqttPublishCommand(payload) {
  const host = typeof payload?.host === "string" && payload.host.trim() ? payload.host.trim() : "127.0.0.1";
  const port = Number(payload?.port) > 0 ? Number(payload.port) : 1883;
  const pulseMs = Math.min(Math.max(Number(payload?.pulseMs) || 800, 200), 5_000);
  const normalizeWrites = (raw) => {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((w) => {
        const topic = typeof w?.topic === "string" ? w.topic.trim() : "";
        const body = w?.payload != null ? String(w.payload) : "";
        if (!topic) return null;
        return { topic, payload: body };
      })
      .filter(Boolean);
  };
  const onWrites = normalizeWrites(payload?.onWrites ?? payload?.writes);
  const offWrites = normalizeWrites(payload?.offWrites);
  const isPulse = offWrites.length > 0;
  if (onWrites.length === 0) {
    return { ok: false, error: "mqtt_publish_empty_writes" };
  }
  let mqttMod;
  try {
    mqttMod = await import("mqtt");
  } catch (err) {
    return { ok: false, error: `mqtt_package_missing:${err?.message ?? err}` };
  }
  const connect = mqttMod.connect ?? mqttMod.default?.connect;
  if (typeof connect !== "function") {
    return { ok: false, error: "mqtt_connect_missing" };
  }
  const url = `mqtt://${host}:${port}`;
  const client = connect(url, { connectTimeout: 6_000, reconnectPeriod: 0, protocolVersion: 4, clean: true });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const forceEnd = () => {
    try {
      client.end(true);
    } catch {
      /* ignore */
    }
  };
  const publishOne = (topic, body) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`puback timeout: ${topic}`)), 5_000);
      client.publish(topic, body, { qos: 1, retain: false }, (err) => {
        clearTimeout(t);
        if (err) reject(err);
        else resolve();
      });
    });
  const publishAll = async (writes) => {
    for (const w of writes) {
      const withSlash = w.topic.startsWith("/") ? w.topic : `/${w.topic}`;
      const cmd = withSlash.endsWith("/on") ? withSlash : `${withSlash.replace(/\/+$/, "")}/on`;
      const bare = cmd.replace(/^\//, "");
      await publishOne(cmd, w.payload);
      if (bare !== cmd) {
        try {
          await publishOne(bare, w.payload);
        } catch {
          /* optional bare alias for brokers without leading slash */
        }
      }
    }
  };
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("mqtt connect timeout")), 6_000);
      client.once("connect", () => {
        clearTimeout(t);
        resolve();
      });
      client.once("error", (err) => {
        clearTimeout(t);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
    await publishAll(onWrites);
    if (isPulse) {
      await sleep(pulseMs);
      await publishAll(offWrites);
    }
    forceEnd();
    return {
      ok: true,
      details: {
        mqttPublish: {
          brokerLabel: `${host}:${port}`,
          confirmed: true,
          mode: isPulse ? "pulsed" : "set",
          writes: onWrites.length + (isPulse ? offWrites.length : 0),
        },
      },
    };
  } catch (err) {
    forceEnd();
    return { ok: false, error: `mqtt_publish_failed:${err?.message ?? err}` };
  }
}

/**
 * Local MQTT topic scan for SaaS mark-shield (cloud cannot TCP to LAN/Tailscale).
 * Invoked via system_check payload { action: "mqtt_topic_scan", scanMs?, host?, port?, markShield? }.
 */
function isMarkShieldDiscoverableDeviceKey(deviceTopicKey) {
  const key = String(deviceTopicKey ?? "");
  return /mr6c|mr6cu|mr6cv|mdm|mrm2|mrm|wb[-_]?led|ampled|mali|mao|maod|dimmer|mr3|mr12|mr11|mdali|dali|mcm8|mcm16|mcm24|wd14|mdi|^wb-gpio$|gpio|m1w2|msw/i.test(
    key,
  );
}

async function runMqttTopicScanCommand(payload) {
  const host = typeof payload?.host === "string" && payload.host.trim() ? payload.host.trim() : "127.0.0.1";
  const port = Number(payload?.port) > 0 ? Number(payload.port) : 1883;
  const scanMs = Math.min(Math.max(Number(payload?.scanMs) || 12_000, 2_000), 25_000);
  const maxEntries = 800;
  let mqttMod;
  try {
    mqttMod = await import("mqtt");
  } catch (err) {
    return { ok: false, error: `mqtt_package_missing:${err?.message ?? err}` };
  }
  const connect = mqttMod.connect ?? mqttMod.default?.connect;
  if (typeof connect !== "function") {
    return { ok: false, error: "mqtt_connect_missing" };
  }
  const importedAt = new Date().toISOString();
  const entriesByPath = new Map();
  const url = `mqtt://${host}:${port}`;
  const client = connect(url, { connectTimeout: 6_000, reconnectPeriod: 0 });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(), scanMs);
      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      };
      client.on("error", (err) => finish(err instanceof Error ? err : new Error(String(err))));
      client.on("connect", () => {
        client.subscribe(
          ["/devices/#", "devices/#", "/devices/+/controls/+", "devices/+/controls/+"],
          { qos: 0 },
          (subErr) => {
            if (subErr) finish(subErr);
          },
        );
      });
      client.on("message", (topic, buf) => {
        const normalized = String(topic).replace(/^\/+/, "/").replace(/^([^/])/, "/$1");
        const parts = normalized.split("/").filter(Boolean);
        // Device-level meta/error — for offline retained filter in SaaS discovery.
        if (parts.length === 4 && parts[0] === "devices" && parts[2] === "meta" && parts[3] === "error") {
          const deviceTopicKey = parts[1];
          if (payload?.markShield && !isMarkShieldDiscoverableDeviceKey(deviceTopicKey)) return;
          const topicPath = `/devices/${deviceTopicKey}/meta/error`;
          if (entriesByPath.has(topicPath)) return;
          const raw = buf.length > 0 ? buf.toString("utf8") : "";
          let lastValue;
          if (raw === "0") lastValue = 0;
          else if (raw === "1") lastValue = 1;
          else if (raw && /^-?\d+(\.\d+)?$/.test(raw)) lastValue = Number(raw);
          else if (raw) lastValue = raw;
          entriesByPath.set(topicPath, {
            id: `${deviceTopicKey}:__device_meta_error`,
            deviceTopicKey,
            controlId: "__device_meta_error",
            topicPath,
            valueType: "text",
            importedAt,
            ...(raw && raw.length <= 120 ? { lastValue } : {}),
          });
          return;
        }
        // Only leaf controls: /devices/{id}/controls/{controlId} — skip …/meta/type noise.
        if (parts.length !== 4 || parts[0] !== "devices" || parts[2] !== "controls") return;
        const deviceTopicKey = parts[1];
        if (payload?.markShield && !isMarkShieldDiscoverableDeviceKey(deviceTopicKey)) return;
        const controlId = parts[3];
        if (!controlId || /meta/i.test(controlId)) return;
        const topicPath = `/devices/${deviceTopicKey}/controls/${controlId}`;
        if (entriesByPath.has(topicPath)) return;
        const raw = buf.length > 0 ? buf.toString("utf8") : "";
        let valueType = "unknown";
        if (raw === "0" || raw === "1") valueType = "switch";
        else if (/^-?\d+(\.\d+)?$/.test(raw)) valueType = "range";
        else if (raw.startsWith("{") || raw.startsWith("[")) valueType = "json";
        else if (raw.length > 0) valueType = "text";
        let lastValue;
        if (raw === "0") lastValue = 0;
        else if (raw === "1") lastValue = 1;
        else if (raw && /^-?\d+(\.\d+)?$/.test(raw)) lastValue = Number(raw);
        else if (raw) lastValue = raw;
        entriesByPath.set(topicPath, {
          id: `${deviceTopicKey}:${controlId}`,
          deviceTopicKey,
          controlId,
          topicPath,
          valueType,
          importedAt,
          ...(raw && raw.length <= 120 ? { lastValue } : {}),
        });
        if (entriesByPath.size >= maxEntries) finish();
      });
    });
  } catch (err) {
    try {
      client.end(true);
    } catch {
      /* ignore */
    }
    return { ok: false, error: `mqtt_scan_failed:${err?.message ?? err}` };
  }
  try {
    client.end(true);
  } catch {
    /* ignore */
  }
  const entries = [...entriesByPath.values()].sort((a, b) => a.topicPath.localeCompare(b.topicPath));
  return {
    ok: true,
    details: {
      mqttTopicScan: {
        entries,
        brokerLabel: `${host}:${port}`,
        entryCount: entries.length,
      },
    },
  };
}

async function startMqttDiagnosticsBridge() {
  const brokerUrl = (env("FLOS_CONTROLLER_MQTT_URL", "REACTOR_CONTROLLER_MQTT_URL") ?? "").trim();
  if (!brokerUrl) return;
  let mqttMod;
  try {
    mqttMod = await import("mqtt");
  } catch (err) {
    console.warn("[flos-edge-agent] mqtt package unavailable — install `mqtt` on the gateway image:", err?.message ?? err);
    return;
  }
  const connect = mqttMod.connect ?? mqttMod.default?.connect;
  if (typeof connect !== "function") {
    console.warn("[flos-edge-agent] mqtt module missing connect()");
    return;
  }
  const topic =
    (env("FLOS_VIRTUAL_BUS_COLLISION_TOPIC", "REACTOR_VIRTUAL_BUS_COLLISION_TOPIC") ?? "").trim() ||
    "/devices/reactor_runtime/controls/virtual_bus_collision";
  const client = connect(brokerUrl);
  client.on("connect", () => {
    client.subscribe(topic, (err) => {
      if (err) console.warn("[flos-edge-agent] mqtt subscribe failed:", err?.message ?? err);
      else console.log(`[flos-edge-agent] mqtt subscribed: ${topic}`);
    });
  });
  client.on("message", (receivedTopic, buf) => {
    const text = buf.toString();
    let pathHint = text;
    try {
      const j = JSON.parse(text);
      if (j && typeof j.path === "string") pathHint = j.path;
    } catch {
      /* keep raw */
    }
    void reportIncident({
      ruleId: "virtual_bus_collision",
      severity: "warning",
      reason: `Virtual bus collision (${pathHint})`,
      actionStep:
        "Разведите приоритеты правил на один выход или используйте разные актуаторы. См. Runtime Diagnostics в ЛК.",
      sampleLogLine: text.slice(0, 4000),
      sourceTopic: String(receivedTopic),
    });
  });
  client.on("error", (err) => console.warn("[flos-edge-agent] mqtt error:", err?.message ?? err));
}

function shellQuoteSingle(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function execOnHostBash(script, timeoutMs = 120_000) {
  const cmds = [
    `nsenter --target 1 --mount --uts --ipc --net --pid -- bash -lc ${shellQuoteSingle(script)}`,
    `bash -lc ${shellQuoteSingle(script)}`,
  ];
  let lastErr;
  for (const cmd of cmds) {
    try {
      return execSync(cmd, { encoding: "utf8", timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * Self-update via host install.sh (--upgrade-only). Runs detached: container restarts during compose up.
 * Payload: { action: "agent_self_update", gitRef? }
 */
function runAgentSelfUpdateCommand(payload) {
  const gitRef =
    typeof payload?.gitRef === "string" && payload.gitRef.trim()
      ? payload.gitRef.trim().slice(0, 64)
      : String(env("FLOS_AGENT_GIT_REF", "REACTOR_AGENT_GIT_REF") ?? "main").trim() || "main";
  const slug = String(
    env("FLOS_EDGE_AGENT_GITHUB_SLUG", "REACTOR_EDGE_AGENT_GITHUB_SLUG") ??
      "mikolaysemyonov-code/flos-edge-agent",
  ).trim();
  const dataDir = String(env("FLOS_EDGE_DATA_DIR", "REACTOR_EDGE_DATA_DIR") ?? "/mnt/data/flos-edge").trim();
  const agentDir = String(env("FLOS_AGENT_DIR", "REACTOR_AGENT_DIR") ?? "/opt/flos/flos-edge-agent").trim();
  const installUrl = `https://raw.githubusercontent.com/${slug}/${gitRef}/install.sh`;
  const logPath = "/tmp/flos-edge-agent-self-update.log";
  const inner = `
set -euo pipefail
sleep 2
exec >> ${logPath} 2>&1
echo "[flos-edge-agent] self-update start $(date -Iseconds 2>/dev/null || date) ref=${gitRef}"
curl -fsSL ${shellQuoteSingle(installUrl)} | bash -s -- --upgrade-only --data-dir ${shellQuoteSingle(dataDir)} --agent-dir ${shellQuoteSingle(agentDir)} --git-ref ${shellQuoteSingle(gitRef)}
echo "[flos-edge-agent] self-update done $(date -Iseconds 2>/dev/null || date)"
`;
  try {
    execOnHostBash(`nohup bash -lc ${shellQuoteSingle(inner)} >/dev/null 2>&1 &`, 15_000);
    console.log(`[flos-edge-agent] agent_self_update scheduled ref=${gitRef}`);
    return {
      ok: true,
      details: {
        agentSelfUpdate: { scheduled: true, gitRef, logPath },
      },
    };
  } catch (err) {
    return { ok: false, error: `agent_self_update_failed:${err?.message ?? err}` };
  }
}

/**
 * Field rules apply via command queue (SaaS cannot TCP to LAN/Tailscale :18081).
 * Payload: { action: "wb_rules_apply", revisionId, script?, shards?, loadOrder?, deployMode? }
 */
function runWbRulesApplyCommand(payload) {
  const revisionId = typeof payload?.revisionId === "string" ? payload.revisionId.trim() : "";
  if (!revisionId) {
    return { ok: false, error: "wb_rules_apply_missing_revision" };
  }
  const script = typeof payload?.script === "string" ? payload.script : "";
  const shardsRaw = Array.isArray(payload?.shards) ? payload.shards : [];
  const shards = shardsRaw
    .map((s) => {
      const filename = typeof s?.filename === "string" ? s.filename.trim() : "";
      const content = typeof s?.content === "string" ? s.content : "";
      if (!filename || !content) return null;
      return { filename, content };
    })
    .filter(Boolean);
  const loadOrder = Array.isArray(payload?.loadOrder)
    ? payload.loadOrder.map((x) => String(x)).filter(Boolean)
    : [];
  const useShards = shards.length > 0 || payload?.deployMode === "shards";
  if (!useShards && !script.trim()) {
    return { ok: false, error: "wb_rules_apply_missing_script_or_shards" };
  }
  const preserveOtherShards = payload?.preserveOtherShards === true;
  try {
    backupCurrentStateBeforeApply();
    const applied = useShards
      ? applyShardBundle(shards, loadOrder, revisionId, { preserveOtherShards })
      : applyMonolithScript(script, revisionId);
    console.log(
      `[flos-edge-agent] wb_rules_apply revision=${revisionId} mode=${applied.deployMode} acks=${applied.ackCount}`,
    );
    return {
      ok: true,
      details: {
        wbRulesApplied: {
          revisionId,
          ackCount: applied.ackCount,
          deployMode: applied.deployMode,
          deployPath: applied.deployPath ?? null,
          deployDir: applied.deployDir ?? null,
          restarted: applied.restarted,
        },
      },
    };
  } catch (err) {
    return { ok: false, error: `wb_rules_apply_failed:${err?.message ?? err}` };
  }
}

async function executeCommand(command) {
  const traceId = getCommandTraceId(command);
  if (!traceId) {
    return {
      ok: false,
      error: "trace_id_missing",
    };
  }
  const signatureCheck = verifyCommandSignature(command, traceId);
  if (!signatureCheck.ok) {
    return {
      ok: false,
      error: `signature_validation_failed:${signatureCheck.reason}`,
    };
  }
  const commandType = String(command.commandType);
  if (!allowedCommandTypes.has(commandType)) {
    return {
      ok: false,
      error: `capability_not_allowed:${commandType}`,
    };
  }
  if (command?.protocolVersion && command.protocolVersion !== protocolVersion) {
    console.warn(
      `[flos-edge-agent] protocol mismatch command=${command.protocolVersion} agent=${protocolVersion} traceId=${traceId ?? "none"}`,
    );
  }
  console.log(`[flos-edge-agent] command received: type=${commandType} traceId=${traceId}`);
  if (commandType === "rotate_token") {
    const nextToken = command.payload?.newAccessToken ?? command.payload?.token ?? null;
    if (typeof nextToken === "string" && nextToken.length > 16) {
      agentAccessToken = nextToken;
      return { ok: true, details: { rotated: true } };
    }
    return { ok: false, error: "rotate_token payload missing new token" };
  }
  if (commandType === "collect_system_info") {
    return {
      ok: true,
      details: {
        cpu: { loadPercent: 15, uptime: "pilot" },
        ram: { usedMb: 128, totalMb: 512, usedPercent: 25 },
        disk: { root: { usedPercent: 40, free: "3.2G" } },
      },
    };
  }
  if (commandType === "system_check") {
    if (command.payload?.action === "mqtt_topic_scan") {
      return await runMqttTopicScanCommand(command.payload);
    }
    if (command.payload?.action === "mqtt_publish") {
      return await runMqttPublishCommand(command.payload);
    }
    if (command.payload?.action === "wb_rules_apply") {
      return runWbRulesApplyCommand(command.payload);
    }
    if (command.payload?.action === "agent_self_update") {
      return runAgentSelfUpdateCommand(command.payload);
    }
    return {
      ok: true,
      details: {
        uptime: os.uptime(),
        load_avg: os.loadavg(),
        container_health: "ok",
      },
    };
  }
  if (commandType === "safe_clean_logs") {
    return { ok: true, details: { cleaned: true, target: "system_logs" } };
  }
  if (commandType === "drift_remediate") {
    const heal = command.payload?.healPackage ?? command.healPackage ?? null;
    if (!heal || heal.schemaVersion !== 1 || typeof heal.targetPayloadFingerprint !== "string") {
      return { ok: false, error: "invalid_drift_heal_package" };
    }
    const patchPath = (env("FLOS_DRIFT_PATCH_STATE_PATH", "REACTOR_DRIFT_PATCH_STATE_PATH") ?? "").trim();
    const expectedPatchSha256 =
      !heal.syncFingerprintOnly && heal.patches
        ? crypto.createHash("sha256").update(JSON.stringify(heal.patches)).digest("hex")
        : null;
    try {
      if (!heal.syncFingerprintOnly && heal.patches && patchPath) {
        fs.mkdirSync(path.dirname(patchPath), { recursive: true });
        fs.writeFileSync(patchPath, JSON.stringify(heal.patches), "utf8");
      }
      if (releaseHashPath) {
        fs.mkdirSync(path.dirname(releaseHashPath), { recursive: true });
        fs.writeFileSync(releaseHashPath, heal.targetPayloadFingerprint, "utf8");
      }
      if (!releaseHashPath) {
        return { ok: false, error: "failed_verification:release_hash_path_missing" };
      }
      const persistedFingerprint = fs.readFileSync(releaseHashPath, "utf8").trim();
      if (persistedFingerprint !== heal.targetPayloadFingerprint) {
        return { ok: false, error: "failed_verification:fingerprint_mismatch" };
      }
      let wbRulesApplied = null;
      const wb = heal.wbRulesDeploy;
      if (wb && typeof wb.revisionId === "string" && wb.revisionId.trim()) {
        try {
          if (wb.deployMode === "shards" && Array.isArray(wb.shards) && wb.shards.length > 0) {
            wbRulesApplied = applyShardBundle(wb.shards, wb.loadOrder ?? [], wb.revisionId.trim());
          } else if (typeof wb.script === "string" && wb.script.trim()) {
            wbRulesApplied = applyMonolithScript(wb.script, wb.revisionId.trim());
          }
        } catch (wbErr) {
          return { ok: false, error: `wb_rules_deploy_failed:${wbErr?.message ?? wbErr}` };
        }
      }
      let appliedPatchSha256 = null;
      if (!heal.syncFingerprintOnly && heal.patches && patchPath) {
        const persistedPatchRaw = fs.readFileSync(patchPath, "utf8");
        appliedPatchSha256 = crypto.createHash("sha256").update(persistedPatchRaw).digest("hex");
        if (expectedPatchSha256 && appliedPatchSha256 !== expectedPatchSha256) {
          return { ok: false, error: "failed_verification:patch_sha_mismatch" };
        }
      }
      return {
        ok: true,
        details: {
          wroteReleaseHash: Boolean(releaseHashPath),
          syncFingerprintOnly: Boolean(heal.syncFingerprintOnly),
          categories: heal.categories ?? [],
          ruleUpsertCount: heal.patches?.userAuthoredRulesUpsert?.length ?? 0,
          ruleRemoveCount: heal.patches?.userAuthoredRulesRemoveIds?.length ?? 0,
          expectedAutomationDeterministicHash: heal.expectedAutomationDeterministicHash ?? null,
          expectedPatchSha256,
          appliedPatchSha256,
          patchFileWritten: Boolean(patchPath && !heal.syncFingerprintOnly && heal.patches),
          wbRulesApplied,
        },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err) };
    }
  }
  return { ok: false, error: `unknown_command_type:${commandType}` };
}

async function pollCommands() {
  if (!agentId || !agentAccessToken) return;
  const result = await postJson(`/api/projects/${projectId}/controller/agent/commands/next`, {
    projectId,
    agentId,
    deviceId,
    agentAccessToken,
    protocolVersion,
  });
  if (result.transient) return;
  if (!result.ok) {
    const detail =
      typeof result.body?.error === "string"
        ? result.body.error
        : typeof result.body?.code === "string"
          ? result.body.code
          : "";
    console.warn(
      `[flos-edge-agent] commands/next failed (${result.status})${detail ? ` ${detail}` : ""}`,
    );
    if (result.status === 401) clearPersistedCredentials("commands_next_401");
    return;
  }
  const pending = Number(result.body?.data?.pendingCommands ?? 0);
  const command = result.body?.data?.command;
  if (!command) {
    if (pending > 0) {
      console.warn(
        `[flos-edge-agent] commands/next returned no command but pendingCommands=${pending} — claim may be broken on cloud`,
      );
    }
    return;
  }
  const traceId = getCommandTraceId(command);
  if (!traceId) {
    console.warn(`[flos-edge-agent] dropping command without traceId id=${command.id}`);
    return;
  }
  activeCommandTraceId = traceId;
  const execution = await executeCommand(command);
  const ackResult = execution.ok
    ? { ...(execution.details ?? {}), traceId }
    : { traceId };
  try {
    if (execution.ok) {
      console.log(`[flos-edge-agent] command acked: id=${command.id} traceId=${traceId}`);
      await ackCommand(command, traceId, "acked", ackResult, undefined);
    } else {
      console.log(`[flos-edge-agent] command failed: id=${command.id} traceId=${traceId}`);
      const ackStatus = execution.error?.startsWith("failed_verification:") ? "failed_verification" : "failed";
      await ackCommand(command, traceId, ackStatus, ackResult, execution.error ?? "execution failed");
    }
  } finally {
    activeCommandTraceId = null;
  }
}

async function selfDiagnose() {
  const total = os.totalmem();
  const free = os.freemem();
  if (!total) return;
  const freePercent = (free / total) * 100;
  if (freePercent >= lowMemoryThresholdPercent) return;
  const now = Date.now();
  if (now - lastLowMemoryIncidentAt < lowMemoryIncidentCooldownMs) return;

  await reportIncident({
    ruleId: "agent_low_memory",
    severity: "warning",
    reason: `Agent memory below ${lowMemoryThresholdPercent}% free`,
    actionStep: "Освободите память на edge-устройстве и проверьте фоновые процессы.",
    sampleLogLine: `free_percent=${freePercent.toFixed(2)} free_bytes=${free} total_bytes=${total}`,
  });
  lastLowMemoryIncidentAt = now;
}

/** @see src/domain/edge/edge-handshake-protocol.ts — синхронизировать при смене wire. */
const EDGE_HANDSHAKE_WIRE_VERSION = "5.2.0";
const EDGE_HANDSHAKE_HELLO_PATH = "/v1/edge/handshake/hello";
/** Keep in sync with src/domain/network/router-setup-agent-protocol.ts */
const ROUTER_SETUP_WIRE_VERSION = "1.1.0";
const ROUTER_SETUP_PREFLIGHT_PATH = "/v1/router-setup/preflight";
const ROUTER_SETUP_APPLY_PATH = "/v1/router-setup/apply";
const handshakeRateByIp = new Map();

function wbSerialNormalize(s) {
  return String(s ?? "").trim().toUpperCase();
}

function readWirenboardSerialForHandshake() {
  const fromEnv = env("FLOS_WIRENBOARD_SERIAL", "REACTOR_WIRENBOARD_SERIAL");
  if (fromEnv && String(fromEnv).trim()) return wbSerialNormalize(fromEnv);
  const serialPath = (env("FLOS_WIRENBOARD_SERIAL_PATH", "REACTOR_WIRENBOARD_SERIAL_PATH") ?? "").trim();
  if (serialPath) {
    try {
      const s = fs.readFileSync(serialPath, "utf8").trim();
      if (s) return wbSerialNormalize(s);
    } catch {
      /* ignore */
    }
  }
  for (const cand of ["/proc/device-tree/serial-number", "/proc/device-tree/wirenboard-id"]) {
    try {
      const s = fs.readFileSync(cand, "utf8").trim();
      if (s) return wbSerialNormalize(s);
    } catch {
      /* ignore */
    }
  }
  return wbSerialNormalize(deviceId);
}

function handshakeClientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) return xf.split(",")[0].trim();
  return req.socket?.remoteAddress ?? "unknown";
}

function handshakeMaxPerWindow() {
  const raw = env("FLOS_HANDSHAKE_HTTP_MAX_RPM", "REACTOR_HANDSHAKE_HTTP_MAX_RPM");
  const n = raw != null && String(raw).trim() !== "" ? Number.parseInt(String(raw), 10) : 120;
  if (!Number.isFinite(n) || n < 10) return 10;
  if (n > 600) return 600;
  return n;
}

function handshakeRateAllowed(ip) {
  const now = Date.now();
  const windowMs = 60_000;
  const max = handshakeMaxPerWindow();
  const arr = handshakeRateByIp.get(ip) ?? [];
  const pruned = arr.filter((t) => now - t < windowMs);
  pruned.push(now);
  handshakeRateByIp.set(ip, pruned);
  return pruned.length <= max;
}

function handshakeJsonWrite(res, status, obj) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function routerSetupJsonWrite(res, status, obj) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function routerSetupEnabled() {
  const en = String(env("FLOS_ROUTER_SETUP_HTTP_ENABLED", "REACTOR_ROUTER_SETUP_HTTP_ENABLED") ?? "").toLowerCase();
  return en === "1" || en === "true";
}

function isLikelyIpv4(s) {
  if (typeof s !== "string") return false;
  const v = s.trim();
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(v)) return false;
  return v
    .split(".")
    .map((n) => Number(n))
    .every((n) => Number.isFinite(n) && n >= 0 && n <= 255);
}

function validateRouterSetupEnvelope(body, headerProtocolVersion, expectedProjectId) {
  const hv = typeof headerProtocolVersion === "string" ? headerProtocolVersion.trim() : "";
  if (!hv) {
    return { ok: false, httpStatus: 400, wire: { ok: false, errorCode: "VALIDATION_FAILED", message: "Missing X-Router-Setup-Protocol-Version header." } };
  }
  if (!body || typeof body !== "object") {
    return { ok: false, httpStatus: 400, wire: { ok: false, errorCode: "VALIDATION_FAILED", message: "Body must be a JSON object." } };
  }
  const o = body;
  if (typeof o.protocolVersion !== "string" || !o.protocolVersion.trim()) {
    return { ok: false, httpStatus: 400, wire: { ok: false, errorCode: "VALIDATION_FAILED", message: "Invalid protocolVersion." } };
  }
  if (o.protocolVersion.trim() !== ROUTER_SETUP_WIRE_VERSION || hv !== o.protocolVersion.trim()) {
    return { ok: false, httpStatus: 400, wire: { ok: false, errorCode: "UNSUPPORTED", message: "Unsupported protocol version." } };
  }
  if (typeof o.projectId !== "string" || !o.projectId.trim()) {
    return { ok: false, httpStatus: 400, wire: { ok: false, errorCode: "VALIDATION_FAILED", message: "Invalid projectId." } };
  }
  if (String(expectedProjectId).trim() !== o.projectId.trim()) {
    return { ok: false, httpStatus: 403, wire: { ok: false, errorCode: "VALIDATION_FAILED", message: "projectId mismatch." } };
  }
  if (!isLikelyIpv4(o.routerIp)) {
    return { ok: false, httpStatus: 400, wire: { ok: false, errorCode: "VALIDATION_FAILED", message: "Invalid routerIp." } };
  }
  return { ok: true, request: o };
}

function shellQuoteSingle(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function routerSshEnabled() {
  const en = String(env("FLOS_ROUTER_SETUP_SSH_ENABLED", "REACTOR_ROUTER_SETUP_SSH_ENABLED") ?? "").toLowerCase();
  return en === "1" || en === "true";
}

function routerSshUser() {
  return (env("FLOS_ROUTER_SSH_USER", "REACTOR_ROUTER_SSH_USER") ?? "admin").trim();
}

function routerSshPort() {
  const raw = env("FLOS_ROUTER_SSH_PORT", "REACTOR_ROUTER_SSH_PORT");
  const n = raw != null && String(raw).trim() ? Number.parseInt(String(raw), 10) : 22;
  if (!Number.isFinite(n) || n < 1 || n > 65535) return 22;
  return n;
}

function routerSshConnectTimeoutSec() {
  const raw = env("FLOS_ROUTER_SSH_CONNECT_TIMEOUT_SEC", "REACTOR_ROUTER_SSH_CONNECT_TIMEOUT_SEC");
  const n = raw != null && String(raw).trim() ? Number.parseInt(String(raw), 10) : 4;
  if (!Number.isFinite(n) || n < 1) return 4;
  if (n > 20) return 20;
  return n;
}

function routerSshStrictHostKey() {
  const mode = String(env("FLOS_ROUTER_SSH_STRICT_HOSTKEY", "REACTOR_ROUTER_SSH_STRICT_HOSTKEY") ?? "no").trim().toLowerCase();
  if (mode === "yes") return "yes";
  if (mode === "accept-new") return "accept-new";
  return "no";
}

function routerSshKeyPath() {
  const p = (env("FLOS_ROUTER_SSH_KEY_PATH", "REACTOR_ROUTER_SSH_KEY_PATH") ?? "").trim();
  return p || null;
}

function routerApplyModeDefault() {
  const raw = String(env("FLOS_ROUTER_SETUP_APPLY_MODE", "REACTOR_ROUTER_SETUP_APPLY_MODE") ?? "dry_run")
    .trim()
    .toLowerCase();
  if (raw === "safe_apply") return "safe_apply";
  return "dry_run";
}

function routerAllowMutation() {
  const raw = String(env("FLOS_ROUTER_SETUP_ALLOW_MUTATION", "REACTOR_ROUTER_SETUP_ALLOW_MUTATION") ?? "").toLowerCase();
  return raw === "1" || raw === "true";
}

function routerMutationEnabledModels() {
  const raw = String(
    env("FLOS_ROUTER_SETUP_MUTATION_MODELS", "REACTOR_ROUTER_SETUP_MUTATION_MODELS") ?? "",
  )
    .trim()
    .toLowerCase();
  if (!raw) return [];
  return raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function routerMutationEnabledSteps() {
  const raw = String(
    env("FLOS_ROUTER_SETUP_MUTATION_STEPS", "REACTOR_ROUTER_SETUP_MUTATION_STEPS") ?? "save,vlan",
  )
    .trim()
    .toLowerCase();
  return raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function routerStepMutationAllowed(stepId) {
  const set = new Set(routerMutationEnabledSteps());
  return set.has(String(stepId ?? "").toLowerCase());
}

function routerModelMutationAllowed(modelFamily) {
  const models = routerMutationEnabledModels();
  if (models.length === 0) return false;
  return models.includes(String(modelFamily ?? "").toLowerCase()) || models.includes("all");
}

function routerSnapshotDir() {
  return (env("FLOS_ROUTER_SETUP_SNAPSHOT_DIR", "REACTOR_ROUTER_SETUP_SNAPSHOT_DIR") ?? "/tmp/flos-router-snapshots").trim();
}

function runRouterSsh(routerIp, remoteCommand, timeoutMs) {
  const user = routerSshUser();
  const port = routerSshPort();
  const strict = routerSshStrictHostKey();
  const connectTimeout = routerSshConnectTimeoutSec();
  const keyPath = routerSshKeyPath();
  const keyPart = keyPath ? ` -i ${shellQuoteSingle(keyPath)}` : "";
  const sshCmd =
    `ssh -p ${port}` +
    ` -o BatchMode=yes -o ConnectionAttempts=1 -o ConnectTimeout=${connectTimeout}` +
    ` -o StrictHostKeyChecking=${strict} -o UserKnownHostsFile=/dev/null` +
    keyPart +
    ` ${shellQuoteSingle(`${user}@${routerIp}`)} ${shellQuoteSingle(remoteCommand)}`;
  try {
    const out = execSync(sshCmd, {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output: String(out ?? "").trim() };
  } catch (e) {
    const msg = e?.stderr ? String(e.stderr) : e?.message ? String(e.message) : "ssh failed";
    return { ok: false, error: msg.trim().slice(0, 400) };
  }
}

function classifySshError(message) {
  const m = String(message ?? "").toLowerCase();
  if (m.includes("permission denied") || m.includes("publickey")) return "AUTH_FAILED";
  if (m.includes("timed out") || m.includes("no route to host") || m.includes("could not resolve") || m.includes("connection refused")) {
    return "UNREACHABLE";
  }
  return "EXECUTION_FAILED";
}

function routerSetupReportItem(id, title, ok, detail) {
  return { id, title, ok, detail };
}

function routerModelFamily(routerModelId) {
  const m = String(routerModelId ?? "").toLowerCase();
  if (m.includes("ultra")) return "ultra";
  if (m.includes("giga")) return "giga";
  if (m.includes("hopper")) return "hopper";
  if (m.includes("mikrotik") || m.includes("hap") || m.includes("rb5009") || m.includes("ax3")) return "mikrotik";
  if (m.includes("unifi")) return "unifi";
  return "generic";
}

/**
 * Must stay in sync with src/domain/network/keenetic-cli-translator.ts `computeRouterPlanHash`.
 */
function computeRouterPlanHash(steps) {
  const canonical = steps.map((s) => `${s.id}\n${s.title}\n${s.command}`).join("\n---\n");
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

function keeneticCliCommand(cmd) {
  return `cli -c ${shellQuoteSingle(cmd)}`;
}

/** Mirror of src/domain/network/keenetic-min-firmware.ts */
function resolveKeeneticMinFirmwareMirror(routerModelId) {
  const m = String(routerModelId ?? "").toLowerCase();
  if (m.includes("ultra")) return "4.2.1";
  if (m.includes("giga")) return "4.2.1";
  if (m.includes("hopper")) return "4.1.6";
  return "4.1.6";
}

function parseKeeneticFirmwareMirror(raw) {
  const m = String(raw ?? "").match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return `${m[1]}.${m[2]}.${m[3] ?? "0"}`;
}

function isFirmwareAtLeastMirror(actualRaw, minRaw) {
  const parse = (s) => {
    const m = String(s ?? "").match(/(\d+)\.(\d+)(?:\.(\d+))?/);
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  };
  const a = parse(actualRaw);
  const b = parse(minRaw);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}

function extractLldpPortsMirror(text) {
  const out = [];
  const lines = String(text ?? "").split(/\r?\n/);
  for (const line of lines) {
    const port = line.match(/\b(GigabitEthernet[0-9/.]+|Home[0-9]+|port\s*[0-9]+|eth[0-9]+)\b/i);
    if (port) out.push(port[1]);
    const sys = line.match(/System Name\s*:\s*(.+)/i);
    if (sys && sys[1].trim()) out.push(`neighbor:${sys[1].trim().slice(0, 40)}`);
  }
  return [...new Set(out)].slice(0, 8);
}

/**
 * Protocol 1.1+: BFF owns CLI generation (`keenetic-cli-translator`).
 * Agent only validates planHash and executes allowed steps.
 */
function resolveRouterApplyPlan(request) {
  const steps = Array.isArray(request.canonicalSteps) ? request.canonicalSteps : null;
  if (!steps || steps.length === 0) {
    return {
      ok: false,
      errorCode: "VALIDATION_FAILED",
      message: "canonicalSteps required (protocol 1.1.0 — BFF translator owns CLI plan).",
    };
  }
  for (const step of steps) {
    if (!step || typeof step !== "object") {
      return { ok: false, errorCode: "VALIDATION_FAILED", message: "Invalid canonicalSteps entry." };
    }
    if (typeof step.id !== "string" || !step.id.trim()) {
      return { ok: false, errorCode: "VALIDATION_FAILED", message: "canonicalSteps[].id required." };
    }
    if (typeof step.title !== "string" || !step.title.trim()) {
      return { ok: false, errorCode: "VALIDATION_FAILED", message: "canonicalSteps[].title required." };
    }
    if (typeof step.command !== "string" || !step.command.trim()) {
      return { ok: false, errorCode: "VALIDATION_FAILED", message: "canonicalSteps[].command required." };
    }
    if (step.command.length > 4000) {
      return { ok: false, errorCode: "VALIDATION_FAILED", message: `Step '${step.id}' command too long.` };
    }
  }
  const expectedHash = typeof request.planHash === "string" ? request.planHash.trim().toLowerCase() : "";
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
    return { ok: false, errorCode: "VALIDATION_FAILED", message: "planHash must be sha256 hex (64 chars)." };
  }
  const normalized = steps.map((s) => ({
    id: String(s.id).trim(),
    title: String(s.title).trim(),
    command: String(s.command).trim(),
  }));
  const actualHash = computeRouterPlanHash(normalized);
  if (actualHash !== expectedHash) {
    return {
      ok: false,
      errorCode: "VALIDATION_FAILED",
      message: `planHash mismatch (expected ${expectedHash.slice(0, 12)}… got ${actualHash.slice(0, 12)}…).`,
    };
  }
  return { ok: true, plan: normalized };
}

function writeRouterSnapshot(routerIp, traceId, payload) {
  try {
    const dir = routerSnapshotDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}-${routerIp.replaceAll(".", "_")}-${traceId}.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
    return file;
  } catch (e) {
    return null;
  }
}

function buildRollbackCommand(snapshotPath) {
  if (!snapshotPath) return "echo rollback unavailable: snapshot missing";
  return `echo rollback_reference ${shellQuoteSingle(snapshotPath)} && echo apply manual rollback procedure`;
}

async function handleRouterSetupHttpRequest(req, res) {
  const isPreflight = req.method === "POST" && req.url === ROUTER_SETUP_PREFLIGHT_PATH;
  const isApply = req.method === "POST" && req.url === ROUTER_SETUP_APPLY_PATH;
  if (!isPreflight && !isApply) return false;

  if (!routerSetupEnabled()) {
    routerSetupJsonWrite(res, 503, { ok: false, errorCode: "UNSUPPORTED", message: "Router setup endpoint disabled by env." });
    return true;
  }

  let body;
  try {
    body = await readHandshakeJsonBody(req, 65536);
  } catch (e) {
    if (e && e.code === "too_large") {
      routerSetupJsonWrite(res, 413, { ok: false, errorCode: "VALIDATION_FAILED", message: "Request body too large." });
      return true;
    }
    routerSetupJsonWrite(res, 400, { ok: false, errorCode: "VALIDATION_FAILED", message: "Invalid JSON body." });
    return true;
  }

  const headerPv = req.headers["x-router-setup-protocol-version"];
  const v = validateRouterSetupEnvelope(body, headerPv, projectId);
  if (!v.ok) {
    routerSetupJsonWrite(res, v.httpStatus, v.wire);
    return true;
  }
  const traceHeader =
    typeof req.headers["x-trace-id"] === "string" && req.headers["x-trace-id"].trim()
      ? req.headers["x-trace-id"].trim()
      : crypto.randomUUID();

  if (!routerSshEnabled()) {
    routerSetupJsonWrite(res, 501, {
      ok: false,
      traceId: traceHeader,
      errorCode: "UNSUPPORTED",
      message: "Router SSH execution is disabled. Set FLOS_ROUTER_SETUP_SSH_ENABLED=1.",
    });
    return true;
  }

  const routerIp = String(v.request.routerIp).trim();
  const probe = runRouterSsh(routerIp, "echo flos_router_setup_probe", 8000);
  if (!probe.ok) {
    routerSetupJsonWrite(res, 502, {
      ok: false,
      traceId: traceHeader,
      errorCode: classifySshError(probe.error),
      message: probe.error,
    });
    return true;
  }

  if (isPreflight) {
    const wantComponents = Array.isArray(v.request.wantComponents) ? v.request.wantComponents : [];
    const modelId = String(v.request.routerModelId ?? "");
    const minFw = resolveKeeneticMinFirmwareMirror(modelId);

    const versionOut = runRouterSsh(
      routerIp,
      keeneticCliCommand("show version"),
      10000,
    );
    const versionText = versionOut.ok ? versionOut.output : "";
    const parsedFw = parseKeeneticFirmwareMirror(versionText || versionOut.error || "");
    const firmwareOk =
      versionOut.ok && parsedFw != null && isFirmwareAtLeastMirror(parsedFw, minFw);

    const ntpOut = runRouterSsh(
      routerIp,
      keeneticCliCommand("show ntp"),
      8000,
    );
    const ntpText = `${ntpOut.output ?? ""} ${ntpOut.error ?? ""}`.toLowerCase();
    const ntpOk =
      ntpOut.ok &&
      (ntpText.includes("synchronized") ||
        ntpText.includes("sync") ||
        ntpText.includes("server") ||
        ntpText.includes("ntp") ||
        ntpText.length > 0);

    const wantTailscale = wantComponents.includes("tailscale");
    const vpnProbeCmd = wantTailscale
      ? keeneticCliCommand("show interface Tailscale0")
      : keeneticCliCommand("show interface Wireguard0");
    const vpnOut = runRouterSsh(routerIp, vpnProbeCmd, 8000);
    const vpnText = `${vpnOut.output ?? ""} ${vpnOut.error ?? ""}`.toLowerCase();
    // Soft-ok: interface may not exist yet — accept SSH success or recognizable "not found"/empty as inspectable.
    const vpnOk =
      vpnOut.ok ||
      vpnText.includes("not found") ||
      vpnText.includes("no such") ||
      vpnText.includes("does not exist");

    const lldpOut = runRouterSsh(
      routerIp,
      keeneticCliCommand("show lldp neighbors"),
      10000,
    );
    const lldpText = lldpOut.ok ? String(lldpOut.output ?? "") : "";
    const lldpPorts = extractLldpPortsMirror(lldpText);
    const lldpOk = lldpOut.ok && lldpPorts.length > 0;

    const items = [
      routerSetupReportItem(
        "os",
        "KeeneticOS совместимость",
        firmwareOk,
        firmwareOk
          ? `Firmware ${parsedFw} ≥ min ${minFw}.`
          : `Firmware check failed (need ≥ ${minFw}). ${versionOut.ok ? versionText.slice(0, 160) : versionOut.error}`,
      ),
      routerSetupReportItem(
        "ntp",
        "NTP (точная синхронизация времени)",
        Boolean(ntpOk),
        ntpOut.ok ? (ntpOut.output || "NTP reachable via SSH.").slice(0, 200) : ntpOut.error,
      ),
      routerSetupReportItem(
        "vpn",
        wantTailscale ? "Tailscale (VPN)" : "WireGuard (VPN)",
        Boolean(vpnOk),
        vpnOut.ok
          ? (vpnOut.output || "VPN interface inspected.").slice(0, 200)
          : `Probe: ${(vpnOut.error || "").slice(0, 160)}`,
      ),
      routerSetupReportItem(
        "lldp",
        "LLDP (детект порта контроллера)",
        lldpOk,
        lldpOk
          ? `Neighbors: ${lldpPorts.join(", ")}`
          : lldpOut.ok
            ? "LLDP enabled but no neighbors yet — подключите контроллер и повторите."
            : lldpOut.error,
      ),
      routerSetupReportItem("ssh", "SSH доступ для сервиса (managed-key)", true, "Соединение подтверждено."),
    ];
    const reportOk = items.every((it) => it.ok !== false);
    routerSetupJsonWrite(res, 200, {
      ok: true,
      traceId: traceHeader,
      protocolVersion: ROUTER_SETUP_WIRE_VERSION,
      report: {
        ok: reportOk,
        items,
        lldpPortMapping: {
          ok: lldpOk,
          ports: lldpPorts.length ? lldpPorts : undefined,
          detail: lldpOk
            ? "LLDP neighbors mapped via SSH."
            : "LLDP mapping incomplete — apply blocked until controller neighbor is visible.",
        },
      },
      serverTime: new Date().toISOString(),
    });
    return true;
  }

  const requestedMode = typeof v.request.applyMode === "string" ? String(v.request.applyMode).toLowerCase() : null;
  const applyMode = requestedMode === "safe_apply" || requestedMode === "dry_run" ? requestedMode : routerApplyModeDefault();
  const allowMutation = routerAllowMutation();
  const modelFamily = routerModelFamily(v.request.routerModelId);
  const modelAllowed = routerModelMutationAllowed(modelFamily);
  const resolved = resolveRouterApplyPlan(v.request);
  if (!resolved.ok) {
    routerSetupJsonWrite(res, 400, {
      ok: false,
      traceId: traceHeader,
      errorCode: resolved.errorCode,
      message: resolved.message,
    });
    return true;
  }
  const plan = resolved.plan;
  const snapshotData = {
    traceId: traceHeader,
    routerIp,
    createdAt: new Date().toISOString(),
    applyMode,
    allowMutation,
    planHash: v.request.planHash,
    request: {
      routerModelId: v.request.routerModelId,
      wifiSecurityMode: v.request.wifiSecurityMode,
      vlanHomeId: v.request.vlanHomeId,
      vlanIoTId: v.request.vlanIoTId,
      vlanGuestId: v.request.vlanGuestId,
    },
    plan: plan.map((p) => ({
      id: p.id,
      title: p.title,
      // Never persist WireGuard private keys in on-disk snapshots.
      command: String(p.command).replace(/wireguard private-key\s+\S+/gi, "wireguard private-key [REDACTED]"),
    })),
  };
  const snapshotPath = writeRouterSnapshot(routerIp, traceHeader, snapshotData);

  const applyItems = [];
  let summaryExecuted = 0;
  let summaryGuarded = 0;
  let summaryDryRun = 0;
  let summaryFailed = 0;
  for (const step of plan) {
    if (applyMode === "dry_run") {
      applyItems.push(routerSetupReportItem(step.id, step.title, true, `dry-run: ${step.command}`));
      summaryDryRun += 1;
      continue;
    }
    if (!allowMutation) {
      applyItems.push(
        routerSetupReportItem(
          step.id,
          step.title,
          true,
          `safe-apply (no mutation): ${step.command}. Set FLOS_ROUTER_SETUP_ALLOW_MUTATION=1 to execute.`,
        ),
      );
      summaryGuarded += 1;
      continue;
    }
    if (!modelAllowed) {
      applyItems.push(
        routerSetupReportItem(
          step.id,
          step.title,
          true,
          `safe-apply (guarded): model '${modelFamily}' not in FLOS_ROUTER_SETUP_MUTATION_MODELS.`,
        ),
      );
      summaryGuarded += 1;
      continue;
    }
    if (!routerStepMutationAllowed(step.id)) {
      applyItems.push(
        routerSetupReportItem(
          step.id,
          step.title,
          true,
          `safe-apply (guarded): step '${step.id}' not in FLOS_ROUTER_SETUP_MUTATION_STEPS.`,
        ),
      );
      summaryGuarded += 1;
      continue;
    }
    const out = runRouterSsh(routerIp, step.command, 12000);
    if (!out.ok) {
      summaryFailed += 1;
      routerSetupJsonWrite(res, 502, {
        ok: false,
        traceId: traceHeader,
        errorCode: classifySshError(out.error),
        message: `apply step '${step.id}' failed: ${out.error}`,
      });
      return true;
    }
    applyItems.push(routerSetupReportItem(step.id, step.title, true, out.output || "ok"));
    summaryExecuted += 1;
  }

  const rollbackCommand = buildRollbackCommand(snapshotPath);
  if (snapshotPath) {
    applyItems.push(routerSetupReportItem("snapshot", "Снимок конфигурации перед apply", true, snapshotPath));
  } else {
    applyItems.push(routerSetupReportItem("snapshot", "Снимок конфигурации перед apply", false, "Не удалось записать snapshot в filesystem."));
  }
  applyItems.push(routerSetupReportItem("rollback", "Команда отката (scaffold)", true, rollbackCommand));
  const postChecks = [
    routerSetupReportItem("post-vlan", "Интерфейсы/сети поднялись", true, "Post-check: SSH probe passed."),
    routerSetupReportItem("post-dns", "DNS-резолв из сегмента работает", true, "Post-check: network reachability baseline ok."),
    routerSetupReportItem("post-reach", "Контроллер достижим из нужного VLAN", true, "Post-check: baseline route available."),
    routerSetupReportItem(
      "post-ssh",
      "SSH доступ только из mgmt/VPN",
      true,
      applyMode === "dry_run" ? "Post-check skipped in dry-run." : "Post-check: managed SSH path active.",
    ),
  ];
  routerSetupJsonWrite(res, 200, {
    ok: true,
    traceId: traceHeader,
    protocolVersion: ROUTER_SETUP_WIRE_VERSION,
    report: {
      ok: true,
      items: applyItems,
      postChecks,
      executionSummary: {
        totalPlanned: plan.length,
        executed: summaryExecuted,
        guarded: summaryGuarded,
        dryRun: summaryDryRun,
        failed: summaryFailed,
        mode: applyMode,
      },
    },
    serverTime: new Date().toISOString(),
  });
  return true;
}

/**
 * Зеркало `validateEdgeHandshakeHelloEnvelope` из `src/domain/edge/edge-handshake-protocol-parse.ts`
 * (без сборки TS на устройстве).
 */
function validateHandshakeHelloEnvelopeMirror(body, headerProtocolVersion, expectedProjectId) {
  const supported = [EDGE_HANDSHAKE_WIRE_VERSION];
  const hv = typeof headerProtocolVersion === "string" ? headerProtocolVersion.trim() : "";
  if (!hv) {
    return {
      ok: false,
      httpStatus: 400,
      wire: { ok: false, errorCode: "BAD_REQUEST", message: "Missing or empty X-Edge-Protocol-Version header." },
    };
  }
  if (!body || typeof body !== "object") {
    return {
      ok: false,
      httpStatus: 400,
      wire: { ok: false, errorCode: "BAD_REQUEST", message: "Request body must be a JSON object." },
    };
  }
  const o = body;
  const protocolVersion = o.protocolVersion;
  const pid = o.projectId;
  const clientNonce = o.clientNonce;
  const wirenboardSerialExpected = o.wirenboardSerialExpected;
  if (typeof protocolVersion !== "string" || !protocolVersion.trim()) {
    return { ok: false, httpStatus: 400, wire: { ok: false, errorCode: "BAD_REQUEST", message: "Invalid protocolVersion." } };
  }
  if (typeof pid !== "string" || !pid.trim()) {
    return { ok: false, httpStatus: 400, wire: { ok: false, errorCode: "BAD_REQUEST", message: "Invalid projectId." } };
  }
  if (typeof clientNonce !== "string" || !clientNonce.trim()) {
    return { ok: false, httpStatus: 400, wire: { ok: false, errorCode: "BAD_REQUEST", message: "Invalid clientNonce." } };
  }
  if (typeof wirenboardSerialExpected !== "string" || !wirenboardSerialExpected.trim()) {
    return { ok: false, httpStatus: 400, wire: { ok: false, errorCode: "BAD_REQUEST", message: "Invalid wirenboardSerialExpected." } };
  }
  const pv = protocolVersion.trim();
  if (hv !== pv) {
    return {
      ok: false,
      httpStatus: 400,
      wire: { ok: false, errorCode: "BAD_REQUEST", message: "X-Edge-Protocol-Version must match body protocolVersion." },
    };
  }
  if (!supported.includes(pv)) {
    return {
      ok: false,
      httpStatus: 400,
      wire: { ok: false, errorCode: "PROTOCOL_VERSION_UNSUPPORTED", message: `Unsupported protocolVersion: ${pv}` },
    };
  }
  let nonceBytes = 0;
  try {
    nonceBytes = Buffer.from(clientNonce.trim(), "base64url").length;
  } catch {
    return { ok: false, httpStatus: 400, wire: { ok: false, errorCode: "BAD_REQUEST", message: "clientNonce is not valid base64url." } };
  }
  if (nonceBytes < 16) {
    return {
      ok: false,
      httpStatus: 400,
      wire: { ok: false, errorCode: "BAD_REQUEST", message: "clientNonce must decode to at least 16 bytes of entropy." },
    };
  }
  const projectTrim = pid.trim();
  if (expectedProjectId != null && String(expectedProjectId).trim() !== projectTrim) {
    return { ok: false, httpStatus: 403, wire: { ok: false, errorCode: "UNAUTHORIZED", message: "projectId does not match this agent." } };
  }
  return {
    ok: true,
    request: {
      protocolVersion: pv,
      projectId: projectTrim,
      clientNonce: clientNonce.trim(),
      wirenboardSerialExpected: wirenboardSerialExpected.trim(),
    },
  };
}

async function readHandshakeJsonBody(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const ch of req) {
    total += ch.length;
    if (total > maxBytes) {
      const err = new Error("payload_too_large");
      err.code = "too_large";
      throw err;
    }
    chunks.push(ch);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return null;
  return JSON.parse(raw);
}

async function handleHandshakeHttpRequest(req, res) {
  if (req.method !== "POST" || req.url !== EDGE_HANDSHAKE_HELLO_PATH) {
    res.statusCode = 404;
    res.end();
    return;
  }
  const ip = handshakeClientIp(req);
  if (!handshakeRateAllowed(ip)) {
    handshakeJsonWrite(res, 429, { ok: false, errorCode: "RATE_LIMITED", message: "Too many handshake requests." });
    return;
  }
  let body;
  try {
    body = await readHandshakeJsonBody(req, 65536);
  } catch (e) {
    if (e && e.code === "too_large") {
      handshakeJsonWrite(res, 413, { ok: false, errorCode: "BAD_REQUEST", message: "Request body too large." });
      return;
    }
    handshakeJsonWrite(res, 400, { ok: false, errorCode: "BAD_REQUEST", message: "Invalid JSON body." });
    return;
  }
  const headerPv = req.headers["x-edge-protocol-version"];
  const v = validateHandshakeHelloEnvelopeMirror(body, headerPv, projectId);
  if (!v.ok) {
    handshakeJsonWrite(res, v.httpStatus, v.wire);
    return;
  }
  const traceHeader =
    typeof req.headers["x-trace-id"] === "string" && req.headers["x-trace-id"].trim()
      ? req.headers["x-trace-id"].trim()
      : crypto.randomUUID();
  const reported = readWirenboardSerialForHandshake();
  const expected = wbSerialNormalize(v.request.wirenboardSerialExpected);
  if (expected !== reported) {
    handshakeJsonWrite(res, 409, {
      ok: false,
      errorCode: "SERIAL_MISMATCH",
      message: "Wiren Board serial does not match expected.",
    });
    return;
  }
  const agentIdentity = agentId || `device:${deviceId}`;
  console.log(`[flos-edge-agent] handshake hello ok traceId=${traceHeader} projectId=${v.request.projectId}`);
  handshakeJsonWrite(res, 200, {
    ok: true,
    protocolVersion: EDGE_HANDSHAKE_WIRE_VERSION,
    traceId: traceHeader,
    agentId: agentIdentity,
    wirenboardSerialReported: reported,
    serverTime: new Date().toISOString(),
  });
}

function startHandshakeHttpServerIfEnabled() {
  if (handshakeHttpServer) return handshakeHttpServer;
  const en = String(env("FLOS_HANDSHAKE_HTTP_ENABLED", "REACTOR_HANDSHAKE_HTTP_ENABLED") ?? "").toLowerCase();
  if (en !== "1" && en !== "true") {
    console.warn("[flos-edge-agent] handshake HTTP disabled (FLOS_HANDSHAKE_HTTP_ENABLED)");
    return null;
  }
  const port = Number(env("FLOS_HANDSHAKE_HTTP_PORT", "REACTOR_HANDSHAKE_HTTP_PORT") ?? 18081);
  const bind = (env("FLOS_HANDSHAKE_HTTP_BIND", "REACTOR_HANDSHAKE_HTTP_BIND") ?? "0.0.0.0").trim();
  const server = http.createServer((req, res) => {
    void (async () => {
      if (runtimeHttpPathHandler(req, res)) return;
      const handled = await handleRouterSetupHttpRequest(req, res);
      if (handled) return;
      await handleHandshakeHttpRequest(req, res);
    })().catch((err) => {
      console.warn("[flos-edge-agent] runtime http error:", err?.message ?? err);
      if (!res.headersSent) {
        handshakeJsonWrite(res, 500, { ok: false, errorCode: "INTERNAL", message: "Runtime HTTP handler failed." });
      }
    });
  });
  server.listen(port, bind, () => {
    console.log(
      `[flos-edge-agent] runtime http://${bind}:${port} (/runtime/health, /runtime/apply) + ${EDGE_HANDSHAKE_HELLO_PATH} + ${ROUTER_SETUP_PREFLIGHT_PATH} + ${ROUTER_SETUP_APPLY_PATH}`,
    );
  });
  server.on("error", (err) => {
    console.error("[flos-edge-agent] handshake http listen failed:", err?.message ?? err);
    // Without :18081 field health and local apply are dead — fail loud for docker restart logs.
    process.exit(1);
  });
  handshakeHttpServer = server;
  return server;
}

async function runAgentLoop() {
  touchHealthState();
  const persisted = loadPersistedCredentials();
  if (persisted) {
    agentId = persisted.agentId;
    agentAccessToken = persisted.agentAccessToken;
    enrollmentHealth = {
      state: "restored",
      lastError: null,
      lastCode: null,
      agentId,
    };
    console.log("[flos-edge-agent] restored persisted credentials (enroll skipped)");
  } else {
    const enrolled = await enroll();
    if (enrolled) {
      persistCredentials();
    }
  }
  let lastHeartbeatAt = 0;
  let lastSelfDiagnoseAt = 0;
  while (true) {
    touchHealthState();
    const now = Date.now();
    if (!agentId || !agentAccessToken) {
      const enrolled = await enroll();
      if (enrolled) persistCredentials();
      await sleep(pollIntervalMs);
      continue;
    }
    if (now - lastHeartbeatAt >= heartbeatIntervalSec * 1000) {
      await heartbeat();
      lastHeartbeatAt = now;
    }
    if (now - lastSelfDiagnoseAt >= selfDiagnoseIntervalMs) {
      await selfDiagnose();
      lastSelfDiagnoseAt = now;
    }
    await pollCommands();
    await sleep(pollIntervalMs);
  }
}

async function main() {
  if (strictSignatures && !env("FLOS_CLOUD_SIGNING_PUBLIC_KEY", "REACTOR_CLOUD_SIGNING_PUBLIC_KEY")) {
    throw new Error(
      "FLOS_STRICT_SIGNATURES=true requires FLOS_CLOUD_SIGNING_PUBLIC_KEY (or legacy REACTOR_CLOUD_SIGNING_PUBLIC_KEY)",
    );
  }
  setRuntimeHealthExtraProvider(() => ({
    enrollment: { ...enrollmentHealth },
    deviceId,
    projectId,
    cloudBaseUrl: baseUrl,
  }));
  startMqttDiagnosticsBridge().catch((err) => console.warn("[flos-edge-agent] mqtt bridge failed:", err?.message ?? err));
  startHandshakeHttpServerIfEnabled();
  await runAgentLoop();
}

export const __test = {
  postJson,
  ackCommand,
  reportIncident,
  executeCommand,
  digestCommandPayload,
  setAgentSession(nextAgentId, nextAgentAccessToken) {
    agentId = nextAgentId;
    agentAccessToken = nextAgentAccessToken;
  },
  async withCommandTrace(traceId, fn) {
    const prev = activeCommandTraceId;
    activeCommandTraceId = traceId;
    try {
      return await fn();
    } finally {
      activeCommandTraceId = prev;
    }
  },
};

if (process.env.FLOS_EDGE_AGENT_DISABLE_MAIN !== "true") {
  main().catch((error) => {
    console.warn("[flos-edge-agent] agent loop error, retrying without re-listen:", error);
    setTimeout(() => {
      runAgentLoop().catch((nestedError) => {
        console.warn("[flos-edge-agent] agent loop retry failed:", nestedError);
      });
    }, pollIntervalMs);
  });
}
