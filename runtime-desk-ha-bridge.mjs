/**
 * Мост: шина щита → Mosquitto на mini-PC (HA). Команды /on обратно.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mqtt from "mqtt";
import { deskMarkingPath } from "./runtime-desk-marking.mjs";
import { parseDaliChannelId } from "./runtime-desk-dali.mjs";
import { daliGroupLevelCommands, daliGroupTempCommands, daliSendCommands, resolveDaliBusId } from "./runtime-desk-dali-rpc.mjs";
import {
  buildHaRawDiscovery,
  ghostHaDiscoveryTopics,
  haDaliGroupTarget,
  haDaliCommandFromPayload,
  haDaliHaTitle,
  haDaliUniqueId,
  haDaliStatePayload,
  legacyHaDaliUniqueIds,
  haDaliTopics,
  haRawBrightnessControl,
  haRawCanonicalControl,
  haCoverTopics,
  haRawCurtainIds,
  haRawCurtainPair,
  haRawIsCurtainModule,
  haRawIsDriveControl,
  haRawIsSlavedRelay,
  haRawUniqueId,
  parseHaCoverCommand,
  parseHaDaliCommand,
  isForeignHaDiscovery,
  isHaRawLoadControl,
  shouldTombstoneHaDiscovery,
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

function mirrorReady() {
  try {
    if (typeof mirror?.connected === "function" && mirror.connected() !== true) return false;
    if (typeof mirror?.topicCount === "function" && Number(mirror.topicCount()) < 1) return false;
  } catch {
    return false;
  }
  return typeof mirror?.publish === "function";
}

function mirrorPublish(topic, payload, retain) {
  try {
    if (!mirrorReady()) return;
    mirror.publish(topic, payload, retain === true);
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

function fieldHaMqttHost(host) {
  const h = String(host || "").trim();
  if (h && !hostIsThisController(h)) return h;
  return String(process.env.FLOS_HA_MQTT_HOST || "100.105.69.95").trim() || "100.105.69.95";
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
  driveKeys: new Set(),
  lastBri: new Map(),
  lastChannelOn: new Map(),
  keepIds: new Set(),
  keepTopics: new Set(),
  ghosted: new Set(),
  entities: new Map(),
  pendingTombstone: new Set(),
  values: new Map(),
  lastError: "",
  lastAt: "",
  sidekick: null,
  sidekickOk: false,
  lastTc: new Map(),
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
    haCmdOk: state.sidekickOk === true || state.remoteOk === true,
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

function tcKey(gateway, channelId) {
  return String(gateway || "") + "\0" + String(channelId || "");
}

async function driveHaDaliGroup(gateway, channelId, pct) {
  const parsed = parseDaliChannelId(channelId);
  if (parsed?.kind !== "group") return { ok: false, error: "need_group" };
  const busId = await resolveDaliBusId(gateway, parsed.bus);
  const cmds = daliGroupLevelCommands(parsed.group, pct);
  const sent = await daliSendCommands(busId, cmds, 8_000);
  state.lastError = sent && sent.ok === false ? String(sent.error || "dali_rpc") : "";
  return { ok: sent?.ok !== false, busId, cmds };
}

async function driveHaDaliTemp(gateway, channelId, mired) {
  const parsed = parseDaliChannelId(channelId);
  if (parsed?.kind !== "group") return { ok: false, error: "need_group" };
  const busId = await resolveDaliBusId(gateway, parsed.bus);
  const cmds = daliGroupTempCommands(parsed.group, mired);
  const sent = await daliSendCommands(busId, cmds, 8_000);
  state.lastError = sent && sent.ok === false ? String(sent.error || "dali_tc") : "";
  return { ok: sent?.ok !== false, busId, cmds };
}

function publishHaDaliState(gateway, channelId, pct, mired) {
  const topics = haDaliTopics(gateway, channelId);
  const key = tcKey(gateway, channelId);
  if (mired != null && Number.isFinite(Number(mired))) state.lastTc.set(key, Number(mired));
  const body = haDaliStatePayload(pct, state.lastTc.get(key));
  state.values.set(topics.state, body);
  pub(state.remote || state.local, topics.state, body, true);
}

function queueHaDaliDrive(gateway, channelId, pct) {
  publishHaDaliState(gateway, channelId, pct);
  void driveHaDaliGroup(gateway, channelId, pct).then((r) => {
    if (r && r.ok === false) state.lastError = String(r.error || "dali_dapc");
  }).catch((e) => {
    state.lastError = String(e?.message || e || "dali_dapc");
  });
}

function queueHaDaliTemp(gateway, channelId, mired) {
  const topics = haDaliTopics(gateway, channelId);
  let pct = 100;
  try {
    const cur = JSON.parse(String(state.values.get(topics.state) || "{}"));
    if (String(cur.state || "").toUpperCase() === "OFF") pct = 0;
    else if (Number.isFinite(Number(cur.brightness))) pct = Math.max(1, Math.round((Number(cur.brightness) * 100) / 255));
  } catch {
    pct = 100;
  }
  publishHaDaliState(gateway, channelId, pct, mired);
  void driveHaDaliTemp(gateway, channelId, mired).then((r) => {
    if (r && r.ok === false) state.lastError = String(r.error || "dali_tc");
  }).catch((e) => {
    state.lastError = String(e?.message || e || "dali_tc");
  });
}

/** Стол задимировал группу — HA не должна висеть «Неизвестно». */
export function syncHaDaliState(gateway, channelId, pct, mired) {
  const parsed = parseDaliChannelId(channelId);
  if (parsed?.kind !== "group") return false;
  publishHaDaliState(gateway, parsed.channelId, pct, mired);
  return true;
}

function applyHaDaliCommand(parsed, payload) {
  const t = haDaliGroupTarget(parsed?.deviceTopicKey, parsed?.controlId);
  if (!t) return false;
  if (t.controlId === "wanted_colour_temperature") {
    const mired = Number(String(payload || "").trim());
    if (Number.isFinite(mired) && mired > 0) queueHaDaliTemp(t.gateway, t.channelId, mired);
    return true;
  }
  const cmd = haDaliCommandFromPayload(payload);
  if (cmd.mired != null) queueHaDaliTemp(t.gateway, t.channelId, cmd.mired);
  if (cmd.pct != null) queueHaDaliDrive(t.gateway, t.channelId, cmd.pct);
  return true;
}

export function onDeskHaDaliCommand(topic, buf) {
  const parsed = parseHaDaliCommand(topic);
  if (!parsed) return false;
  const cmd = haDaliCommandFromPayload(buf ? buf.toString("utf8") : "");
  if (cmd.mired != null) queueHaDaliTemp(parsed.gateway, parsed.channelId, cmd.mired);
  if (cmd.pct != null) queueHaDaliDrive(parsed.gateway, parsed.channelId, cmd.pct);
  return true;
}

export function onDeskHaCoverCommand(topic, buf) {
  const parsed = parseHaCoverCommand(topic);
  if (!parsed) return false;
  if (!state.running) return true;
  const cmd = String(buf ? buf.toString("utf8") : "").trim().toUpperCase();
  let family = "Curtain";
  for (const e of state.entities.values()) {
    if (e.deviceTopicKey === parsed.deviceTopicKey && /^Actuator/i.test(String(e.controlId || ""))) family = "Actuator";
  }
  const n = parsed.n;
  const openT = `/devices/${parsed.deviceTopicKey}/controls/${family} ${n} Open/on`;
  const closeT = `/devices/${parsed.deviceTopicKey}/controls/${family} ${n} Close/on`;
  const st = haCoverTopics(parsed.deviceTopicKey, n).state;
  if (cmd === "OPEN") {
    pub(state.local, openT, "1", false);
    pub(state.local, closeT, "0", false);
    pub(state.local, st, "open", true);
  } else if (cmd === "CLOSE") {
    pub(state.local, closeT, "1", false);
    pub(state.local, openT, "0", false);
    pub(state.local, st, "closed", true);
  } else if (cmd === "STOP") {
    pub(state.local, openT, "0", false);
    pub(state.local, closeT, "0", false);
    pub(state.local, st, "stopped", true);
  }
  return true;
}

export function onDeskHaDiscovery(topic, buf) {
  if (!state.running) return;
  const text = buf ? buf.toString("utf8") : "";
  if (!shouldTombstoneHaDiscovery(topic, text, state.keepTopics)) return;
  if (!state.discovered.size) {
    state.pendingTombstone.add(String(topic));
    return;
  }
  pub(state.remote || state.local, String(topic), "", true);
  state.tombstoned += 1;
}

function rememberEntity(row) {
  if (!row) return;
  state.entities.set(row.uniqueId, {
    uniqueId: row.uniqueId,
    kind: row.kind,
    deviceTopicKey: row.deviceTopicKey,
    controlId: row.controlId,
    name: row.payload?.name || row.controlId,
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

function legacyHaUniqueIds(deviceTopicKey, controlId) {
  const slug = `${deviceTopicKey}_${controlId}`.replace(/\W+/g, "_").toLowerCase();
  return [`flos_led_${slug}`, `flos_raw_${slug}`];
}

function tombstoneUniqueId(uniqueId) {
  const client = state.remote || state.local;
  for (const kind of ["light", "switch", "cover", "binary_sensor"]) {
    pub(client, `homeassistant/${kind}/${uniqueId}/config`, "", true);
  }
  state.discovered.delete(uniqueId);
  state.entities.delete(uniqueId);
}

function tombstoneGhosts(deviceTopicKey, controlId, force) {
  for (const topic of ghostHaDiscoveryTopics(deviceTopicKey, controlId)) {
    const t = topic.replace(/^\/+/, "");
    if (state.keepTopics.has(t)) continue;
    if (!force && state.ghosted.has(t)) continue;
    state.ghosted.add(t);
    pub(state.remote || state.local, topic, "", true);
  }
  if (force) tombstoneUniqueId(haRawUniqueId(deviceTopicKey, controlId));
  for (const uid of legacyHaUniqueIds(deviceTopicKey, controlId)) tombstoneUniqueId(uid);
}

function publishDiscovery(row) {
  if (!row || !state.remote) return;
  if (row.gateway && row.channelId) {
    for (const uid of legacyHaDaliUniqueIds(row.gateway, row.channelId)) {
      if (uid !== row.uniqueId) tombstoneUniqueId(uid);
    }
  }
  if (row.kind === "drive") {
    const pair = haRawCurtainPair(row.payload?.name || row.controlId) || haRawCurtainPair(`${row.controlId} Open`);
    const family = pair?.family || "Curtain";
    const n = pair?.n || String(row.controlId || "").replace(/\D+/g, "") || "1";
    tombstoneGhosts(row.deviceTopicKey, `${family} ${n} Open`, true);
    tombstoneGhosts(row.deviceTopicKey, `${family} ${n} Close`, true);
  }
  if (!state.discovered.has(row.uniqueId)) tombstoneGhosts(row.deviceTopicKey, row.controlId);
  const first = state.discovered.size === 0;
  pub(state.remote, row.topic, JSON.stringify(row.payload), true);
  state.discovered.add(row.uniqueId);
  rememberEntity(row);
  if (first) flushTombstones();
}

function offerDiscovery(parsed) {
  if (!parsed || parsed.isCommand) return null;
  if (!isHaRawLoadControl(parsed.deviceTopicKey, parsed.controlId, state.driveKeys.has(parsed.deviceTopicKey))) {
    return null;
  }
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
  const flos = /^\/flos\//.test(String(row.payload.state_topic || ""));
  if (hostIsThisController(readDeskHaConfig().host) && !flos) return;
  const st = state.values.get(row.payload.state_topic);
  if (st != null && st !== "") pub(client, row.payload.state_topic, st, true);
  else if (flos && row.kind === "dim") pub(client, row.payload.state_topic, haDaliStatePayload(0), true);
  else if (row.kind !== "dim" && row.kind !== "drive") pub(client, row.payload.state_topic, "0", true);
  const bt = row.payload.brightness_state_topic;
  if (bt) {
    const bv = state.values.get(bt);
    const n = Number(bv);
    if (Number.isFinite(n) && n > 0) pub(client, bt, String(n), true);
  }
}

function seedValuesFromShelves() {
  for (const s of loadShelves()) {
    for (const ch of Array.isArray(s?.channels) ? s.channels : []) {
      if (ch?.lastValue == null || ch.lastValue === "") continue;
      const t = `/devices/${s.deviceTopicKey}/controls/${ch.controlId}`;
      if (!state.values.has(t)) state.values.set(t, String(ch.lastValue));
      const dali = haDaliGroupTarget(s.deviceTopicKey, ch.controlId);
      if (dali) {
        const st = haDaliTopics(dali.gateway, dali.channelId).state;
        if (!state.values.has(st)) state.values.set(st, haDaliStatePayload(Number(ch.lastValue) || 0));
      }
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

function refreshDriveKeys() {
  const keys = new Set();
  for (const e of mirrorEntries()) {
    const key = entryDeviceKey(e);
    if (haRawIsDriveControl(e?.controlId) && key) keys.add(key);
    if (haRawIsCurtainModule(key)) keys.add(key);
  }
  for (const key of uniqueMirrorKeys()) {
    if (haRawIsCurtainModule(key)) keys.add(key);
  }
  for (const s of loadShelves()) {
    if (haRawIsCurtainModule(s?.deviceTopicKey)) keys.add(s.deviceTopicKey);
  }
  state.driveKeys = keys;
  return keys;
}

function tombstoneSlavedRelays(driveKeys) {
  for (const key of driveKeys) {
    for (let i = 1; i <= 12; i += 1) {
      tombstoneGhosts(key, `K${i}`, true);
    }
  }
}

function allLoadRows() {
  const driveKeys = refreshDriveKeys();
  const byId = new Map();
  const add = (deviceTopicKey, controlId, title) => {
    if (haDaliGroupTarget(deviceTopicKey, controlId) && !haDaliHaTitle(title)) return;
    if (haRawIsSlavedRelay(controlId, driveKeys.has(deviceTopicKey), deviceTopicKey)) return;
    const row = buildHaRawDiscovery(deviceTopicKey, controlId, title);
    if (!row) return;
    const prev = byId.get(row.uniqueId);
    if (prev && prev.named) return;
    byId.set(row.uniqueId, {
      ...row,
      hardware: row.hardware || row.payload.name,
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
    const ids = haRawIsCurtainModule(key) ? haRawCurtainIds(key) : expectedDeskOutputIds(key);
    for (const id of ids) add(key, id, "");
  }
  return [...byId.values()];
}

function discoverAll() {
  seedValuesFromShelves();
  const rows = allLoadRows();
  state.keepIds = new Set(rows.map((r) => r.uniqueId));
  state.keepTopics = new Set(rows.map((r) => String(r.topic || "").replace(/^\/+/, "")));
  tombstoneSlavedRelays(state.driveKeys);
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
    if (tries < 4) setTimeout(tick, 2500);
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
  state.lastChannelOn.set(parsed.stateTopic, Date.now());
  const briTopic = `/devices/${parsed.deviceTopicKey}/controls/${briId}`;
  const cur = Number(state.values.get(briTopic));
  if (Number.isFinite(cur) && cur > 0) return;
  pub(state.local, `${briTopic}/on`, "100", false);
}

function assistBrightnessZero(parsed, payload) {
  if (!/brightness/i.test(parsed.controlId)) return;
  const n = Number(String(payload || "").trim());
  if (Number.isFinite(n) && n > 0) {
    state.lastBri.set(parsed.stateTopic, String(n));
    return;
  }
  if (n !== 0) return;
  const chId = parsed.controlId.replace(/\s*Brightness\s*$/i, "").trim();
  const chTopic = `/devices/${parsed.deviceTopicKey}/controls/${chId}`;
  const turnedOnAt = state.lastChannelOn.get(chTopic) || 0;
  if (Date.now() - turnedOnAt > 2500) return;
  const restore = state.lastBri.get(parsed.stateTopic) || "100";
  if (restore === "0") return;
  pub(state.local, `${parsed.stateTopic}/on`, restore, false);
}

export function onDeskHaBusTraffic(topic, buf) {
  const parsed = parseHaRawTopic(topic);
  const textEarly = buf ? buf.toString("utf8") : "";
  if (parsed?.isCommand && applyHaDaliCommand(parsed, textEarly)) return;
  if (!state.running) return;
  if (!parsed) return;
  if (haRawIsSlavedRelay(parsed.controlId, state.driveKeys.has(parsed.deviceTopicKey), parsed.deviceTopicKey)) {
    tombstoneGhosts(parsed.deviceTopicKey, parsed.controlId, true);
    return;
  }
  const text = buf ? buf.toString("utf8") : "";
  const pair = haRawCurtainPair(parsed.controlId);
  if (pair && !parsed.isCommand) {
    const on = /^(1|true|on)$/i.test(String(text).trim());
    if (on) pub(state.local, haCoverTopics(parsed.deviceTopicKey, pair.n).state, pair.dir === "open" ? "open" : "closed", true);
    offerDiscovery(parsed);
    return;
  }
  if (!parsed.isCommand) {
    state.values.set(parsed.stateTopic, text);
    if (/brightness/i.test(parsed.controlId)) {
      const n = Number(text);
      if (Number.isFinite(n) && n > 0) state.lastBri.set(parsed.stateTopic, String(n));
    }
    return;
  }
  if (applyHaDaliCommand(parsed, text)) return;
  assistLedCommand(parsed, text);
  assistBrightnessZero(parsed, text);
}

function onBrokerMessage(topic, buf) {
  const text = buf.toString("utf8");
  const parsed = parseHaRawTopic(topic);
  if (parsed && !parsed.isCommand) {
    state.values.set(parsed.stateTopic, text);
    if (/brightness/i.test(parsed.controlId)) {
      const n = Number(text);
      if (Number.isFinite(n) && n > 0) state.lastBri.set(parsed.stateTopic, String(n));
    }
  }
  if (shouldTombstoneHaDiscovery(topic, text, state.keepTopics) || isForeignHaDiscovery(topic, text)) {
    if (state.discovered.size) {
      pub(state.remote || state.local, topic, "", true);
      state.tombstoned += 1;
    } else {
      state.pendingTombstone.add(topic);
    }
    return;
  }
  if (parsed?.isCommand) {
    if (applyHaDaliCommand(parsed, text)) return;
    assistLedCommand(parsed, text);
    assistBrightnessZero(parsed, text);
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
  if (onDeskHaCoverCommand(topic, buf)) return;
  if (onDeskHaDaliCommand(topic, buf)) return;
  const parsed = parseHaRawTopic(topic);
  if (!parsed || !parsed.isCommand) return;
  const text = buf ? buf.toString("utf8") : "";
  if (applyHaDaliCommand(parsed, text)) return;
  if (!isHaRawLoadControl(parsed.deviceTopicKey, parsed.controlId)) return;
  pub(state.local, parsed.commandTopic, text, false);
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
  state.sidekickOk = false;
  const remote = state.remote;
  const local = state.local;
  if (remote && remote !== local) endClient(remote);
  endClient(local);
  endClient(state.sidekick);
  state.local = null;
  state.remote = null;
  state.sidekick = null;
}

function startHaDaliSidekick(alreadyHost) {
  const host = fieldHaMqttHost("");
  if (alreadyHost && String(alreadyHost).trim() === host) return;
  endClient(state.sidekick);
  state.sidekickOk = false;
  const c = mqtt.connect(`mqtt://${host}:1883`, {
    clientId: `flos-ha-dali-${process.pid}`,
    reconnectPeriod: 4000,
    connectTimeout: 8000,
    protocolVersion: 4,
  });
  state.sidekick = c;
  c.on("connect", () => {
    state.sidekickOk = true;
    c.subscribe("/flos/dali/+/+/set", { qos: 0 }, () => {});
    c.subscribe("flos/dali/+/+/set", { qos: 0 }, () => {});
  });
  c.on("offline", () => {
    state.sidekickOk = false;
  });
  c.on("error", (err) => {
    state.lastError = String(err?.message || err || "ha_dali_mqtt");
  });
  c.on("message", (topic, buf) => {
    onDeskHaDaliCommand(topic, buf);
  });
}

function connectLocalViaMirror() {
  stopDeskHaBridge();
  state.running = true;
  state.lastError = "";
  state.tombstoned = 0;
  state.discovered.clear();
  state.driveKeys.clear();
  state.entities.clear();
  state.keepIds.clear();
  state.keepTopics.clear();
  state.ghosted.clear();
  state.pendingTombstone.clear();
  state.values.clear();
  state.lastBri.clear();
  state.lastChannelOn.clear();
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
  const wait = (n) => {
    if (!state.running) return;
    if (mirrorReady() || n >= 40) {
      discoverAll();
      scheduleDiscover();
      return;
    }
    setTimeout(() => wait(n + 1), 400);
  };
  wait(0);
  startHaDaliSidekick();
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
  state.driveKeys.clear();
  state.entities.clear();
  state.keepIds.clear();
  state.keepTopics.clear();
  state.ghosted.clear();
  state.pendingTombstone.clear();
  state.values.clear();
  state.lastBri.clear();
  state.lastChannelOn.clear();
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
    remote.subscribe("/flos/cover/+/+/set", { qos: 0 }, () => {});
    remote.subscribe("/flos/dali/+/+/set", { qos: 0 }, () => {});
    remote.subscribe("flos/dali/+/+/set", { qos: 0 }, () => {});
    scheduleDiscover();
  });
  remote.on("offline", () => {
    state.remoteOk = false;
  });
  remote.on("error", (err) => {
    state.lastError = String(err?.message || err || "ha_mqtt");
  });
  remote.on("message", onRemoteMessage);
  startHaDaliSidekick(cfg.host);
}

export function republishNamedDaliHa() {
  if (!state.running) startDeskHaBridge({ host: "127.0.0.1", port: 1883 });
  const gws = new Set();
  for (const s of loadShelves()) {
    const gw = String(s?.deviceTopicKey || "");
    if (/^wb-dali_/i.test(gw)) gws.add(gw);
  }
  for (const gw of gws) {
    for (let bus = 1; bus <= 3; bus += 1) {
      for (let g = 0; g <= 15; g += 1) {
        const cid = `bus_${bus}_g${g}`;
        for (const uid of legacyHaDaliUniqueIds(gw, cid)) tombstoneUniqueId(uid);
        tombstoneUniqueId(haDaliUniqueId(gw, cid));
      }
    }
  }
  const names = [];
  for (const s of loadShelves()) {
    for (const ch of Array.isArray(s?.channels) ? s.channels : []) {
      const title = haDaliHaTitle(ch?.name || ch?.title);
      if (!title) continue;
      const row = buildHaRawDiscovery(s.deviceTopicKey, ch.controlId, title);
      if (!row?.gateway) continue;
      publishDiscovery(row);
      echoRetained(row);
      names.push(title);
    }
  }
  return { ok: true, daliNamed: names.length, names };
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
