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

/** Шлюз DALI и его bus_* / broadcast — одна полка. */
export function canonicalDeskShelfKey(deviceTopicKey) {
  const k = String(deviceTopicKey ?? "").trim();
  const dali = /^(wb-(?:mdali(?:-3)?|dali))_(\d+)/i.exec(k);
  if (dali) return `${dali[1].toLowerCase()}_${dali[2]}`;
  return k;
}

export function formatDeskShelfLabel(deviceTopicKey) {
  const k = canonicalDeskShelfKey(deviceTopicKey);
  if (/^wb-gpio$/i.test(k)) return "GPIO";
  const m = /^wb-([a-z0-9-]+)_(\d+)$/i.exec(k);
  if (!m) return null;
  const sku = SKU[m[1].toLowerCase()] ?? `WB-${m[1].toUpperCase()}`;
  return `${sku} №${m[2]}`;
}

function controlIdOf(entry) {
  if (entry?.controlId) return String(entry.controlId).trim();
  const path = String(entry?.topicPath ?? entry?.topic ?? "");
  const m = /\/controls\/([^/]+)$/i.exec(path);
  return m ? m[1].trim() : "";
}

/** Силовой/входной канал полки. Brightness, meta, DALI bulk — не канал. */
export function isDeskShelfChannelControl(controlId) {
  const c = String(controlId ?? "").trim();
  if (!c) return false;
  if (/brightness|temperature|palette|error|voltage|current|power|frequency|energy|status|offline|dapc|bulk_send|wanted_level|go_to_scene|actual_level/i.test(c)) {
    return false;
  }
  if (/^K\d+$/i.test(c)) return true;
  if (/^Channel \d+$/i.test(c)) return true;
  if (/^(CCT|RGB)\d+$/i.test(c)) return true;
  if (/^Input [A-Z]?\d+$/i.test(c)) return true;
  if (/^EXT\d+_IN/i.test(c) || /^[A-D]\d+_IN/i.test(c)) return true;
  return false;
}

function familyRank(key) {
  const k = canonicalDeskShelfKey(key);
  if (/mr6c|mr12|mr6lv|mrm/i.test(k)) return 10;
  if (/led|ampled|mdm|mao/i.test(k)) return 20;
  if (/dali/i.test(k)) return 30;
  if (/gpio|mcm|mdi/i.test(k)) return 40;
  if (/map|mwac/i.test(k)) return 50;
  return 90;
}

function slaveNum(key) {
  const m = /_(\d+)$/.exec(canonicalDeskShelfKey(key));
  return m ? Number(m[1]) : 0;
}

function daliBusIndex(rawKey) {
  const m = /_bus_(\d+)/i.exec(String(rawKey ?? ""));
  return m ? m[1] : null;
}

export function groupDeskShelves(entries) {
  const map = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const raw = deviceKeyFromEntry(entry);
    if (!raw || !isMarkShieldDiscoverableDeviceKey(raw)) continue;
    const key = canonicalDeskShelfKey(raw);
    let row = map.get(key);
    if (!row) {
      row = {
        deviceTopicKey: key,
        label: formatDeskShelfLabel(key) ?? key,
        channelCount: 0,
        controls: new Set(),
        buses: new Set(),
      };
      map.set(key, row);
    }
    const bus = daliBusIndex(raw);
    if (bus) row.buses.add(bus);
    if (/\/meta\//i.test(String(entry?.topicPath ?? ""))) continue;
    const cid = controlIdOf(entry);
    if (isDeskShelfChannelControl(cid) && !row.controls.has(cid)) {
      row.controls.add(cid);
      row.channelCount += 1;
    }
  }
  return [...map.values()]
    .map(({ controls: _c, buses, ...rest }) => ({
      ...rest,
      hint: buses.size > 0 ? `${buses.size} шины` : null,
    }))
    .sort((a, b) => {
      const d = familyRank(a.deviceTopicKey) - familyRank(b.deviceTopicKey);
      if (d !== 0) return d;
      return slaveNum(a.deviceTopicKey) - slaveNum(b.deviceTopicKey);
    });
}
