/**
 * Полки стола: один модуль DIN = одна строка. Каналы — силовые выходы, не всё MQTT.
 */
import { isMarkShieldDiscoverableDeviceKey } from "./lib/mark-shield-discoverable-device.mjs";

const SKU = {
  mr6cu: "MR6CU",
  mr6c: "MR6CU",
  mr6cv3: "WB-MR6C-V3",
  "mr6c-v3": "WB-MR6C-V3",
  mr12: "WB-MR12",
  mr6lv: "WB-MR6LV",
  led: "WB-LED",
  ampled: "WB-AMPLED",
  dali: "DALI",
  mdali: "WB-MDALI-3",
  "mdali-3": "WB-MDALI-3",
  mdali3: "WB-MDALI-3",
  gpio: "GPIO",
  mcm8: "WB-MCM8",
  mcm16: "MCM16",
  mao4: "WB-MAO4",
  map3ev: "WB-MAP3EV",
  "mwac-v2": "WB-MWAC-V2",
  mwac: "MWAC",
};

function deviceKeyFromEntry(entry) {
  const fromField = String(entry?.deviceTopicKey ?? "").trim();
  if (fromField) return fromField.replace(/^\/devices\//, "").split("/")[0];
  const path = String(entry?.topicPath ?? entry?.topic ?? "");
  const m = /\/devices\/([^/]+)/i.exec(path);
  return m ? m[1] : "";
}

/** wb-led_176_2 и wb-dali_62_bus_1_0 → канон полки на DIN. */
export function parseDeskDeviceKey(raw) {
  const k = String(raw ?? "").trim();
  if (!k) return null;
  if (/^wb-gpio$/i.test(k)) return { canonical: "wb-gpio", type: "gpio", slave: 0 };
  const dali = /^(wb-(?:mdali(?:-3)?|dali))_(\d+)/i.exec(k);
  if (dali) {
    return { canonical: `${dali[1].toLowerCase()}_${dali[2]}`, type: "dali", slave: Number(dali[2]) };
  }
  const m = /^wb-([a-z0-9-]+)_(\d+)(?:_\d+)?$/i.exec(k);
  if (!m) return null;
  return { canonical: `wb-${m[1].toLowerCase()}_${m[2]}`, type: m[1].toLowerCase(), slave: Number(m[2]) };
}

export function canonicalDeskShelfKey(deviceTopicKey) {
  return parseDeskDeviceKey(deviceTopicKey)?.canonical ?? String(deviceTopicKey ?? "").trim();
}

export function formatDeskShelfLabel(deviceTopicKey) {
  const p = parseDeskDeviceKey(deviceTopicKey);
  if (!p) return null;
  if (p.type === "gpio") return "GPIO";
  const sku = SKU[p.type] ?? `WB-${p.type.toUpperCase()}`;
  return `${sku} №${p.slave}`;
}

function controlIdOf(entry) {
  if (entry?.controlId) return String(entry.controlId).trim();
  const path = String(entry?.topicPath ?? entry?.topic ?? "");
  const m = /\/controls\/([^/]+)$/i.exec(path);
  return m ? m[1].trim() : "";
}

function isRelayFamily(type) {
  return /^(mr6c|mr6cu|mr6cv3|mr6c-v3|mr12|mr6lv|mrm)/i.test(String(type ?? ""));
}

/** Силовой/входной канал. У реле только K1… — не Input/Safety. */
export function isDeskShelfChannelControl(controlId, deviceTopicKey) {
  const c = String(controlId ?? "").trim();
  if (!c) return false;
  if (/brightness|temperature|palette|error|voltage|current|power|frequency|energy|status|offline|dapc|bulk_send|wanted_level|go_to_scene|actual_level/i.test(c)) {
    return false;
  }
  const type = parseDeskDeviceKey(deviceTopicKey)?.type ?? "";
  if (isRelayFamily(type)) return /^K\d+$/i.test(c);
  if (/^K\d+$/i.test(c)) return true;
  if (/^Channel \d+$/i.test(c)) return true;
  if (/^(CCT|RGB)\d+$/i.test(c)) return true;
  if (/^Input [A-Z]?\d+$/i.test(c)) return true;
  if (/^EXT\d+_IN/i.test(c) || /^[A-D]\d+_IN/i.test(c)) return true;
  return false;
}

function familyRank(type) {
  if (isRelayFamily(type)) return 10;
  if (/led|ampled|mdm|mao/i.test(type)) return 20;
  if (/dali/i.test(type)) return 30;
  if (/gpio|mcm|mdi/i.test(type)) return 40;
  if (/map|mwac/i.test(type)) return 50;
  return 90;
}

function daliBusIndex(rawKey) {
  const m = /_bus_(\d+)/i.exec(String(rawKey ?? ""));
  return m ? m[1] : null;
}

function ruShiny(n) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return `${n} шина`;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return `${n} шины`;
  return `${n} шин`;
}

export function groupDeskShelves(entries) {
  const map = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const raw = deviceKeyFromEntry(entry);
    if (!raw || !isMarkShieldDiscoverableDeviceKey(raw)) continue;
    const parsed = parseDeskDeviceKey(raw);
    const key = parsed?.canonical ?? raw;
    let row = map.get(key);
    if (!row) {
      row = {
        deviceTopicKey: key,
        label: formatDeskShelfLabel(key) ?? key,
        channelCount: 0,
        controls: new Set(),
        buses: new Set(),
        type: parsed?.type ?? "",
        slave: parsed?.slave ?? 0,
      };
      map.set(key, row);
    }
    const bus = daliBusIndex(raw) || daliBusIndex(entry?.topicPath);
    if (bus) row.buses.add(bus);
    if (/\/meta\//i.test(String(entry?.topicPath ?? ""))) continue;
    const cid = controlIdOf(entry);
    if (isDeskShelfChannelControl(cid, raw) && !row.controls.has(cid)) {
      row.controls.add(cid);
      row.channelCount += 1;
    }
  }
  return [...map.values()]
    .map(({ controls: _c, buses, type: _t, slave: _s, ...rest }) => ({
      ...rest,
      hint: buses.size > 0 ? ruShiny(buses.size) : null,
    }))
    .sort((a, b) => {
      const pa = parseDeskDeviceKey(a.deviceTopicKey);
      const pb = parseDeskDeviceKey(b.deviceTopicKey);
      const d = familyRank(pa?.type) - familyRank(pb?.type);
      if (d !== 0) return d;
      return (pa?.slave ?? 0) - (pb?.slave ?? 0);
    });
}
