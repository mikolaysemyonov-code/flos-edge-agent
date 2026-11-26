/**
 * Виртуальный термостат карточки климата → ячейки form_logic_os + MQTT climate в HA.
 */
import { liveDeskDeviceKey } from "./runtime-desk-rules-marks.mjs";
import { emptyFormLogicOsSource } from "./runtime-desk-pour-core.mjs";

const HEAT = new Set([
  "warm_floor_comfort",
  "warm_floor_electric_comfort",
  "warm_floor_water_comfort",
  "thermostat_simple_vd",
  "radiator_comfort",
]);

export function isDeskHeatThermostat(sol) {
  return HEAT.has(String(sol?.solutionId || ""));
}

export function deskThermostatCellId(sol) {
  return ("th_" + String(sol?.id || "").replace(/[^a-zA-Z0-9_]/g, "_")).slice(0, 44);
}

export function deskThermostatTitle(sol) {
  const label = String(sol?.params?.label || "").trim();
  if (label) return label.slice(0, 80);
  return String(sol?.title || "Тёплый пол").trim() || "Тёплый пол";
}

function esc(s) {
  return JSON.stringify(String(s ?? ""));
}

function sensorPath(sol) {
  const key = liveDeskDeviceKey(sol?.trigger?.deviceTopicKey);
  const cid = String(sol?.trigger?.controlId || "").trim();
  if (!key || !cid) return "";
  return key + "/" + cid;
}

function mqttControl(path) {
  const i = String(path || "").indexOf("/");
  if (i <= 0) return "";
  return `/devices/${path.slice(0, i)}/controls/${path.slice(i + 1)}`;
}

function flosCellsRe() {
  return /defineVirtualDevice\s*\(\s*["']form_logic_os["'][\s\S]*?cells:\s*\{([\s\S]*?)\n\s*\}/;
}

function upsertCellLine(src, id, line) {
  const re = flosCellsRe();
  const m = re.exec(src);
  if (!m) return { src, changed: false };
  const idQ = esc(id);
  const lineRe = new RegExp(`^\\s*${idQ.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*\\{[^\\n]*\\},?\\s*$`, "m");
  let body = m[1];
  if (lineRe.test(body)) {
    body = body.replace(lineRe, line);
  } else {
    const trimmed = body.replace(/\s*$/, "");
    body = (trimmed ? trimmed + "\n" : "") + line + "\n";
  }
  if (body === m[1]) return { src, changed: false };
  const next = src.slice(0, m.index) + m[0].replace(m[1], body) + src.slice(m.index + m[0].length);
  return { src: next, changed: true };
}

function patchTitleOnly(src, id, title) {
  const needle = esc(id);
  const i = src.indexOf(needle);
  if (i < 0) return { src, changed: false };
  const slice = src.slice(i, i + 360);
  const t = /title:\s*"((?:\\.|[^"\\])*)"/.exec(slice);
  if (!t || t[1] === title) return { src, changed: t ? false : false };
  const from = slice.slice(0, t.index) + `title: ${esc(title)}` + slice.slice(t.index + t[0].length);
  return { src: src.slice(0, i) + from + src.slice(i + slice.length), changed: true };
}

export function mergeDeskThermostatsIntoCore(coreSrc, solutions) {
  const sols = (Array.isArray(solutions) ? solutions : []).filter(isDeskHeatThermostat);
  let src = String(coreSrc || "");
  let changed = false;
  if (!sols.length) return { ok: true, content: src, changed: false };
  if (!/defineVirtualDevice\s*\(\s*["']form_logic_os["']/.test(src)) {
    src = src.trimEnd() ? src.trimEnd() + "\n\n" + emptyFormLogicOsSource() : emptyFormLogicOsSource();
    changed = true;
  }
  for (const sol of sols) {
    const id = deskThermostatCellId(sol);
    const en = id + "_en";
    const title = deskThermostatTitle(sol);
    const thr = Number(sol?.params?.thr);
    const value = Number.isFinite(thr) ? thr : 22;
    if (src.includes(esc(id))) {
      const t = patchTitleOnly(src, id, title);
      src = t.src;
      if (t.changed) changed = true;
      const e = patchTitleOnly(src, en, title + " · нагрев");
      src = e.src;
      if (e.changed) changed = true;
      continue;
    }
    const range = `    ${esc(id)}: { type: "range", title: ${esc(title)}, value: ${value}, min: 5, max: 35 },`;
    const sw = `    ${esc(en)}: { type: "switch", title: ${esc(title + " · нагрев")}, value: true, forceDefault: false },`;
    const a = upsertCellLine(src, id, range);
    src = a.src;
    if (a.changed) changed = true;
    const b = upsertCellLine(src, en, sw);
    src = b.src;
    if (b.changed) changed = true;
  }
  return { ok: true, content: src, changed };
}

export function buildHaClimateDiscovery(sol) {
  if (!isDeskHeatThermostat(sol)) return null;
  const sensor = sensorPath(sol);
  const th = deskThermostatCellId(sol);
  const en = th + "_en";
  const uniqueId = "flos_" + th;
  const name = deskThermostatTitle(sol);
  const cur = mqttControl(sensor);
  const set = `/devices/form_logic_os/controls/${th}`;
  const mode = `/devices/form_logic_os/controls/${en}`;
  if (!cur) return null;
  return {
    component: "climate",
    uniqueId,
    kind: "heat",
    deviceTopicKey: "form_logic_os",
    controlId: th,
    sensorPath: sensor,
    currentTopic: cur,
    setpointTopic: set,
    modeTopic: mode,
    hardware: name,
    named: Boolean(String(sol?.params?.label || "").trim()),
    topic: `homeassistant/climate/${uniqueId}/config`,
    payload: {
      name,
      unique_id: uniqueId,
      object_id: uniqueId,
      modes: ["off", "heat"],
      current_temperature_topic: cur,
      temperature_state_topic: set,
      temperature_command_topic: `${set}/on`,
      mode_state_topic: mode,
      mode_command_topic: `${mode}/on`,
      mode_state_template: "{{ 'heat' if value|string|lower in ['1','true','on'] else 'off' }}",
      mode_command_template: "{{ 1 if value == 'heat' else 0 }}",
      min_temp: 5,
      max_temp: 35,
      temp_step: 0.5,
      temperature_unit: "C",
      has_entity_name: true,
      device: {
        identifiers: ["flos_form_logic_os"],
        name: "FORM LOGIC OS",
        manufacturer: "FLOS",
      },
    },
  };
}
