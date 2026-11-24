/**
 * Карточки Ecler → MQTT /flos/audio, агент шлёт JSON-RPC.
 */
import { eclerTopics } from "./runtime-desk-ecler.mjs";
import { deskButtonCounter, deskEmitRule } from "./runtime-desk-marking.mjs";
import { liveDeskDeviceKey } from "./runtime-desk-rules-marks.mjs";

const AUDIO = new Set(["audio_preset", "audio_volume", "audio_stop", "audio_toggle", "audio_volume_hold"]);

function esc(s) {
  return JSON.stringify(String(s ?? ""));
}

function pathOf(c) {
  if (!c?.deviceTopicKey || !c?.controlId) return "";
  return liveDeskDeviceKey(c.deviceTopicKey) + "/" + String(c.controlId).trim();
}

function inputBase(trig) {
  const p = pathOf(trig);
  if (!p) return "";
  return p.replace(/\s+(Single|Shortlong|Short|Long|Double)\s+Press Counter$/i, "");
}

function buttonWhen(trig, kind) {
  const dev = liveDeskDeviceKey(trig?.deviceTopicKey);
  const cid = deskButtonCounter(trig?.controlId, kind, dev);
  if (!dev || !cid) return "";
  return dev + "/" + cid;
}

function pressKind(sol) {
  const p = String(sol?.params?.press || (sol?.solutionId === "audio_toggle" ? "double" : "single")).toLowerCase();
  if (p === "double") return "Double";
  if (p === "long") return "Long";
  if (p === "shortlong") return "Shortlong";
  return "Short";
}

function zoneIds(sol) {
  return (sol.targets || []).map((t) => String(t?.deviceTopicKey || "").trim()).filter((k) => /^ecler-zero_/i.test(k));
}

function payloadOf(sol) {
  const sid = String(sol?.solutionId || "");
  if (sid === "audio_stop") return { state: "OFF" };
  if (sid === "audio_toggle") {
    const p = Number(sol?.params?.preset);
    return { toggle: true, preset: Number.isFinite(p) && p >= 1 ? Math.round(p) : 1 };
  }
  if (sid === "audio_volume") {
    const n = Number(sol?.params?.volume);
    return { state: "ON", volume: Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 40 };
  }
  const p = Number(sol?.params?.preset);
  return { state: "ON", play: true, preset: Number.isFinite(p) && p >= 1 ? Math.round(p) : 1 };
}

function publishLines(zones, payload, indent) {
  const js = JSON.stringify(payload);
  return zones.map((z) => `${indent}publish(${esc(eclerTopics(z).command)}, ${esc(js)}, 1, false);`).join("\n");
}

function emitVolHold(sol) {
  const base = inputBase(sol.trigger);
  const long = buttonWhen(sol.trigger, "Long");
  const shortlong = buttonWhen(sol.trigger, "Shortlong");
  const zones = zoneIds(sol);
  if (!base || !long || !shortlong || !zones.length) return "";
  const id = "desk_sol_" + sol.id;
  const timer = "_desk_vol_" + String(sol.id || "x").replace(/[^a-zA-Z0-9_]/g, "_");
  const tick = (dir) =>
    [
      `      if (${timer}) { try { clearInterval(${timer}); } catch (_c) {} ${timer} = 0; }`,
      publishLines(zones, { volumeDir: dir }, "      "),
      `      ${timer} = setInterval(function () {`,
      "        try {",
      publishLines(zones, { volumeDir: dir }, "          "),
      "        } catch (_e) {}",
      "      }, 180);",
    ].join("\n");
  return [
    `var ${timer} = 0;`,
    `defineRule(${esc(id + "_dim_up")}, {`,
    `  whenChanged: ${esc(long)},`,
    "  then: function () {",
    "    try {",
    tick("inc"),
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id + "_dim_up") + ", e); }",
    "  }",
    "});",
    `defineRule(${esc(id + "_dim_dn")}, {`,
    `  whenChanged: ${esc(shortlong)},`,
    "  then: function () {",
    "    try {",
    tick("dec"),
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id + "_dim_dn") + ", e); }",
    "  }",
    "});",
    `defineRule(${esc(id + "_dim_stop")}, {`,
    `  whenChanged: ${esc(base)},`,
    "  then: function () {",
    "    try {",
    `      if (wbIsOn(readValue(${esc(base)}))) return;`,
    `      if (${timer}) { try { clearInterval(${timer}); } catch (_c) {} ${timer} = 0; }`,
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id + "_dim_stop") + ", e); }",
    "  }",
    "});",
  ].join("\n");
}

export function isDeskAudioSolution(sol) {
  return AUDIO.has(String(sol?.solutionId || ""));
}

export function emitDeskAudio(sol) {
  if (!isDeskAudioSolution(sol)) return "";
  if (String(sol.solutionId) === "audio_volume_hold") return emitVolHold(sol);
  const when = buttonWhen(sol.trigger, pressKind(sol));
  const zones = zoneIds(sol);
  if (!when || !zones.length) return "";
  const id = "desk_sol_" + sol.id + "_audio";
  return deskEmitRule(id, when, publishLines(zones, payloadOf(sol), "      "), {
    pressEdge: !/Press Counter|\scounter$/i.test(when),
  });
}
