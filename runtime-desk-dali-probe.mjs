/**
 * Секундомер DALI: нажатие → wanted_level → actual_level. Проверка группы на шине.
 */
import mqtt from "mqtt";
import { daliMqttFromChannel, parseDaliChannelId } from "./runtime-desk-dali.mjs";
import {
  applyDaliGroupMembers,
  daliGroupDriveCommands,
  daliSendCommands,
  memberAddrsOf,
  queryAddrsInGroup,
  readDaliGroupMembers,
  resolveDaliBusId,
} from "./runtime-desk-dali-rpc.mjs";

function brokerUrl() {
  const host = (process.env.FLOS_MQTT_MIRROR_HOST || process.env.REACTOR_MQTT_MIRROR_HOST || "127.0.0.1").trim();
  const port = Number(process.env.FLOS_MQTT_MIRROR_PORT || process.env.REACTOR_MQTT_MIRROR_PORT || 1883) || 1883;
  return `mqtt://${host}:${port}`;
}

export function daliLevelTopics(gateway, controlId) {
  const mqttId = daliMqttFromChannel(gateway, controlId);
  if (!mqttId) return null;
  return {
    mqttId,
    wanted: `/devices/${mqttId}/controls/wanted_level`,
    actual: `/devices/${mqttId}/controls/actual_level`,
  };
}

export function classifyDaliProbeTopic(topic, gateway, controlId) {
  const t = String(topic || "").replace(/^\/+/, "");
  if (/Single Press Counter$/i.test(t.replace(/\/on$/, ""))) return "press";
  const lv = daliLevelTopics(gateway, controlId);
  if (!lv) return "";
  const w = lv.wanted.replace(/^\/+/, "");
  const a = lv.actual.replace(/^\/+/, "");
  if (t === w || t === `${w}/on`) return "command";
  if (t === a || t === `${a}/on`) return "lamp";
  return "";
}

export function daliProbeVerdict(pressToCommandMs, commandToLampMs) {
  if (pressToCommandMs != null && pressToCommandMs > 250) return "service";
  if (commandToLampMs != null && commandToLampMs > 400) return "fade";
  return "ok";
}

export function daliProbeLine(result) {
  if (!result?.ok) return result?.error === "timeout" ? "Не дождались шины — нажми выключатель ещё раз." : "Проба не прошла.";
  const p = result.pressToCommandMs;
  const c = result.commandToLampMs;
  const parts = [];
  if (p != null) parts.push("клавиша " + p + " мс");
  else parts.push("клавишу не слышал");
  if (c != null) parts.push("лампа " + c + " мс");
  else parts.push("лампа молчит");
  const v = result.verdict === "service" ? "тормозит сервис" : result.verdict === "fade" ? "тормозит Fade/шина" : "норма";
  return parts.join(" → ") + " · " + v;
}

function withClient(timeoutMs) {
  const client = mqtt.connect(brokerUrl(), {
    connectTimeout: 4_000,
    reconnectPeriod: 0,
    protocolVersion: 4,
    clean: true,
  });
  const stop = () => {
    try {
      client.end(true);
    } catch {
      /* ignore */
    }
  };
  const ready = new Promise((resolve, reject) => {
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
  return { client, stop, ready, timeoutMs: Math.max(3000, Math.min(Number(timeoutMs) || 12_000, 20_000)) };
}

export async function probeDaliLatency({ gateway, controlId, timeoutMs }) {
  if (!daliLevelTopics(gateway, controlId)) return { ok: false, error: "need_dali" };
  const { client, stop, ready, timeoutMs: wait } = withClient(timeoutMs);
  const t0 = Date.now();
  const at = { press: null, command: null, lamp: null };
  try {
    await ready;
    await new Promise((resolve) => {
      const t = setTimeout(() => resolve(), wait);
      client.subscribe(["/devices/#", "devices/#"], { qos: 0 }, () => {});
      client.on("message", (topic) => {
        const k = classifyDaliProbeTopic(topic, gateway, controlId);
        if (!k || at[k] != null) return;
        at[k] = Date.now();
        if (at.command != null && at.lamp != null && (at.press != null || Date.now() - t0 > 800)) {
          clearTimeout(t);
          resolve();
        }
      });
    });
  } catch (e) {
    stop();
    return { ok: false, error: e?.message || "probe" };
  }
  stop();
  const pressToCommandMs = at.press != null && at.command != null ? at.command - at.press : null;
  const commandToLampMs = at.command != null && at.lamp != null ? at.lamp - at.command : null;
  const pressToLampMs = at.press != null && at.lamp != null ? at.lamp - at.press : null;
  const ok = at.command != null || at.press != null;
  return {
    ok,
    error: ok ? undefined : "timeout",
    pressToCommandMs,
    commandToLampMs,
    pressToLampMs,
    verdict: daliProbeVerdict(pressToCommandMs, commandToLampMs),
    heard: { press: at.press != null, command: at.command != null, lamp: at.lamp != null },
  };
}

export async function verifyDaliGroupOnBus({ gateway, controlId, members, apply = true }) {
  const parsed = parseDaliChannelId(controlId);
  if (parsed?.kind !== "group") return { ok: false, error: "need_group" };
  const want = [...new Set((Array.isArray(members) ? members : []).map(String))];
  const addAddrs = memberAddrsOf(want);
  const applied =
    apply === false
      ? { ok: true, skipped: true }
      : await applyDaliGroupMembers({
          gateway,
          bus: parsed.bus,
          group: parsed.group,
          addAddrs,
          removeAddrs: [],
          memberControlIds: want,
        });
  const busId = await resolveDaliBusId(gateway, parsed.bus);
  const q = await queryAddrsInGroup({ busId, addrs: addAddrs, group: parsed.group });
  const onBus = (q.onBus || []).map((a) => `bus_${parsed.bus}_${a}`);
  const missing = (q.missing || []).map((a) => `bus_${parsed.bus}_${a}`);
  const listed = await readDaliGroupMembers(gateway, parsed.bus, parsed.group);
  const extra = (Array.isArray(listed.members) ? listed.members : []).filter((m) => !want.includes(m));
  const match = want.length > 0 && missing.length === 0 && onBus.length === want.length;
  return {
    ok: match,
    applied: applied.ok !== false,
    readOk: q.ok === true || listed.ok === true,
    members: onBus,
    missing,
    extra,
    query: q,
    error: match ? undefined : q.error || listed.error || (want.length ? "group_mismatch" : "need_members"),
  };
}

export async function followDaliGroup({ gateway, controlId, members, timeoutMs }) {
  const lv = daliLevelTopics(gateway, controlId);
  const addrs = (Array.isArray(members) ? members : []).filter((m) => parseDaliChannelId(m)?.kind === "addr");
  if (!lv || !addrs.length) return { ok: false, error: "need_group" };
  const { client, stop, ready, timeoutMs: wait } = withClient(timeoutMs || 6_000);
  const moved = new Set();
  try {
    await ready;
    const actuals = addrs.map((id) => daliLevelTopics(gateway, id)?.actual).filter(Boolean);
    await new Promise((resolve) => {
      const t = setTimeout(() => resolve(), wait);
      client.subscribe(["/devices/#", "devices/#"], { qos: 0 }, () => {});
      client.on("message", (topic) => {
        const tpc = String(topic || "").replace(/^\/+/, "");
        for (let i = 0; i < addrs.length; i += 1) {
          const a = String(actuals[i] || "").replace(/^\/+/, "");
          if (a && (tpc === a || tpc === `${a}/on`)) moved.add(addrs[i]);
        }
        if (moved.size >= addrs.length) {
          clearTimeout(t);
          resolve();
        }
      });
      client.publish(lv.wanted, "100", { qos: 0, retain: false }, () => {});
      client.publish(`${lv.wanted}/on`, "100", { qos: 0, retain: false }, () => {});
    });
  } catch (e) {
    stop();
    return { ok: false, error: e?.message || "follow" };
  }
  stop();
  return {
    ok: moved.size > 0,
    followed: [...moved],
    silent: addrs.filter((id) => !moved.has(id)),
    of: addrs.length,
  };
}

export function daliActuateProofLine(proof) {
  if (!proof) return "";
  const of = Number(proof.of) || 0;
  const n = Array.isArray(proof.followed) ? proof.followed.length : 0;
  if (n > 0) {
    return "Лампы ответили: " + n + (of ? " из " + of : "")
      + (proof.inGroup != null ? " · в группе " + proof.inGroup : "");
  }
  if (proof.missing && proof.missing.length) return "Не в группе DALI: адреса " + proof.missing.join(", ");
  if (proof.error === "not_in_group") return "Адреса не записались в группу на шине";
  if (proof.via === "dapc") return "DAPC на группу ушёл, лампы молчат";
  if (proof.error) return "Шина: " + proof.error;
  return "Команду опубликовал, лампы не ответили";
}

export async function watchDaliMemberLevels({ gateway, members, timeoutMs }) {
  const addrs = (Array.isArray(members) ? members : []).filter((m) => parseDaliChannelId(m)?.kind === "addr");
  if (!addrs.length) return { followed: [], silent: [], of: 0 };
  const { client, stop, ready, timeoutMs: wait } = withClient(timeoutMs || 3_500);
  const moved = new Set();
  try {
    await ready;
    const actuals = addrs.map((id) => daliLevelTopics(gateway, id)?.actual).filter(Boolean);
    await new Promise((resolve) => {
      const t = setTimeout(() => resolve(), wait);
      client.subscribe(["/devices/#", "devices/#"], { qos: 0 }, () => {});
      client.on("message", (topic) => {
        const tpc = String(topic || "").replace(/^\/+/, "");
        for (let i = 0; i < addrs.length; i += 1) {
          const a = String(actuals[i] || "").replace(/^\/+/, "");
          if (a && (tpc === a || tpc === `${a}/on`)) moved.add(addrs[i]);
        }
        if (moved.size >= addrs.length) {
          clearTimeout(t);
          resolve();
        }
      });
    });
  } catch {
    stop();
    return { followed: [], silent: addrs, of: addrs.length, error: "watch" };
  }
  stop();
  return {
    followed: [...moved],
    silent: addrs.filter((id) => !moved.has(id)),
    of: addrs.length,
  };
}

export async function proveDaliActuate({ gateway, controlId, members, pct }) {
  const parsed = parseDaliChannelId(controlId);
  if (parsed?.kind === "addr") {
    const watch = await watchDaliMemberLevels({ gateway, members: [parsed.channelId], timeoutMs: 3_000 });
    return { ok: watch.followed.length > 0, via: "mqtt", ...watch, error: watch.followed.length ? undefined : "lamps_silent" };
  }
  if (parsed?.kind !== "group") return { ok: false, error: "need_group", followed: [], of: 0 };
  const addrs = memberAddrsOf(members);
  const busId = await resolveDaliBusId(gateway, parsed.bus);
  let q = await queryAddrsInGroup({ busId, addrs, group: parsed.group });
  if (q.missing && q.missing.length) {
    await applyDaliGroupMembers({
      gateway,
      bus: parsed.bus,
      group: parsed.group,
      addAddrs: q.missing,
      removeAddrs: [],
      memberControlIds: members,
    });
    q = await queryAddrsInGroup({ busId, addrs, group: parsed.group });
  }
  const cmds = daliGroupDriveCommands(parsed.group, pct, addrs);
  const sent = await daliSendCommands(busId, cmds, Math.min(60_000, 12_000 + cmds.length * 2_000));
  const watch = await watchDaliMemberLevels({ gateway, members, timeoutMs: 4_000 });
  const inGroup = (q.onBus || []).length;
  return {
    ok: watch.followed.length > 0,
    via: "dapc",
    ...watch,
    busId,
    cmds,
    inGroup,
    missing: q.missing,
    error: watch.followed.length
      ? undefined
      : sent.error || (q.missing && q.missing.length ? "not_in_group" : "lamps_silent"),
  };
}
