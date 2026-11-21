/**
 * Мост: шина щита → Mosquitto на mini-PC (HA). Команды /on обратно.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mqtt from "mqtt";
import { deskMarkingPath } from "./runtime-desk-marking.mjs";
import {
  buildHaRawDiscovery,
  haRawEntitiesFromShelves,
  isForeignHaDiscovery,
  isHaRawLoadControl,
  normalizeHaBroker,
  parseHaRawTopic,
} from "./runtime-desk-ha-raw.mjs";

function localBrokerUrl() {
  const host = (process.env.FLOS_MQTT_MIRROR_HOST || process.env.REACTOR_MQTT_MIRROR_HOST || "127.0.0.1").trim();
  const port = Number(process.env.FLOS_MQTT_MIRROR_PORT || process.env.REACTOR_MQTT_MIRROR_PORT || 1883) || 1883;
  return `mqtt://${host}:${port}`;
}

function configPath() {
  return path.join(path.dirname(deskMarkingPath()), "desk-ha-raw.json");
}

function shelvesPath() {
  return path.join(path.dirname(deskMarkingPath()), "desk-last-shelves.json");
}

function emptyCfg() {
  return { version: 1, enabled: false, host: "", port: 1883, user: "", password: "" };
}

export function readDeskHaConfig() {
  const file = configPath();
  if (!fs.existsSync(file)) return emptyCfg();
  try {
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!json || typeof json !== "object") return emptyCfg();
    return {
      ...emptyCfg(),
      enabled: json.enabled === true,
      host: String(json.host || "").trim(),
      port: Number(json.port) > 0 ? Number(json.port) : 1883,
      user: String(json.user || "").trim(),
      password: String(json.password || ""),
    };
  } catch {
    return emptyCfg();
  }
}

function writeDeskHaConfig(cfg) {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

function hostIsThisController(host) {
  const h = String(host || "").trim().toLowerCase();
  if (h === "127.0.0.1" || h === "localhost" || h === "::1") return true;
  try {
    for (const list of Object.values(os.networkInterfaces() || {})) {
      for (const n of list || []) {
        if (n && String(n.address || "") === String(host || "").trim()) return true;
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

function loadShelves() {
  try {
    const json = JSON.parse(fs.readFileSync(shelvesPath(), "utf8"));
    return Array.isArray(json?.shelves) ? json.shelves : [];
  } catch {
    return [];
  }
}

const state = {
  local: null,
  remote: null,
  running: false,
  localOk: false,
  remoteOk: false,
  forwarded: 0,
  tombstoned: 0,
  discovered: new Set(),
  lastError: "",
  lastAt: "",
};

function publicStatus() {
  const cfg = readDeskHaConfig();
  return {
    ok: true,
    enabled: cfg.enabled,
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    hasPassword: Boolean(cfg.password),
    running: state.running,
    localOk: state.localOk,
    remoteOk: state.remoteOk,
    forwarded: state.forwarded,
    tombstoned: state.tombstoned,
    discovered: state.discovered.size,
    lastError: state.lastError,
    lastAt: state.lastAt,
    entities: haRawEntitiesFromShelves(loadShelves()).map((e) => ({
      uniqueId: e.uniqueId,
      kind: e.kind,
      deviceTopicKey: e.deviceTopicKey,
      controlId: e.controlId,
      name: e.payload.name,
      hardware: e.hardware,
      named: e.named === true,
    })),
  };
}

function pub(client, topic, payload, retain) {
  if (!client) return;
  client.publish(topic, payload, { qos: 1, retain: retain === true }, () => {});
}

function publishDiscovery(row) {
  if (!row || !state.remote) return;
  pub(state.remote, row.topic, JSON.stringify(row.payload), true);
  state.discovered.add(row.uniqueId);
}

function discoverAll() {
  for (const row of haRawEntitiesFromShelves(loadShelves())) publishDiscovery(row);
}

function onBrokerMessage(topic, buf) {
  const text = buf.toString("utf8");
  if (isForeignHaDiscovery(topic, text)) {
    pub(state.remote || state.local, topic, "", true);
    state.tombstoned += 1;
    return;
  }
  if (state.remote && state.remote !== state.local) onLocalMessage(topic, buf);
}

function onLocalMessage(topic, buf) {
  const parsed = parseHaRawTopic(topic);
  if (!parsed || parsed.isCommand) return;
  if (!isHaRawLoadControl(parsed.deviceTopicKey, parsed.controlId)) return;
  const row = buildHaRawDiscovery(parsed.deviceTopicKey, parsed.controlId);
  if (row && !state.discovered.has(row.uniqueId)) publishDiscovery(row);
  pub(state.remote, parsed.stateTopic, buf.toString("utf8"), true);
  state.forwarded += 1;
  state.lastAt = new Date().toISOString();
}

function onRemoteMessage(topic, buf) {
  const parsed = parseHaRawTopic(topic);
  if (!parsed || !parsed.isCommand) return;
  if (!isHaRawLoadControl(parsed.deviceTopicKey, parsed.controlId)) return;
  pub(state.local, parsed.commandTopic, buf.toString("utf8"), false);
}

function endClient(c) {
  if (!c) return;
  try {
    c.removeAllListeners();
    c.end(true);
  } catch {
    /* ignore */
  }
}

export function stopDeskHaBridge() {
  state.running = false;
  state.localOk = false;
  state.remoteOk = false;
  const remote = state.remote;
  const local = state.local;
  if (remote && remote !== local) endClient(remote);
  endClient(local);
  state.local = null;
  state.remote = null;
}

function connectPair(cfg) {
  stopDeskHaBridge();
  state.running = true;
  state.lastError = "";
  state.tombstoned = 0;
  const local = mqtt.connect(localBrokerUrl(), {
    clientId: `flos-ha-local-${process.pid}`,
    reconnectPeriod: 4000,
    connectTimeout: 8000,
    protocolVersion: 4,
  });
  state.local = local;
  local.on("connect", () => {
    state.localOk = true;
    local.subscribe(["/devices/#", "homeassistant/#"], { qos: 0 }, () => {});
  });
  local.on("message", onBrokerMessage);
  local.on("offline", () => {
    state.localOk = false;
  });
  local.on("error", (err) => {
    state.lastError = String(err?.message || err || "local_mqtt");
  });
  if (hostIsThisController(cfg.host)) {
    local.on("connect", () => {
      state.remote = local;
      state.remoteOk = true;
      discoverAll();
    });
    return;
  }
  const remoteOpts = {
    clientId: `flos-ha-raw-${process.pid}`,
    reconnectPeriod: 4000,
    connectTimeout: 8000,
    protocolVersion: 4,
  };
  if (cfg.user) remoteOpts.username = cfg.user;
  if (cfg.password) remoteOpts.password = cfg.password;
  const remote = mqtt.connect(`mqtt://${cfg.host}:${cfg.port}`, remoteOpts);
  state.remote = remote;
  remote.on("connect", () => {
    state.remoteOk = true;
    state.lastError = "";
    remote.subscribe("/devices/+/controls/+/on", { qos: 0 }, () => {});
    discoverAll();
  });
  remote.on("offline", () => {
    state.remoteOk = false;
  });
  remote.on("error", (err) => {
    state.lastError = String(err?.message || err || "ha_mqtt");
  });
  remote.on("message", onRemoteMessage);
}

export function startDeskHaBridge(input) {
  const norm = normalizeHaBroker(input);
  if (!norm.ok) return { ok: false, error: norm.error };
  const prev = readDeskHaConfig();
  const cfg = {
    version: 1,
    enabled: true,
    host: norm.host,
    port: norm.port,
    user: norm.user,
    password: norm.password || prev.password,
  };
  writeDeskHaConfig(cfg);
  connectPair(cfg);
  return publicStatus();
}

export function disableDeskHaBridge() {
  const cfg = { ...readDeskHaConfig(), enabled: false };
  writeDeskHaConfig(cfg);
  stopDeskHaBridge();
  return publicStatus();
}

export function resumeDeskHaBridgeFromDisk() {
  const cfg = readDeskHaConfig();
  if (!cfg.enabled || !cfg.host) return;
  connectPair(cfg);
}

export function deskHaStatus() {
  return publicStatus();
}
