/**
 * Сырые нагрузки щита → MQTT Discovery. Клавиши и счётчики нажатий не отдаём.
 */
import { formatDeskShelfLabel, parseDeskDeviceKey } from "./runtime-desk-shelves.mjs";
import {
  daliMqttFromChannel,
  isDaliChannelId,
  parseDaliMqttId,
} from "./runtime-desk-dali.mjs";

/** Группа DALI для HA: MQTT wanted_level, даже если на щите нет group_00. */
export function haDaliGroupTarget(deviceTopicKey, controlId) {
  const mqtt = parseDaliMqttId(deviceTopicKey);
  if (mqtt && /wanted_level/i.test(String(controlId || "")) && /_group_\d+$/i.test(mqtt.mqttId)) {
    return {
      mqttId: mqtt.mqttId,
      gateway: mqtt.gateway,
      channelId: mqtt.channelId,
      controlId: "wanted_level",
    };
  }
  if (!isDaliChannelId(controlId) || !/^bus_\d+_g\d+$/i.test(String(controlId || ""))) return null;
  const gw = mqtt?.gateway || String(deviceTopicKey || "").trim();
  const mqttId = daliMqttFromChannel(gw, controlId);
  const parsed = parseDaliMqttId(mqttId);
  if (!parsed) return null;
  return {
    mqttId: parsed.mqttId,
    gateway: parsed.gateway,
    channelId: parsed.channelId,
    controlId: "wanted_level",
  };
}

export function parseHaRawTopic(topic) {
  const t = String(topic || "").trim();
  const m = /^\/?devices\/([^/]+)\/controls\/([^/]+)(\/on)?$/i.exec(t);
  if (!m) return null;
  const deviceTopicKey = m[1];
  const controlId = m[2];
  const stateTopic = `/devices/${deviceTopicKey}/controls/${controlId}`;
  return {
    deviceTopicKey,
    controlId,
    isCommand: Boolean(m[3]),
    stateTopic,
    commandTopic: `${stateTopic}/on`,
  };
}

/** Brightness-топик WB-LED = тот же канал, что Channel N. */
export function haRawCanonicalControl(controlId) {
  const c = String(controlId || "").trim();
  const bri = /^Channel\s+(\d+)\s+Brightness$/i.exec(c);
  return bri ? `Channel ${bri[1]}` : c;
}

export function isHaRawLoadControl(deviceTopicKey, controlId, driveOnDevice) {
  if (haRawIsSlavedRelay(controlId, driveOnDevice, deviceTopicKey)) return false;
  if (haDaliGroupTarget(deviceTopicKey, controlId)) return true;
  const key = String(deviceTopicKey || "").toLowerCase();
  const type = parseDeskDeviceKey(deviceTopicKey)?.type || "";
  const rawId = String(controlId || "").trim();
  const c = haRawCanonicalControl(controlId);
  if (!c) return false;
  if (/Brightness/i.test(rawId)) return false;
  if (/^Input\s+/i.test(c) || /Press Counter/i.test(c)) return false;
  if (/^IN\d+$/i.test(c) || /^EXT\d+_IN/i.test(c) || /^[A-D]\d+_IN/i.test(c)) return false;
  if (/^(mcm8|mcm16|mcm24|mdi|gpio|wd14|mio-gpio)$/i.test(type)) return false;
  if (/form_logic|reactor_scenes|wirenboard|hwmon|alarms|metrics|power_status|wb-adc|network/i.test(key)) {
    return false;
  }
  if (/^(Curtain|Actuator)\s+\d+\s+(Open|Close)$/i.test(c)) return true;
  if (/^K\d+$/i.test(c) || /^Channel\s+\d+$/i.test(c)) return true;
  return false;
}

export function haRawKind(controlId, deviceTopicKey) {
  if (haDaliGroupTarget(deviceTopicKey, controlId)) return "dim";
  if (/^Channel\s+\d+$/i.test(String(controlId || ""))) return "dim";
  if (/^(Curtain|Actuator)\s+/i.test(String(controlId || ""))) return "drive";
  return "relay";
}

/** 4xW: Channel N = 0/1, яркость — соседний Channel N Brightness. */
export function haRawBrightnessControl(deviceTopicKey, controlId) {
  const m = /^Channel\s+(\d+)$/i.exec(String(controlId || ""));
  if (!m) return "";
  const type = parseDeskDeviceKey(deviceTopicKey)?.type || "";
  if (!/^(led|ampled)/i.test(type)) return "";
  return `Channel ${m[1]} Brightness`;
}

export function haRawUniqueId(deviceTopicKey, controlId) {
  return `flos_ha_${deviceTopicKey}_${controlId}`.replace(/\W+/g, "_").toLowerCase();
}

export function haRawIsDriveControl(controlId) {
  return /^(Curtain|Actuator)\s+\d+\s+(Open|Close)$/i.test(String(controlId || "").trim());
}

export function haRawCurtainPair(controlId) {
  const m = /^(Curtain|Actuator)\s+(\d+)\s+(Open|Close)$/i.exec(String(controlId || "").trim());
  if (!m) return null;
  return { family: m[1], n: m[2], dir: m[3].toLowerCase() };
}

export function haCoverTopics(deviceTopicKey, n) {
  return {
    command: `/flos/cover/${deviceTopicKey}/${n}/set`,
    state: `/flos/cover/${deviceTopicKey}/${n}/state`,
  };
}

export function parseHaCoverCommand(topic) {
  const m = /^\/?flos\/cover\/([^/]+)\/(\d+)\/set$/i.exec(String(topic || "").trim());
  if (!m) return null;
  return { deviceTopicKey: m[1], n: m[2] };
}

export function haDaliTopics(gateway, channelId) {
  return {
    command: `/flos/dali/${gateway}/${channelId}/set`,
    state: `/flos/dali/${gateway}/${channelId}/state`,
  };
}

export function parseHaDaliCommand(topic) {
  const m = /^\/?flos\/dali\/([^/]+)\/([^/]+)\/set$/i.exec(String(topic || "").trim());
  if (!m) return null;
  return { gateway: m[1], channelId: m[2] };
}

/** HA JSON light: brightness 0–255. Число 0–100 с ползунка стола тоже принимаем. */
export function haDaliPctFromPayload(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (s.charAt(0) === "{") {
    try {
      const j = JSON.parse(s);
      const st = String(j.state || "").toUpperCase();
      if (st === "OFF") return 0;
      const b = Number(j.brightness);
      if (Number.isFinite(b) && b > 0) {
        return b > 100 ? Math.max(1, Math.min(100, Math.round((b * 100) / 255))) : b;
      }
      if (st === "ON") return 100;
    } catch {
      return null;
    }
    return null;
  }
  if (/^(off|false)$/i.test(s)) return 0;
  if (/^(on|true)$/i.test(s)) return 100;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return 0;
  if (n > 100) return Math.max(1, Math.min(100, Math.round((n * 100) / 255)));
  return n;
}

export function haDaliStatePayload(pct) {
  const n = Math.max(0, Math.min(100, Number(pct) || 0));
  if (n <= 0) return JSON.stringify({ state: "OFF" });
  return JSON.stringify({
    state: "ON",
    brightness: Math.max(1, Math.round((n * 255) / 100)),
    color_mode: "brightness",
  });
}

/** MR6C / MR3 — шторы, не реле. MR6CU — реле, пока на шине нет Curtain. */
export function haRawIsCurtainModule(deviceTopicKey) {
  const type = String(parseDeskDeviceKey(deviceTopicKey)?.type || "");
  return /^(mr6c|mr6cv3|mr6c-v3|mr3)$/i.test(type);
}

export function haRawCurtainIds(deviceTopicKey) {
  if (!haRawIsCurtainModule(deviceTopicKey)) return [];
  const type = String(parseDeskDeviceKey(deviceTopicKey)?.type || "");
  const n = /^mr3$/i.test(type) ? 1 : 3;
  const ids = [];
  for (let i = 1; i <= n; i += 1) ids.push(`Curtain ${i} Open`, `Curtain ${i} Close`);
  return ids;
}

/** На модуле со шторами K1–K6 — те же выходы, что Open/Close. */
export function haRawIsSlavedRelay(controlId, driveOnDevice, deviceTopicKey) {
  if (!/^K\d+$/i.test(String(controlId || "").trim())) return false;
  if (driveOnDevice === true) return true;
  return Boolean(deviceTopicKey) && haRawIsCurtainModule(deviceTopicKey);
}

export function buildHaRawDiscovery(deviceTopicKey, controlId, title) {
  if (!isHaRawLoadControl(deviceTopicKey, controlId)) return null;
  const dali = haDaliGroupTarget(deviceTopicKey, controlId);
  if (dali) {
    const uniqueId = haRawUniqueId(dali.mqttId, "wanted_level");
    const topics = haDaliTopics(dali.gateway, dali.channelId);
    const label = String(title || "").trim() || dali.channelId.replace(/^bus_(\d+)_g(\d+)$/i, "Шина $1 · группа $2");
    const hardware = (formatDeskShelfLabel(dali.gateway) || dali.gateway) + " · " + dali.channelId;
    return {
      component: "light",
      uniqueId,
      kind: "dim",
      deviceTopicKey: dali.mqttId,
      controlId: "wanted_level",
      gateway: dali.gateway,
      channelId: dali.channelId,
      hardware,
      topic: `homeassistant/light/${uniqueId}/config`,
      payload: {
        name: label,
        unique_id: uniqueId,
        object_id: uniqueId,
        schema: "json",
        command_topic: topics.command,
        state_topic: topics.state,
        brightness: true,
        color_mode: true,
        supported_color_modes: ["brightness"],
        optimistic: false,
        has_entity_name: true,
        device: {
          identifiers: ["flos_" + dali.gateway],
          name: formatDeskShelfLabel(dali.gateway) || dali.gateway,
          manufacturer: "Wiren Board",
        },
      },
    };
  }
  const kind = haRawKind(controlId, deviceTopicKey);
  if (kind === "drive") {
    const pair = haRawCurtainPair(controlId);
    if (!pair) return null;
    const label = `${pair.family} ${pair.n}`;
    const uniqueId = haRawUniqueId(deviceTopicKey, label);
    const topics = haCoverTopics(deviceTopicKey, pair.n);
    const hardware = (formatDeskShelfLabel(deviceTopicKey) || deviceTopicKey) + " · " + label;
    return {
      component: "cover",
      uniqueId,
      kind,
      deviceTopicKey,
      controlId: label,
      hardware,
      topic: `homeassistant/cover/${uniqueId}/config`,
      payload: {
        name: label,
        unique_id: uniqueId,
        object_id: uniqueId,
        device_class: "curtain",
        command_topic: topics.command,
        state_topic: topics.state,
        payload_open: "OPEN",
        payload_close: "CLOSE",
        payload_stop: "STOP",
        state_open: "open",
        state_closed: "closed",
        state_stopped: "stopped",
        optimistic: false,
        has_entity_name: true,
        device: {
          identifiers: ["flos_" + deviceTopicKey],
          name: formatDeskShelfLabel(deviceTopicKey) || deviceTopicKey,
          manufacturer: "Wiren Board",
        },
      },
    };
  }
  const uniqueId = haRawUniqueId(deviceTopicKey, controlId);
  const stateTopic = `/devices/${deviceTopicKey}/controls/${controlId}`;
  const dim = kind === "dim";
  const hardware = (formatDeskShelfLabel(deviceTopicKey) || deviceTopicKey) + " · " + controlId;
  const briId = haRawBrightnessControl(deviceTopicKey, controlId);
  const briTopic = briId ? `/devices/${deviceTopicKey}/controls/${briId}` : "";
  const onPay = briId ? "1" : dim ? "100" : "1";
  const stateTpl =
    "{% set v = value|string|lower %}{{ '" +
    onPay +
    "' if v in ['1','true','on','100'] else '0' }}";
  const payload = {
    name: controlId,
    unique_id: uniqueId,
    object_id: uniqueId,
    state_topic: stateTopic,
    command_topic: `${stateTopic}/on`,
    payload_on: onPay,
    payload_off: "0",
    optimistic: true,
    has_entity_name: true,
    device: {
      identifiers: ["flos_" + deviceTopicKey],
      name: formatDeskShelfLabel(deviceTopicKey) || deviceTopicKey,
      manufacturer: "Wiren Board",
    },
  };
  if (dim) {
    payload.state_value_template = stateTpl;
    payload.brightness_state_topic = briTopic || stateTopic;
    payload.brightness_command_topic = `${briTopic || stateTopic}/on`;
    payload.brightness_scale = 100;
    payload.on_command_type = "first";
  } else {
    payload.value_template = stateTpl;
  }
  const component = dim ? "light" : "switch";
  return {
    component,
    uniqueId,
    kind,
    deviceTopicKey,
    controlId,
    hardware,
    topic: `homeassistant/${component}/${uniqueId}/config`,
    payload,
  };
}

export function haRawEntitiesFromShelves(shelves) {
  const out = [];
  const seen = new Set();
  for (const shelf of Array.isArray(shelves) ? shelves : []) {
    const key = String(shelf?.deviceTopicKey || "").trim();
    for (const ch of Array.isArray(shelf?.channels) ? shelf.channels : []) {
      const controlId = String(ch?.controlId || "").trim();
      const id = `${key}\0${controlId}`;
      if (!key || !controlId || seen.has(id)) continue;
      const title = String(ch?.name || ch?.title || "").trim();
      const row = buildHaRawDiscovery(key, controlId, title);
      if (!row || seen.has(row.uniqueId)) continue;
      seen.add(id);
      seen.add(row.uniqueId);
      out.push({
        ...row,
        lastValue: ch?.lastValue,
        hardware: (formatDeskShelfLabel(key) || key) + " · " + controlId,
        named: Boolean(title),
      });
    }
  }
  out.sort((a, b) => a.uniqueId.localeCompare(b.uniqueId));
  return out;
}

/** wb-engine / native WB discovery — не наш unique_id, гасит линии и дублирует каналы. */
export function isForeignHaDiscovery(topic, payload) {
  const t = String(topic || "");
  if (!/\/config$/.test(t)) return false;
  const raw = String(payload || "");
  if (!raw.trim()) return false;
  if (/flos_ha_|fl_form_logic|fl_reactor_scenes/.test(t)) return false;
  let uid = "";
  try {
    uid = String(JSON.parse(raw).unique_id || "");
  } catch {
    uid = "";
  }
  if (/^flos_ha_|^fl_form_logic|^fl_reactor/.test(uid)) return false;
  if (/flos_led|flos_raw/.test(t) || /^flos_led_|^flos_raw_/.test(uid)) return true;
  if (/wb-modbus|wb-engine/i.test(raw)) return true;
  return /\/devices\/wb-/i.test(raw) && /homeassistant\/(?:light|switch|sensor|binary_sensor|number|select|button|cover)\//.test(t);
}

/** Старые пути discovery (unique_id тот же — HA рисует второго K). */
export function ghostHaDiscoveryTopics(deviceTopicKey, controlId) {
  const key = String(deviceTopicKey || "");
  const c = String(controlId || "");
  if (!key || !c) return [];
  const slug = `${key}_${c}`.replace(/\W+/g, "_").toLowerCase();
  const ctrl = c.replace(/\s+/g, "_");
  const ids = [`flos_led_${slug}`, `flos_raw_${slug}`];
  const out = [];
  for (const kind of ["light", "switch", "cover"]) {
    for (const id of ids) out.push(`homeassistant/${kind}/${id}/config`);
    out.push(`homeassistant/${kind}/${key}/${ctrl}/config`);
    out.push(`homeassistant/${kind}/${key}/${c}/config`);
  }
  return [...new Set(out)];
}

/** Только канонический topic. unique_id на чужом пути — призрак. */
export function shouldTombstoneHaDiscovery(topic, payload, keepTopics) {
  const t = String(topic || "").replace(/^\/+/, "");
  if (!/\/config$/.test(t) || !t.includes("homeassistant/")) return false;
  const raw = String(payload || "");
  if (!raw.trim()) return false;
  if (/fl_form_logic|fl_reactor_scenes/.test(t)) return false;
  let uid = "";
  let stateTopic = "";
  try {
    const j = JSON.parse(raw);
    uid = String(j.unique_id || "");
    stateTopic = String(j.state_topic || "");
  } catch {
    uid = "";
  }
  if (/^fl_form_logic|^fl_reactor/.test(uid)) return false;
  const keep = keepTopics instanceof Set ? keepTopics : new Set(keepTopics || []);
  if (keep.has(t)) return false;
  if (!keep.size) return isForeignHaDiscovery(t, raw);
  if (/^flos_/.test(uid) || /flos_/.test(t)) return true;
  if (isForeignHaDiscovery(t, raw)) return true;
  return /\/devices\/wb-/i.test(stateTopic || raw) && /homeassistant\/(?:light|switch|cover|binary_sensor)\//.test(t);
}

export function normalizeHaBroker(input) {
  const host = String(input?.host || "")
    .trim()
    .replace(/^mqtts?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
  const port = Number(input?.port) > 0 ? Number(input.port) : 1883;
  if (!host) return { ok: false, error: "need_host" };
  if (host === "0.0.0.0" || /\s/.test(host) || /[/?#]/.test(host)) return { ok: false, error: "bad_host" };
  if (!Number.isFinite(port) || port < 1 || port > 65535) return { ok: false, error: "bad_port" };
  return {
    ok: true,
    host,
    port,
    user: String(input?.user || "").trim(),
    password: String(input?.password || ""),
  };
}
