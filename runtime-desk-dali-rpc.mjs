/**
 * DALI MQTT-RPC: группы, ScanBus, пакет wb-mqtt-dali на хосте щита.
 */
import { execSync } from "node:child_process";
import mqtt from "mqtt";
import {
  daliBusUid,
  daliEditorGroupId,
  daliMqttFromChannel,
  membersOfGroupFromEditorList,
  parseDaliChannelId,
  parseDaliEditorGetList,
  parseDaliGroupConfig,
  pickDaliScanBusId,
  scanProgressDone,
} from "./runtime-desk-dali.mjs";

function rpcErr(payload, fallback) {
  const e = payload?.error;
  if (e == null) return "";
  if (typeof e === "string") return e;
  const msg = String(e.message || fallback || "dali_rpc");
  const data = e.data != null && e.data !== e.message ? String(typeof e.data === "object" ? e.data.message || JSON.stringify(e.data) : e.data) : "";
  return data && data !== msg ? msg + ": " + data : msg;
}

function brokerUrl() {
  const host = (
    process.env.FLOS_MQTT_MIRROR_HOST ||
    process.env.REACTOR_MQTT_MIRROR_HOST ||
    "127.0.0.1"
  ).trim();
  const port = Number(process.env.FLOS_MQTT_MIRROR_PORT || process.env.REACTOR_MQTT_MIRROR_PORT || 1883) || 1883;
  return `mqtt://${host}:${port}`;
}

function shellQuoteSingle(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function execOnHostBash(script, timeoutMs = 120_000) {
  const cmd = `nsenter --target 1 --mount --uts --ipc --net --pid -- bash -lc ${shellQuoteSingle(script)}`;
  return execSync(cmd, { encoding: "utf8", timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 });
}

export function parseDaliBridgeHostOut(text) {
  const lines = String(text || "")
    .trim()
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const pkg = lines.find((l) => /install ok installed|not-installed|missing/i.test(l) || l.includes("|")) || lines[0] || "";
  const activeLine = [...lines].reverse().find((l) => /^(active|inactive|failed|unknown|activating)/i.test(l)) || "";
  const installed = /install ok installed/i.test(pkg);
  let version = installed ? String(pkg.split("|")[1] || "").trim() : "";
  let active = activeLine.toLowerCase() === "active";
  if (/active$/i.test(version) && !/inactive$/i.test(version)) {
    version = version.replace(/active$/i, "").trim();
    active = true;
  }
  return { installed, version, active };
}

const STATUS_SCRIPT = `dpkg-query -W -f='\${Status}|\${Version}\\n' wb-mqtt-dali 2>/dev/null || echo missing
systemctl is-active wb-mqtt-dali 2>/dev/null || true`;

const INSTALL_SCRIPT = `set -e
export DEBIAN_FRONTEND=noninteractive
if ! command -v apt-get >/dev/null 2>&1; then echo no_apt; exit 2; fi
if ! dpkg -s wb-mqtt-dali >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y wb-mqtt-dali
fi
systemctl enable --now wb-mqtt-dali
echo ---
dpkg-query -W -f='\${Status}|\${Version}' wb-mqtt-dali
systemctl is-active wb-mqtt-dali
`;

export function daliBridgeStatus() {
  try {
    const out = execOnHostBash(STATUS_SCRIPT, 15_000);
    return { ok: true, ...parseDaliBridgeHostOut(out), log: String(out).trim() };
  } catch (e) {
    return {
      ok: false,
      error: "host_exec",
      detail: String(e.stderr || e.message || e).slice(-2000),
      installed: false,
      active: false,
    };
  }
}

export function installDaliBridge() {
  try {
    const out = execOnHostBash(INSTALL_SCRIPT, 180_000);
    const tail = String(out).split("---").pop() || out;
    const parsed = parseDaliBridgeHostOut(tail);
    return { ok: parsed.installed, ...parsed, log: String(out).slice(-4000) };
  } catch (e) {
    return {
      ok: false,
      error: "install_failed",
      detail: String(e.stderr || e.message || e).slice(-4000),
      installed: false,
      active: false,
    };
  }
}

export function daliGroupMemberCommands(add, remove, group) {
  const g = Number(group);
  const cmds = [];
  // G<n> у SendCommand — адрес назначения, не номер группы. Номер — data: AddToGroup(A5, 0).
  for (const a of add) cmds.push(`AddToGroup(A${Number(a)}, ${g})`);
  for (const a of remove) cmds.push(`RemoveFromGroup(A${Number(a)}, ${g})`);
  return cmds;
}

export async function daliMqttRpc(service, params, timeoutMs = 10_000) {
  const svc = String(service || "").replace(/^\/+|\/+$/g, "");
  if (!svc) throw new Error("need_rpc");
  const clientId = "flos" + Math.random().toString(36).slice(2, 10);
  const req = `/rpc/v1/wb-mqtt-dali/${svc}/${clientId}`;
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
    return await new Promise((resolve, reject) => {
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
        JSON.stringify({ id, params: params && typeof params === "object" ? params : {} }),
        { qos: 1, retain: false },
        (err) => {
          if (err) {
            clearTimeout(t);
            reject(err);
          }
        },
      );
    });
  } finally {
    try {
      client.end(true);
    } catch {
      /* ignore */
    }
  }
}

export async function daliSendCommands(busId, commands, timeoutMs = 10_000) {
  const bus = String(busId || "").trim();
  const list = (Array.isArray(commands) ? commands : []).map((c) => String(c || "").trim()).filter(Boolean);
  if (!bus || !list.length) return { ok: true, skipped: true, result: [] };
  try {
    const payload = await daliMqttRpc("Bus/SendCommand", { busId: bus, commands: list }, timeoutMs);
    if (payload?.error) {
      return { ok: false, error: rpcErr(payload, "dali_rpc"), result: payload.result || [] };
    }
    const rows = Array.isArray(payload?.result) ? payload.result : [];
    const bad = rows.find((r) => r && r.status === "error");
    if (bad) return { ok: false, error: bad.error || "dali_cmd", result: rows };
    return { ok: true, result: rows };
  } catch (e) {
    return { ok: false, error: e?.message || "dali_rpc" };
  }
}

export async function listDaliGateways() {
  try {
    const payload = await daliMqttRpc("Editor/GetList", {}, 8_000);
    if (payload?.error) {
      return { ok: false, gateways: [], error: rpcErr(payload, "get_list") };
    }
    return { ok: true, gateways: parseDaliEditorGetList(payload?.result) };
  } catch (e) {
    return { ok: false, gateways: [], error: e?.message || "get_list" };
  }
}

export async function waitMqttJson(topic, timeoutMs, isDone) {
  const tpc = String(topic || "").trim();
  if (!tpc) return { done: false };
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
    return await new Promise((resolve) => {
      const t = setTimeout(() => resolve({ done: false, timedOut: true }), timeoutMs);
      const finish = (msg) => {
        clearTimeout(t);
        resolve({ done: true, msg });
      };
      client.subscribe(tpc, { qos: 1 }, () => {});
      client.on("message", (topicGot, buf) => {
        if (topicGot !== tpc && topicGot !== tpc.replace(/^\//, "") && `/${topicGot}` !== tpc) return;
        let msg = String(buf || "");
        try {
          msg = JSON.parse(msg);
        } catch {
          /* plain text progress */
        }
        if (typeof isDone === "function" ? isDone(msg) : scanProgressDone(msg)) finish(msg);
      });
    });
  } catch (e) {
    return { done: false, error: e?.message || "progress" };
  } finally {
    try {
      client.end(true);
    } catch {
      /* ignore */
    }
  }
}

export async function scanDaliBus(busId) {
  const bus = String(busId || "").trim();
  if (!bus) return { ok: false, error: "need_bus" };
  try {
    const payload = await daliMqttRpc("Editor/ScanBus", { busId: bus }, 15_000);
    if (payload?.error) {
      return { ok: false, error: rpcErr(payload, "scan_bus"), busId: bus };
    }
    const result = payload?.result || payload;
    const progressTopic = String(result?.progressTopic || "").trim();
    const progress = progressTopic ? await waitMqttJson(progressTopic, 18_000, scanProgressDone) : { done: true };
    return {
      ok: true,
      result,
      busId: bus,
      progress: progress.msg || null,
      progressTimedOut: progress.timedOut === true,
    };
  } catch (e) {
    return { ok: false, error: e?.message || "scan_bus", busId: bus };
  }
}

export async function readDaliGroupMembers(gateway, bus, group) {
  const listed = await listDaliGateways();
  const fromList = membersOfGroupFromEditorList(listed.gateways, gateway, bus, group);
  if (fromList.length) return { ok: true, members: fromList, via: "list" };
  const ids = [
    daliEditorGroupId(gateway, bus, group),
    daliMqttFromChannel(gateway, `bus_${bus}_g${group}`),
  ].filter(Boolean);
  let lastErr = listed.error || "";
  for (const groupId of ids) {
    try {
      const payload = await daliMqttRpc("Editor/GetGroup", { groupId }, 8_000);
      if (payload?.error) {
        lastErr = rpcErr(payload, "get_group");
        continue;
      }
      return { ok: true, members: parseDaliGroupConfig(payload?.result, bus), groupId };
    } catch (e) {
      lastErr = e?.message || "get_group";
    }
  }
  return { ok: false, members: [], error: lastErr || "get_group" };
}

export async function applyDaliGroupMembers({
  gateway,
  bus,
  group,
  addAddrs,
  removeAddrs,
  memberControlIds,
}) {
  const cmds = daliGroupMemberCommands(addAddrs, removeAddrs, group);
  let busId = daliBusUid(gateway, bus);
  try {
    const listed = await listDaliGateways();
    const picked = pickDaliScanBusId(listed.gateways, bus, gateway);
    if (picked) busId = picked;
  } catch {
    /* fallback uid */
  }
  if (!busId) return { ok: false, error: "need_bus" };
  let sent = { ok: true, skipped: true, reason: "no_change" };
  if (cmds.length) {
    const timeoutMs = Math.min(90_000, 20_000 + cmds.length * 8_000);
    sent = await daliSendCommands(busId, cmds, timeoutMs);
  }
  const groupId = daliEditorGroupId(gateway, bus, group);
  const devices = (Array.isArray(memberControlIds) ? memberControlIds : [])
    .map((id) => daliMqttFromChannel(gateway, id))
    .filter(Boolean);
  if (groupId) {
    try {
      const payload = await daliMqttRpc("Editor/SetGroup", { groupId, config: { devices } }, 25_000);
      if (payload?.error) sent = { ...sent, editor: rpcErr(payload, "set_group") };
      else {
        sent = { ...sent, editor: "ok" };
        if (!sent.ok) sent = { ...sent, ok: true, via: "editor" };
      }
    } catch (e) {
      sent = { ...sent, editor: String(e?.message || e) };
    }
  }
  return sent;
}

export function memberAddrsOf(controlIds) {
  const out = [];
  for (const raw of Array.isArray(controlIds) ? controlIds : []) {
    const p = parseDaliChannelId(raw);
    if (p?.kind === "addr") out.push(p.addr);
  }
  return out;
}
