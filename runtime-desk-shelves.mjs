/**
 * Полки стола: один модуль DIN = одна строка. Каналы — силовые выходы, не всё MQTT.
 */
import { isMarkShieldDiscoverableDeviceKey } from "./lib/mark-shield-discoverable-device.mjs";

const SKU = {
  mr6cu: "WB-MR6CU",
  mr6c: "WB-MR6C",
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

/** DALI-шины одного модуля схлопываются. Суффикс _2 — второй модуль, его id не режем. */
export function parseDeskDeviceKey(raw) {
  const k = String(raw ?? "").trim();
  if (!k) return null;
  if (/^wb-gpio$/i.test(k)) return { canonical: "wb-gpio", type: "gpio", slave: 0, copy: 0 };
  const dali = /^(wb-(?:mdali(?:-3)?|dali))_(\d+)/i.exec(k);
  if (dali) {
    return { canonical: `${dali[1].toLowerCase()}_${dali[2]}`, type: "dali", slave: Number(dali[2]), copy: 0 };
  }
  const m = /^wb-([a-z0-9-]+)_(\d+)(?:_(\d+))?$/i.exec(k);
  if (!m) return null;
  const copy = m[3] ? Number(m[3]) : 0;
  return {
    canonical: `wb-${m[1].toLowerCase()}_${m[2]}${copy ? "_" + copy : ""}`,
    type: m[1].toLowerCase(),
    slave: Number(m[2]),
    copy,
  };
}

export function canonicalDeskShelfKey(deviceTopicKey) {
  return parseDeskDeviceKey(deviceTopicKey)?.canonical ?? String(deviceTopicKey ?? "").trim();
}

export function formatDeskShelfLabel(deviceTopicKey) {
  const p = parseDeskDeviceKey(deviceTopicKey);
  if (!p) return null;
  if (p.type === "gpio") return "GPIO";
  const sku = SKU[p.type] ?? `WB-${p.type.toUpperCase()}`;
  const base = `${sku} №${p.slave}`;
  return p.copy ? `${base} · ${p.copy}` : base;
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

function isLedFamily(type) {
  return /^(led|ampled)$/i.test(String(type ?? ""));
}

/** Фазная штора на MR: Curtain N Open/Close (в веб — «Открыть привод N»). */
export function isDeskDriveControl(controlId) {
  return /^(Curtain|Actuator) \d+ (Open|Close)$/i.test(String(controlId ?? "").trim());
}

function slavedKByDrives(controlId, driveIds) {
  const k = /^K(\d+)$/i.exec(String(controlId ?? "").trim());
  if (!k) return false;
  const pair = Math.ceil(Number(k[1]) / 2);
  return driveIds.some((id) => {
    const m = /^(?:Curtain|Actuator)\s+(\d+)\s+/i.exec(id);
    return m && Number(m[1]) === pair;
  });
}

/** Силовой/входной канал. У реле — K и привод. У LED — Channel, не CCT/RGB. */
export function isDeskShelfChannelControl(controlId, deviceTopicKey) {
  const c = String(controlId ?? "").trim();
  if (!c) return false;
  if (/brightness|temperature|palette|error|voltage|current|power|frequency|energy|status|offline|dapc|bulk_send|wanted_level|go_to_scene|actual_level/i.test(c)) {
    return false;
  }
  const type = parseDeskDeviceKey(deviceTopicKey)?.type ?? "";
  if (isRelayFamily(type)) return /^K\d+$/i.test(c) || isDeskDriveControl(c);
  if (isLedFamily(type)) return /^Channel \d+$/i.test(c);
  if (/^K\d+$/i.test(c) || isDeskDriveControl(c)) return true;
  if (/^Channel \d+$/i.test(c)) return true;
  if (/^(CCT|RGB)\d+$/i.test(c)) return true;
  if (/^Input [A-Z]?\d+$/i.test(c)) return true;
  // Для скана клавиш — счётчик коротких нажатий MCM8.
  if (/^Input [A-Z]?\d+ Short Press Counter$/i.test(c)) return true;
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

function controlOrder(id) {
  const d = /^(?:Curtain|Actuator)\s+(\d+)\s+(Open|Close)$/i.exec(String(id ?? ""));
  if (d) return Number(d[1]) * 2 - (d[2].toLowerCase() === "open" ? 1.5 : 1.4);
  return Number((/(\d+)\s*$/.exec(String(id ?? "")) || [])[1] || 0);
}

function sortControlIds(a, b) {
  const d = controlOrder(a) - controlOrder(b);
  if (d) return d;
  return String(a).localeCompare(String(b));
}

/** MQTT lastValue → канал «горит» (как янтарь на разметке щита). */
export function deskChannelIsOn(lastValue) {
  if (lastValue === 1 || lastValue === true || lastValue === "1" || lastValue === "on") return true;
  if (typeof lastValue === "number" && Number.isFinite(lastValue) && lastValue > 0) return true;
  if (typeof lastValue === "string" && /^-?\d+(\.\d+)?$/.test(lastValue.trim())) {
    return Number(lastValue) > 0;
  }
  return false;
}

function metaErrorOffline(entry) {
  if (entry?.controlId !== "__device_meta_error") return false;
  const v = entry.lastValue;
  return v === 1 || v === true || v === "1" || v === "true";
}

export function groupDeskShelves(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const offline = new Set();
  for (const entry of list) {
    if (!metaErrorOffline(entry)) continue;
    const raw = deviceKeyFromEntry(entry);
    if (!raw) continue;
    offline.add(parseDeskDeviceKey(raw)?.canonical ?? raw);
  }
  const map = new Map();
  for (const entry of list) {
    const raw = deviceKeyFromEntry(entry);
    if (!raw || !isMarkShieldDiscoverableDeviceKey(raw)) continue;
    const parsed = parseDeskDeviceKey(raw);
    const key = parsed?.canonical ?? raw;
    if (offline.has(key)) continue;
    let row = map.get(key);
    if (!row) {
      row = {
        deviceTopicKey: key,
        label: formatDeskShelfLabel(key) ?? key,
        channelCount: 0,
        controls: new Set(),
        values: new Map(),
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
    }
    if (cid && entry && Object.prototype.hasOwnProperty.call(entry, "lastValue")) {
      row.values.set(cid, entry.lastValue);
    }
  }
  for (const row of map.values()) {
    const drives = [...row.controls].filter(isDeskDriveControl);
    if (drives.length) {
      for (const id of [...row.controls]) {
        if (slavedKByDrives(id, drives)) {
          row.controls.delete(id);
          row.values.delete(id);
        }
      }
    }
    row.channelCount = row.controls.size;
  }
  return [...map.values()]
    .map(({ controls, values, buses, type: _t, slave: _s, ...rest }) => ({
      ...rest,
      hint: buses.size > 0 ? ruShiny(buses.size) : null,
      channels: [...controls].sort(sortControlIds).map((controlId) => {
        const ch = { controlId };
        if (values.has(controlId)) ch.lastValue = values.get(controlId);
        return ch;
      }),
    }))
    .sort((a, b) => {
      const pa = parseDeskDeviceKey(a.deviceTopicKey);
      const pb = parseDeskDeviceKey(b.deviceTopicKey);
      const d = familyRank(pa?.type) - familyRank(pb?.type);
      if (d !== 0) return d;
      return (pa?.slave ?? 0) - (pb?.slave ?? 0);
    });
}

/**
 * Сырой или частичный снимок дополняет уже виденные полки и каналы.
 * Не заменяет щит урезанным ответом.
 */
export function unionDeskShelves(prev, next) {
  const by = new Map();
  for (const s of Array.isArray(prev) ? prev : []) {
    if (!s?.deviceTopicKey) continue;
    by.set(s.deviceTopicKey, {
      ...s,
      channels: (Array.isArray(s.channels) ? s.channels : []).map((c) => ({ ...c })),
    });
  }
  for (const n of Array.isArray(next) ? next : []) {
    if (!n?.deviceTopicKey) continue;
    const old = by.get(n.deviceTopicKey);
    if (!old) {
      by.set(n.deviceTopicKey, n);
      continue;
    }
    const channels = old.channels.slice();
    const idx = new Map(channels.map((c, i) => [c.controlId, i]));
    for (const c of Array.isArray(n.channels) ? n.channels : []) {
      if (!c?.controlId) continue;
      const i = idx.get(c.controlId);
      if (i == null) {
        channels.push({ ...c });
        continue;
      }
      const row = { ...channels[i], ...c };
      if (!Object.prototype.hasOwnProperty.call(c, "lastValue") && Object.prototype.hasOwnProperty.call(channels[i], "lastValue")) {
        row.lastValue = channels[i].lastValue;
      }
      channels[i] = row;
    }
    by.set(n.deviceTopicKey, { ...old, ...n, channelCount: channels.length, channels });
  }
  return [...by.values()];
}

/** Модули с /devices/…/meta/error = 1. Молчащий адрес важнее непривязанной клавиши. */
export function countOfflineDevices(entries) {
  let n = 0;
  for (const e of entries || []) {
    if (e?.controlId !== "__device_meta_error") continue;
    const v = e.lastValue;
    if (v === 1 || v === true || v === "1" || v === "true") n += 1;
  }
  return n;
}

/** Сколько модулей и каналов прошлого снимка нет в новом. */
export function deskScanGap(prev, next) {
  const prevArr = Array.isArray(prev) ? prev : [];
  const nextArr = Array.isArray(next) ? next : [];
  const nextBy = new Map();
  for (const s of nextArr) {
    if (s?.deviceTopicKey) nextBy.set(s.deviceTopicKey, s);
  }
  let modulesMissing = 0;
  let channelsMissing = 0;
  for (const s of prevArr) {
    if (!s?.deviceTopicKey) continue;
    const n = nextBy.get(s.deviceTopicKey);
    if (!n) {
      modulesMissing += 1;
      continue;
    }
    const have = new Set((Array.isArray(n.channels) ? n.channels : []).map((c) => c?.controlId).filter(Boolean));
    for (const c of Array.isArray(s.channels) ? s.channels : []) {
      if (c?.controlId && !have.has(c.controlId)) channelsMissing += 1;
    }
  }
  return { modulesMissing, channelsMissing, short: modulesMissing > 0 || channelsMissing > 0 };
}

/**
 * Непустой снимок MQTT заменяет стол целиком. Пустой ответ прошлый снимок не стирает.
 * Канал или модуль, которого в новом снимке нет, на стол не возвращается.
 */
export function rememberDeskShelves(prev, next) {
  const prevArr = Array.isArray(prev) ? prev : [];
  const nextArr = Array.isArray(next) ? next : [];
  if (!nextArr.length) return prevArr;
  return nextArr;
}

/**
 * Готовый снимок заменяет стол, включая пустой.
 * Неготовый полный опрос состав не трогает.
 * Частичный опрос (кнопка, один модуль) только обновляет значения.
 */
export function applyDeskScanShelves(prev, next, opts = {}) {
  if (opts?.partial === true) return patchDeskShelfValues(prev, next);
  if (opts?.ready === false) return Array.isArray(prev) ? prev : [];
  return Array.isArray(next) ? next : [];
}

/** Живой опрос входов обновляет значения. Новых модулей из старого снимка не добавляет. */
export function patchDeskShelfValues(prev, next) {
  const updates = new Map();
  for (const s of Array.isArray(next) ? next : []) {
    if (!s?.deviceTopicKey) continue;
    updates.set(
      s.deviceTopicKey,
      new Map((Array.isArray(s.channels) ? s.channels : []).map((c) => [c?.controlId, c])),
    );
  }
  return (Array.isArray(prev) ? prev : []).map((s) => {
    const row = updates.get(s?.deviceTopicKey);
    if (!row) return s;
    return {
      ...s,
      channels: (Array.isArray(s.channels) ? s.channels : []).map((c) => {
        const n = row.get(c?.controlId);
        if (!n || !Object.prototype.hasOwnProperty.call(n, "lastValue")) return c;
        return { ...c, lastValue: n.lastValue };
      }),
    };
  });
}
