/**
 * Сырые нагрузки щита → MQTT Discovery. Клавиши и счётчики нажатий не отдаём.
 */
import { formatDeskShelfLabel, parseDeskDeviceKey } from "./runtime-desk-shelves.mjs";

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
  if (haRawIsSlavedRelay(controlId, driveOnDevice)) return false;
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

export function haRawKind(controlId) {
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

/** На модуле со шторами K1–K6 — те же выходы, что Open/Close. */
export function haRawIsSlavedRelay(controlId, driveOnDevice) {
  return driveOnDevice === true && /^K\d+$/i.test(String(controlId || "").trim());
}

export function buildHaRawDiscovery(deviceTopicKey, controlId, title) {
  if (!isHaRawLoadControl(deviceTopicKey, controlId)) return null;
  const kind = haRawKind(controlId);
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
    name: String(title || "").trim() || controlId,
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
      if (!row) continue;
      seen.add(id);
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
