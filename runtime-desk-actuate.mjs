/**
 * Прозвонка с стола: вкл/выкл/импульс нагрузки + live входа (MCM8 / WD14 / GPIO).
 * Локальный MQTT на щите — без облака.
 */
import mqtt from "mqtt";
import { readDeskDocument } from "./runtime-desk-marking.mjs";
import { cellId } from "./runtime-desk-pour-core.mjs";

function brokerUrl() {
  const host = (
    process.env.FLOS_MQTT_MIRROR_HOST ||
    process.env.REACTOR_MQTT_MIRROR_HOST ||
    "127.0.0.1"
  ).trim();
  const port = Number(process.env.FLOS_MQTT_MIRROR_PORT || process.env.REACTOR_MQTT_MIRROR_PORT || 1883) || 1883;
  return `mqtt://${host}:${port}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function cleanKey(raw) {
  const s = String(raw ?? "").trim();
  if (!s || /\/devices\//i.test(s) || s.length > 80) return "";
  return s;
}

function cleanControl(raw) {
  const s = String(raw ?? "").trim();
  if (!s || s.length > 64 || /\/devices\//i.test(s)) return "";
  return s;
}

/** Реле / LED Channel — switch 0/1; DALI level — 0…255. */
export function deskActuatePayloads(deviceTopicKey, controlId) {
  const key = String(deviceTopicKey || "").toLowerCase();
  const cid = String(controlId || "");
  if (/dali|mdali|mao/i.test(key) || /actual_level|brightness/i.test(cid)) {
    return { on: "255", off: "0", pulseMs: 2200, kind: "level" };
  }
  // WB-LED часто с плавным Auto-Change — короткий pulse не успевает разгореться.
  if (/led|ampled/i.test(key) || /^Channel\s+\d+/i.test(cid) || /^CCT/i.test(cid) || /^RGB/i.test(cid)) {
    return { on: "1", off: "0", pulseMs: 2200, kind: "led_switch", brightness: "100" };
  }
  return { on: "1", off: "0", pulseMs: 800, kind: "relay" };
}

/** Имя уже залито в form_logic_os — тумблер пишет туда, мост сам включает лампу. */
export function namedVirtualCell(deviceTopicKey, controlId) {
  try {
    const shelf = readDeskDocument()?.shelves?.[deviceTopicKey];
    const ch = shelf?.channels?.[controlId];
    if (!ch || !String(ch.name || "").trim()) return "";
    return cellId(deviceTopicKey, controlId);
  } catch {
    return "";
  }
}

/** Канал без яркости зажигает лампу на 1%. Яркость пишем до ключа и ещё раз после. */
export function deskActuateWrites(deviceTopicKey, controlId, desired) {
  const pay = deskActuatePayloads(deviceTopicKey, controlId);
  const base = `/devices/${deviceTopicKey}/controls/${controlId}`;
  const off = desired === "off";
  const writes = [];
  const level = { topic: `${base} Brightness`, payload: off ? "0" : pay.brightness || "100" };
  const led = pay.kind === "led_switch" && /^Channel\s+\d+$/i.test(String(controlId || ""));
  if (led) writes.push(level);
  writes.push({ topic: base, payload: off ? pay.off : pay.on });
  if (led) writes.push(level);
  return writes;
}

export function isDeskInputControl(controlId, deviceTopicKey) {
  const c = String(controlId || "").trim();
  const key = String(deviceTopicKey || "").toLowerCase();
  if (/^Input\s+/i.test(c)) return true;
  if (/^EXT\d+_IN/i.test(c) || /^[A-D]\d+_IN/i.test(c)) return true;
  if (/mcm|wd14|mdi|gpio/i.test(key) && !/^K\d+$/i.test(c) && !/^Channel\s+/i.test(c)) {
    if (/^IN/i.test(c) || /_IN/i.test(c)) return true;
  }
  return false;
}

export function deskInputClosed(lastValue) {
  if (lastValue === 1 || lastValue === true || lastValue === "1" || lastValue === "on") return true;
  return false;
}

async function publishWrites(writes) {
  const client = mqtt.connect(brokerUrl(), {
    connectTimeout: 4_000,
    reconnectPeriod: 0,
    protocolVersion: 4,
    clean: true,
  });
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("mqtt_connect_timeout")), 5_000);
      client.on("error", (err) => {
        clearTimeout(t);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
      client.on("connect", () => {
        clearTimeout(t);
        resolve();
      });
    });
    for (const w of writes) {
      const withSlash = w.topic.startsWith("/") ? w.topic : `/${w.topic}`;
      const cmd = withSlash.endsWith("/on") ? withSlash : `${withSlash.replace(/\/+$/, "")}/on`;
      const bare = cmd.replace(/^\//, "");
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`puback timeout: ${cmd}`)), 4_000);
        client.publish(cmd, w.payload, { qos: 1, retain: false }, (err) => {
          clearTimeout(t);
          if (err) reject(err);
          else resolve();
        });
      });
      if (bare !== cmd) {
        try {
          await new Promise((resolve, reject) => {
            client.publish(bare, w.payload, { qos: 0, retain: false }, (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        } catch {
          /* optional */
        }
      }
    }
    return { ok: true };
  } finally {
    try {
      client.end(true);
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {{ deviceTopicKey: string, controlId: string, desired?: 'on'|'off'|'pulse' }} input
 */
export async function actuateDeskChannel(input) {
  const deviceTopicKey = cleanKey(input?.deviceTopicKey);
  const controlId = cleanControl(input?.controlId);
  if (!deviceTopicKey || !controlId) return { ok: false, error: "need_contact" };
  if (isDeskInputControl(controlId, deviceTopicKey)) {
    return { ok: false, error: "input_not_actuatable" };
  }
  const desired = /^(on|off|pulse)$/i.test(String(input?.desired || ""))
    ? String(input.desired).toLowerCase()
    : "pulse";
  const pay = deskActuatePayloads(deviceTopicKey, controlId);
  const virtualCell = namedVirtualCell(deviceTopicKey, controlId);
  const writesFor = (want) =>
    virtualCell
      ? [{ topic: `/devices/form_logic_os/controls/${virtualCell}/on`, payload: want === "off" ? "0" : "1" }]
      : deskActuateWrites(deviceTopicKey, controlId, want);
  if (desired === "on") {
    const pub = await publishWrites(writesFor("on"));
    return { ...pub, desired: "on", kind: pay.kind, value: pay.on };
  }
  if (desired === "off") {
    const pub = await publishWrites(writesFor("off"));
    return { ...pub, desired: "off", kind: pay.kind, value: pay.off };
  }
  const onPub = await publishWrites(writesFor("on"));
  if (!onPub.ok) return { ...onPub, desired: "pulse", kind: pay.kind };
  await sleep(pay.pulseMs);
  const offPub = await publishWrites(writesFor("off"));
  return {
    ok: Boolean(offPub.ok),
    desired: "pulse",
    kind: pay.kind,
    pulseMs: pay.pulseMs,
    error: offPub.error,
  };
}
