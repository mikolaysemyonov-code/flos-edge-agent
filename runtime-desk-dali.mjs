/**
 * DALI на столе: шлюз — полка, адрес/группа — канал bus_N_M.
 * MQTT: wb-dali_14_bus_1_0, wb-dali_14_bus_1_group_05; яркость wanted_level 0…100%.
 */
export function parseDaliMqttId(raw) {
  const k = String(raw ?? "").trim();
  const g = /^(wb-(?:mdali(?:-3)?|dali)_\d+)_bus_(\d+)_group_0*(\d+)$/i.exec(k);
  if (g) {
    const n = Number(g[3]);
    return {
      gateway: g[1].toLowerCase(),
      mqttId: `${g[1].toLowerCase()}_bus_${g[2]}_group_${String(n).padStart(2, "0")}`,
      channelId: `bus_${g[2]}_g${n}`,
    };
  }
  const b = /^(wb-(?:mdali(?:-3)?|dali)_\d+)_bus_(\d+)_broadcast$/i.exec(k);
  if (b) {
    return {
      gateway: b[1].toLowerCase(),
      mqttId: `${b[1].toLowerCase()}_bus_${b[2]}_broadcast`,
      channelId: `bus_${b[2]}_broadcast`,
    };
  }
  const a = /^(wb-(?:mdali(?:-3)?|dali)_\d+)_bus_(\d+)_(\d+)$/i.exec(k);
  if (!a) return null;
  return {
    gateway: a[1].toLowerCase(),
    mqttId: `${a[1].toLowerCase()}_bus_${a[2]}_${a[3]}`,
    channelId: `bus_${a[2]}_${a[3]}`,
  };
}

export function isDaliChannelId(controlId) {
  return /^bus_\d+_(?:g\d+|\d+)$/i.test(String(controlId ?? "").trim());
}

export function parseDaliChannelId(controlId) {
  const cid = String(controlId ?? "").trim();
  const g = /^bus_(\d+)_g(\d+)$/i.exec(cid);
  if (g) return { kind: "group", bus: Number(g[1]), group: Number(g[2]), channelId: `bus_${g[1]}_g${Number(g[2])}` };
  const b = /^bus_(\d+)_broadcast$/i.exec(cid);
  if (b) return { kind: "broadcast", bus: Number(b[1]), channelId: `bus_${b[1]}_broadcast` };
  const a = /^bus_(\d+)_(\d+)$/i.exec(cid);
  if (!a) return null;
  return { kind: "addr", bus: Number(a[1]), addr: Number(a[2]), channelId: `bus_${a[1]}_${a[2]}` };
}

export function isDaliActuateId(controlId) {
  const p = parseDaliChannelId(controlId);
  return Boolean(p && (p.kind === "addr" || p.kind === "group" || p.kind === "broadcast"));
}

/** «гр 1 трек хол 1 эт» — номер группы, тип, комната. */
export function formatDaliGroupName(group, type, room) {
  const n = Number(group);
  if (!Number.isFinite(n) || n < 0) return "";
  return ["гр " + n, String(type || "").trim(), String(room || "").trim()].filter(Boolean).join(" ");
}

export function daliBusUid(gatewayKey, bus) {
  const gw = String(gatewayKey ?? "").trim();
  const n = Number(bus);
  if (!gw || !Number.isFinite(n) || n < 1) return "";
  return `${gw}_bus_${n}`;
}

export function isDaliLevelControl(controlId) {
  return /^(actual_level|wanted_level)$/i.test(String(controlId ?? "").trim());
}

export function isDaliTempControl(controlId) {
  const c = String(controlId ?? "").trim();
  return /colour.?temperature|color_temperature|wanted_colour_temperature|set_colour_temperature/i.test(c);
}

export function daliMqttFromChannel(gatewayKey, controlId) {
  const gw = String(gatewayKey ?? "").trim();
  const cid = String(controlId ?? "").trim();
  const g = /^bus_(\d+)_g(\d+)$/i.exec(cid);
  if (g && gw) return `${gw}_bus_${g[1]}_group_${String(Number(g[2])).padStart(2, "0")}`;
  const b = /^bus_(\d+)_broadcast$/i.exec(cid);
  if (b && gw) return `${gw}_bus_${b[1]}_broadcast`;
  const a = /^bus_(\d+)_(\d+)$/i.exec(cid);
  if (a && gw) return `${gw}_bus_${a[1]}_${a[2]}`;
  return "";
}

/** Ячейка на шине: DALI-канал → wanted_level у адреса/группы. */
export function deskPhysPath(deviceTopicKey, controlId) {
  const key = String(deviceTopicKey ?? "").trim();
  const cid = String(controlId ?? "").trim();
  const parsed = parseDaliMqttId(key);
  const gateway = parsed?.gateway || key;
  const mqtt = daliMqttFromChannel(gateway, cid);
  if (mqtt) return mqtt + "/wanted_level";
  if (!key || !cid) return "";
  return key + "/" + cid;
}
