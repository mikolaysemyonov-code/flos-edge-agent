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
  haRawBrightnessControl,
  haRawCanonicalControl,
  isForeignHaDiscovery,
  isHaRawLoadControl,
  normalizeHaBroker,
  parseHaRawTopic,
} from "./runtime-desk-ha-raw.mjs";
import { expectedDeskOutputIds } from "./runtime-desk-shelves.mjs";
import { deskHaLights, deskHaPouredLoads } from "./runtime-desk-ha-lights.mjs";

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

let mirror = null;

export function bindDeskHaMirror(src) {
  mirror = src && typeof src === "object" ? src : null;
}

function mirrorEntries() {
  try {
    if (mirror?.map && typeof mirror.map.values === "function") return [...mirror.map.values()];
    const rows = mirror?.entries?.();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function mirrorPublish(topic, payload, retain) {
  try {
    if (typeof mirror?.publish === "function") mirror.publish(topic, payload, retain === true);
  } catch {
    /* ignore */
  }
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
  entities: new Map(),
  pendingTombstone: new Set(),
  values: new Map(),
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
    mirrorTopics: Number(mirror?.topicCount?.() || 0) || 0,
    agentVersion: String(mirror?.version || ""),
    hint: state.discovered.size ? "" : loadHint(),
    entities: publicEntities(),
  };
}

function loadHint() {
  const keys = uniqueMirrorKeys();
  const poured = loadsFromRules().length;
  let led = 0;
  let mr = 0;
  for (const k of keys) {
    if (/led|ampled/i.test(k)) led += 1;
    else if (/mr6|mr12|mr3|mrm/i.test(k)) mr += 1;
  }
  return "правил " + poured + " · шина LED " + led + " · MR " + mr;
}

function entryDeviceKey(e) {
  const k = String(e?.deviceTopicKey || "").trim();
  if (k) return k.replace(/^\/devices\//, "").split("/")[0];
  const path = String(e?.topicPath || e?.id || "");
  const m = /\/devices\/([^/]+)/i.exec(path);
  return m ? m[1] : "";
}

function uniqueMirrorKeys() {
  const keys = new Set();
  try {
    if (typeof mirror?.deviceKeys === "function") {
      for (const k of mirror.deviceKeys() || []) {
        if (k) keys.add(String(k));
      }
    }
    if (mirror?.map && typeof mirror.map.keys === "function") {
      for (const path of mirror.map.keys()) {
        const m = /devices\/([^/]+)/i.exec(String(path || ""));
        if (m) keys.add(m[1]);
      }
    }
  } catch {
    /* ignore */
  }
  for (const e of mirrorEntries()) {
    const key = entryDeviceKey(e);
    if (key) keys.add(key);
  }
  return keys;
}

function loadsFromRules() {
  const dir = (
    process.env.FLOS_WB_RULES_DEPLOY_DIR ||
    process.env.REACTOR_WB_RULES_DEPLOY_DIR ||
    "/etc/wb-rules"
  ).trim();
  let core = "";
  let rules = "";
  try {
    core = fs.readFileSync(path.join(dir, "00_core.js"), "utf8");
  } catch {
    core = "";
  }
  try {
    rules = fs.readFileSync(path.join(dir, "40_rules_user.js"), "utf8");
  } catch {
    rules = "";
  }
  const titled = new Map();
  for (const row of deskHaLights(core, rules)) {
    titled.set(row.deviceTopicKey + "\0" + row.controlId, row.title);
  }
  return deskHaPouredLoads(core).map((row) => ({
    ...row,
    title: titled.get(row.deviceTopicKey + "\0" + row.controlId) || "",
  }));
}

function publicEntities() {
  return [...state.entities.values()].sort((a, b) => a.uniqueId.localeCompare(b.uniqueId));
}

function rememberEntity(row) {
  if (!row) return;
  state.entities.set(row.uniqueId, {
    uniqueId: row.uniqueId,
    kind: row.kind,
    deviceTopicKey: row.deviceTopicKey,
    controlId: row.controlId,
    name: row.payload?.name || row.hardware,
    hardware: row.hardware || row.payload?.name || row.uniqueId,
    named: row.named === true,
  });
}

function pub(client, topic, payload, retain) {
  if (hostIsThisController(readDeskHaConfig().host)) {
    mirrorPublish(topic, payload, retain);
    return;
  }
  if (!client) return;
  client.publish(topic, payload, { qos: 1, retain: retain === true }, () => {});
}

function publishDiscovery(row) {
  if (!row || !state.remote) return;
  const first = state.discovered.size === 0;
  pub(state.remote, row.topic, JSON.stringify(row.payload), true);
  state.discovered.add(row.uniqueId);
  rememberEntity(row);
  if (first) flushTombstones();
}

function offerDiscovery(parsed) {
  if (!parsed || parsed.isCommand) return null;
  if (!isHaRawLoadControl(parsed.deviceTopicKey, parsed.controlId)) return null;
  const row = buildHaRawDiscovery(parsed.deviceTopicKey, parsed.controlId);
  if (!row) return null;
  if (!state.discovered.has(row.uniqueId)) {
    publishDiscovery(row);
    echoRetained(row);
    state.lastAt = new Date().toISOString();
  }
  return row;
}

function echoRetained(row) {
  const client = state.remote || state.local;
  if (!client || !row?.payload) return;
  const st = state.values.get(row.payload.state_topic);
  if (st != null && st !== "") pub(client, row.payload.state_topic, st, true);
  else if (row.kind !== "dim") pub(client, row.payload.state_topic, "0", true);
  const bt = row.payload.brightness_state_topic;
  if (bt) {
    const bv = state.values.get(bt);
    if (bv != null && bv !== "") pub(client, bt, bv, true);
  }
}

function seedValuesFromShelves() {
  for (const s of loadShelves()) {
    for (const ch of Array.isArray(s?.channels) ? s.channels : []) {
      if (ch?.lastValue == null || ch.lastValue === "") continue;
      const t = `/devices/${s.deviceTopicKey}/controls/${ch.controlId}`;
      if (!state.values.has(t)) state.values.set(t, String(ch.lastValue));
    }
  }
}

function flushTombstones() {
  if (!state.discovered.size) return;
  const client = state.remote || state.local;
  for (const topic of state.pendingTombstone) pub(client, topic, "", true);
  state.tombstoned += state.pendingTombstone.size;
  state.pendingTombstone.clear();
}

function allLoadRows() {
  const byId = new Map();
  const add = (deviceTopicKey, controlId, title) => {
    const row = buildHaRawDiscovery(deviceTopicKey, controlId, title);
    if (!row) return;
    const prev = byId.get(row.uniqueId);
    if (prev && prev.named) return;
    byId.set(row.uniqueId, {
      ...row,
      hardware: row.payload.name,
      named: Boolean(String(title || "").trim()),
    });
  };
  const bankKeys = new Set();
  for (const row of loadsFromRules()) {
    add(row.deviceTopicKey, row.controlId, row.title);
    if (row.deviceTopicKey) bankKeys.add(row.deviceTopicKey);
  }
  for (const s of loadShelves()) {
    if (s?.deviceTopicKey) bankKeys.add(s.deviceTopicKey);
    for (const ch of Array.isArray(s?.channels) ? s.channels : []) {
      add(s.deviceTopicKey, ch.controlId, ch.name || ch.title || "");
    }
  }
  const keys = uniqueMirrorKeys();
  for (const key of keys) bankKeys.add(key);
  for (const e of mirrorEntries()) {
    const key = entryDeviceKey(e);
    const controlId = haRawCanonicalControl(e?.controlId);
    if (e?.lastValue != null && e.lastValue !== "" && key && controlId) {
      state.values.set(`/devices/${key}/controls/${controlId}`, String(e.lastValue));
    }
    add(key, controlId, "");
  }
  for (const key of bankKeys) {
    for (const id of expectedDeskOutputIds(key)) add(key, id, "");
  }
  const withDrive = new Set();
  for (const row of byId.values()) {
    if (row.kind === "drive") withDrive.add(row.deviceTopicKey);
  }
  if (withDrive.size) {
    for (const [id, row] of [...byId.entries()]) {
      if (withDrive.has(row.deviceTopicKey) && /^K\d+$/i.test(row.controlId)) byId.delete(id);
    }
  }
  return [...byId.values()];
}

function discoverAll() {
  seedValuesFromShelves();
  const rows = allLoadRows();
  if (!rows.length) return false;
  for (const row of rows) {
    publishDiscovery(row);
    echoRetained(row);
  }
  flushTombstones();
  return true;
}

function scheduleDiscover() {
  let tries = 0;
  const tick = () => {
    if (!state.running) return;
    discoverAll();
    tries += 1;
    if (tries < 16) setTimeout(tick, 2000);
  };
  setTimeout(tick, 200);
}

function assistLedCommand(parsed, payload) {
  const briId = haRawBrightnessControl(parsed.deviceTopicKey, parsed.controlId);
  if (!briId) return;
  const raw = String(payload || "").trim();
  const off = raw === "0" || /^off|false$/i.test(raw);
  const on = raw === "1" || raw === "100" || /^on|true$/i.test(raw);
  if (off || !on) return;
  const briTopic = `/devices/${parsed.deviceTopicKey}/controls/${briId}`;
  const cur = Number(state.values.get(briTopic));
  if (Number.isFinite(cur) && cur > 0) return;
  pub(state.local, `${briTopic}/on`, "100", false);
}

function onBrokerMessage(topic, buf) {
  const text = buf.toString("utf8");
  const parsed = parseHaRawTopic(topic);
  if (parsed && !parsed.isCommand) state.values.set(parsed.stateTopic, text);
  if (isForeignHaDiscovery(topic, text)) {
    if (state.discovered.size) {
      pub(state.remote || state.local, topic, "", true);
      state.tombstoned += 1;
    } else {
      state.pendingTombstone.add(topic);
    }
    return;
  }
  if (parsed?.isCommand) {
    assistLedCommand(parsed, text);
    if (state.remote && state.remote !== state.local) onRemoteMessage(topic, buf);
    return;
  }
  const row = offerDiscovery(parsed);
  if (row && state.remote && state.remote !== state.local) {
    pub(state.remote, parsed.stateTopic, text, true);
    state.forwarded += 1;
    state.lastAt = new Date().toISOString();
  }
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

function connectLocalViaMirror() {
  stopDeskHaBridge();
  state.running = true;
  state.lastError = "";
  state.tombstoned = 0;
  state.discovered.clear();
  state.entities.clear();
  state.pendingTombstone.clear();
  state.values.clear();
  const stub = {
    publish(topic, payload, opts, cb) {
      mirrorPublish(topic, payload, opts && opts.retain === true);
      if (typeof cb === "function") cb();
    },
    subscribe() {},
    end() {},
    removeAllListeners() {},
    on() {},
  };
  state.local = stub;
  state.remote = stub;
  state.localOk = true;
  state.remoteOk = true;
  discoverAll();
  scheduleDiscover();
}

function connectPair(cfg) {
  if (hostIsThisController(cfg.host)) {
    connectLocalViaMirror();
    return;
  }
  stopDeskHaBridge();
  state.running = true;
  state.lastError = "";
  state.tombstoned = 0;
  state.discovered.clear();
  state.entities.clear();
  state.pendingTombstone.clear();
  state.values.clear();
  const local = mqtt.connect(localBrokerUrl(), {
    clientId: `flos-ha-local-${process.pid}`,
    reconnectPeriod: 4000,
    connectTimeout: 8000,
    protocolVersion: 4,
  });
  state.local = local;
  local.on("connect", () => {
    state.localOk = true;
    if (hostIsThisController(cfg.host)) {
      state.remote = local;
      state.remoteOk = true;
    }
    local.subscribe("homeassistant/#", { qos: 0 }, () => {});
    local.subscribe("/devices/#", { qos: 0 }, () => {});
    if (hostIsThisController(cfg.host)) scheduleDiscover();
  });
  local.on("message", onBrokerMessage);
  local.on("offline", () => {
    state.localOk = false;
  });
  local.on("error", (err) => {
    state.lastError = String(err?.message || err || "local_mqtt");
  });
  if (hostIsThisController(cfg.host)) return;
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
    scheduleDiscover();
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
