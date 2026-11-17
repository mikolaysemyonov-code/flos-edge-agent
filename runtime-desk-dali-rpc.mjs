/**
 * Назначение DALI-группы на шине: AddToGroup / RemoveFromGroup через MQTT-RPC.
 */
import mqtt from "mqtt";
import { daliBusUid, parseDaliChannelId } from "./runtime-desk-dali.mjs";

function brokerUrl() {
  const host = (
    process.env.FLOS_MQTT_MIRROR_HOST ||
    process.env.REACTOR_MQTT_MIRROR_HOST ||
    "127.0.0.1"
  ).trim();
  const port = Number(process.env.FLOS_MQTT_MIRROR_PORT || process.env.REACTOR_MQTT_MIRROR_PORT || 1883) || 1883;
  return `mqtt://${host}:${port}`;
}

export function daliGroupMemberCommands(add, remove, group) {
  const g = Number(group);
  const cmds = [];
  for (const a of add) cmds.push(`AddToGroup(A${Number(a)}, G${g})`);
  for (const a of remove) cmds.push(`RemoveFromGroup(A${Number(a)}, G${g})`);
  return cmds;
}

export async function daliSendCommands(busId, commands, timeoutMs = 10_000) {
  const bus = String(busId || "").trim();
  const list = (Array.isArray(commands) ? commands : []).map((c) => String(c || "").trim()).filter(Boolean);
  if (!bus || !list.length) return { ok: true, skipped: true, result: [] };
  const clientId = "flos" + Math.random().toString(36).slice(2, 10);
  const req = `/rpc/v1/wb-mqtt-dali/Bus/SendCommand/${clientId}`;
  const reply = `${req}/reply`;
  const id = Date.now() % 1_000_000_000;
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
    const payload = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("dali_rpc_timeout")), timeoutMs);
      client.subscribe(reply, { qos: 1 }, (err) => {
        if (err) {
          clearTimeout(t);
          reject(err);
        }
      });
      client.on("message", (topic, buf) => {
        if (topic !== reply && topic !== reply.replace(/^\//, "")) return;
        try {
          const json = JSON.parse(String(buf || ""));
          if (Number(json?.id) !== id) return;
          clearTimeout(t);
          resolve(json);
        } catch (e) {
          clearTimeout(t);
          reject(e);
        }
      });
      client.publish(
        req,
        JSON.stringify({ id, params: { busId: bus, commands: list } }),
        { qos: 1, retain: false },
        (err) => {
          if (err) {
            clearTimeout(t);
            reject(err);
          }
        },
      );
    });
    if (payload?.error) {
      return { ok: false, error: payload.error?.message || "dali_rpc", result: payload.result || [] };
    }
    const rows = Array.isArray(payload?.result) ? payload.result : [];
    const bad = rows.find((r) => r && r.status === "error");
    if (bad) return { ok: false, error: bad.error || "dali_cmd", result: rows };
    return { ok: true, result: rows };
  } finally {
    try {
      client.end(true);
    } catch {
      /* ignore */
    }
  }
}

export async function applyDaliGroupMembers({ gateway, bus, group, addAddrs, removeAddrs }) {
  const busId = daliBusUid(gateway, bus);
  const cmds = daliGroupMemberCommands(addAddrs, removeAddrs, group);
  if (!busId) return { ok: false, error: "need_bus" };
  return daliSendCommands(busId, cmds);
}

export function memberAddrsOf(controlIds) {
  const out = [];
  for (const raw of Array.isArray(controlIds) ? controlIds : []) {
    const p = parseDaliChannelId(raw);
    if (p?.kind === "addr") out.push(p.addr);
  }
  return out;
}

