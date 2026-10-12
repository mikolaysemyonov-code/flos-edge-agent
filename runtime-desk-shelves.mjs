/**
 * Полки стола пуска: deviceTopicKey → человеческое имя. Не сырой /devices/…
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
  mdi: "MDI",
  mdm3: "MDM3",
  mdm: "MDM3",
};

function deviceKeyFromEntry(entry) {
  const fromField = String(entry?.deviceTopicKey ?? "").trim();
  if (fromField) return fromField.replace(/^\/devices\//, "").split("/")[0];
  const path = String(entry?.topicPath ?? entry?.topic ?? "");
  const m = /\/devices\/([^/]+)/i.exec(path);
  return m ? m[1] : "";
}

export function formatDeskShelfLabel(deviceTopicKey) {
  const k = String(deviceTopicKey ?? "").trim();
  if (!k) return null;
  if (/^wb-gpio$/i.test(k)) return "GPIO";
  const m = /^wb-([a-z0-9-]+)_(\d+)(.*)$/i.exec(k);
  if (!m) return null;
  const type = m[1].toLowerCase();
  const sku = SKU[type] ?? `WB-${m[1].toUpperCase()}`;
  const rest = String(m[3] ?? "");
  const bus = /_bus_(\d+)/i.exec(rest);
  if (bus) return `${sku} №${m[2]} · шина ${bus[1]}`;
  return `${sku} №${m[2]}`;
}

function isControlEntry(entry) {
  const path = String(entry?.topicPath ?? entry?.topic ?? "");
  if (/\/meta\//i.test(path)) return false;
  return /\/controls\//i.test(path) || Boolean(entry?.controlId);
}

/** Сгруппировать скан в полки. Не discoverable — молча пропуск. */
export function groupDeskShelves(entries) {
  const map = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const key = deviceKeyFromEntry(entry);
    if (!key || !isMarkShieldDiscoverableDeviceKey(key)) continue;
    let row = map.get(key);
    if (!row) {
      const label = formatDeskShelfLabel(key) ?? key;
      row = { deviceTopicKey: key, label, channelCount: 0, controls: new Set() };
      map.set(key, row);
    }
    if (isControlEntry(entry)) {
      const cid = String(entry.controlId ?? entry.topicPath ?? "").trim();
      if (cid && !row.controls.has(cid)) {
        row.controls.add(cid);
        row.channelCount += 1;
      }
    }
  }
  return [...map.values()]
    .map(({ controls: _c, ...rest }) => rest)
    .sort((a, b) => String(a.label).localeCompare(String(b.label), "ru"));
}
