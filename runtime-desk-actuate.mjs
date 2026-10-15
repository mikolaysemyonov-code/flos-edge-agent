/**
 * Прозвонка с стола: вкл/выкл/импульс нагрузки + live входа (MCM8 / WD14 / GPIO).
 * Локальный MQTT на щите — без облака.
 */
import mqtt from "mqtt";

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
    return { on: "255", off: "0", pulseMs: 1200, kind: "level" };
  }
  if (/led|ampled/i.test(key) || /^Channel\s+\d+/i.test(cid) || /^CCT/i.test(cid) || /^RGB/i.test(cid)) {
    return { on: "1", off: "0", pulseMs: 1200, kind: "led_switch" };
  }
  return { on: "1", off: "0", pulseMs: 800, kind: "relay" };
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
  const base = `/devices/${deviceTopicKey}/controls/${controlId}`;
  if (desired === "on") {
    const pub = await publishWrites([{ topic: base, payload: pay.on }]);
    return { ...pub, desired: "on", kind: pay.kind, value: pay.on };
  }
  if (desired === "off") {
    const pub = await publishWrites([{ topic: base, payload: pay.off }]);
    return { ...pub, desired: "off", kind: pay.kind, value: pay.off };
  }
  const onPub = await publishWrites([{ topic: base, payload: pay.on }]);
  if (!onPub.ok) return { ...onPub, desired: "pulse", kind: pay.kind };
  await sleep(pay.pulseMs);
  const offPub = await publishWrites([{ topic: base, payload: pay.off }]);
  return {
    ok: Boolean(offPub.ok),
    desired: "pulse",
    kind: pay.kind,
    pulseMs: pay.pulseMs,
    error: offPub.error,
  };
}
