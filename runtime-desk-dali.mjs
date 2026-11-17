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

/** Подпись адреса: bus 1 / 0. Группа на шине: bus 1 / g0. */
export function formatDaliFixtureLabel(controlId) {
  const p = parseDaliChannelId(controlId);
  if (!p) return String(controlId || "").trim();
  if (p.kind === "group") return "bus " + p.bus + " / g" + p.group;
  if (p.kind === "broadcast") return "bus " + p.bus + " / all";
  return "bus " + p.bus + " / " + p.addr;
}

export function daliBusUid(gatewayKey, bus) {
  const gw = String(gatewayKey ?? "").trim();
  const n = Number(bus);
  if (!gw || !Number.isFinite(n) || n < 1) return "";
  return `${gw}_bus_${n}`;
}

export function firstDaliGatewayFromShelves(shelves) {
  for (const s of Array.isArray(shelves) ? shelves : []) {
    const k = String(s?.deviceTopicKey || "").trim();
    if (/dali/i.test(k)) return k;
  }
  return "";
}

export function pickDaliScanBusId(gateways, bus, fallbackGateway) {
  const n = Number(bus);
  if (!Number.isFinite(n) || n < 1) return "";
  const want = String(fallbackGateway || "").trim();
  const list = Array.isArray(gateways) ? gateways : [];
  const hit = want
    ? list.filter((g) => {
        const gid = String(g?.id || g?.gatewayId || "").trim();
        return gid && (gid === want || want.startsWith(`${gid}_`) || gid.startsWith(want));
      })
    : [];
  const pool = hit.length ? hit : list;
  for (const g of pool) {
    const gid = String(g?.id || g?.gatewayId || "").trim();
    const buses = Array.isArray(g?.buses) ? g.buses : [];
    for (const b of buses) {
      const bid = String(b?.id || "").trim();
      if (bid && (bid.endsWith(`_bus_${n}`) || Number(b?.number) === n || Number(b?.index) === n)) return bid;
    }
    if (gid) return `${gid}_bus_${n}`;
  }
  return daliBusUid(fallbackGateway, n);
}

export function daliGatewaysFromShelves(shelves) {
  const seen = new Set();
  const out = [];
  for (const s of Array.isArray(shelves) ? shelves : []) {
    const k = String(s?.deviceTopicKey || "").trim();
    if (!/dali/i.test(k) || seen.has(k)) continue;
    seen.add(k);
    out.push({ id: k, name: k });
  }
  return out;
}

export function countDaliBusAddresses(shelves, bus, gateway) {
  const n = Number(bus);
  const gw = String(gateway || "").trim();
  let count = 0;
  for (const s of Array.isArray(shelves) ? shelves : []) {
    const key = String(s?.deviceTopicKey || "").trim();
    if (gw && key !== gw) continue;
    for (const ch of Array.isArray(s?.channels) ? s.channels : []) {
      const p = parseDaliChannelId(ch?.controlId);
      if (p?.kind === "addr" && p.bus === n) count += 1;
    }
  }
  return count;
}

export function parseDaliGroupConfig(result, bus) {
  const n = Number(bus);
  const root = result && typeof result === "object" ? result : {};
  const cfg = root.config && typeof root.config === "object" ? root.config : root;
  const raw = cfg.devices || cfg.members || cfg.shortAddresses || root.devices || root.members || [];
  const addrs = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (typeof item === "number" && Number.isFinite(item)) {
      addrs.push(item);
      continue;
    }
    const id = String(item?.id || item?.deviceId || item || "").trim();
    const mqtt = parseDaliMqttId(id);
    if (mqtt) {
      const p = parseDaliChannelId(mqtt.channelId);
      if (p?.kind === "addr") addrs.push(p.addr);
      continue;
    }
    const ch = parseDaliChannelId(id);
    if (ch?.kind === "addr") addrs.push(ch.addr);
    else {
      const m = /(?:^|[^\d])(\d{1,3})$/.exec(id);
      if (m && !/_group_/i.test(id)) addrs.push(Number(m[1]));
    }
  }
  if (!Number.isFinite(n) || n < 1) return [];
  return [...new Set(addrs)]
    .filter((a) => Number.isInteger(a) && a >= 0 && a <= 63)
    .map((a) => `bus_${n}_${a}`);
}

export function scanProgressDone(msg) {
  if (msg == null) return false;
  if (typeof msg === "string") {
    const s = msg.toLowerCase();
    return /complete|finished|done|success|idle/.test(s) || /100\s*%/.test(s);
  }
  const s = String(msg.status || msg.state || msg.stage || "").toLowerCase();
  if (/(fail|error|cancel)/.test(s)) return true;
  if (/(complete|finished|done|success|idle)/.test(s) && s !== "already_running") return true;
  if (msg.finished === true || msg.done === true) return true;
  const pct = Number(msg.progress ?? msg.percent);
  return Number.isFinite(pct) && pct >= 100;
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
