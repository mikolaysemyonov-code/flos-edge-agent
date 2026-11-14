/**
 * Сцены / шторы / охрана со стола → defineRule (кнопка → уровни на линиях).
 */
import { deskButtonCounter, deskPressEdgeLine, deskWhenSpec } from "./runtime-desk-marking.mjs";
import { wbActuatorSetLines } from "./runtime-desk-pour-light.mjs";
import { liveDeskDeviceKey } from "./runtime-desk-rules-marks.mjs";

/** Уровень света 0…100; реле трактует как on/off. */
const SCENE_LEVEL = {
  scene_away: 0,
  scene_vacation: 0,
  scene_good_night: 0,
  scene_day: 0,
  scene_come_home: 100,
  scene_home: 100,
  scene_morning: 80,
  scene_evening: 60,
  scene_cinema: 15,
  scene_dinner: 40,
  scene_kids_night: 5,
  scene_guests: 100,
  scene_work: 100,
  scene_relax: 25,
  light_scene_on: 100,
};

const SCENES = new Set([
  ...Object.keys(SCENE_LEVEL),
  "curtain_button_open",
  "curtain_button_close",
  "curtain_button_stop",
  "gate_button_open",
  "gate_button_close",
  "gate_button_stop",
  "leak_close_valves",
  "siren_motion",
  "lock_button_set",
]);

function esc(s) {
  return JSON.stringify(String(s ?? ""));
}

function pathOf(c) {
  if (!c?.deviceTopicKey || !c?.controlId) return "";
  return liveDeskDeviceKey(c.deviceTopicKey) + "/" + String(c.controlId).trim();
}

function triggerWhen(trig) {
  const dev = liveDeskDeviceKey(trig?.deviceTopicKey);
  const cid = deskButtonCounter(trig?.controlId, "Short", dev);
  if (!dev || !cid) return "";
  return dev + "/" + cid;
}

function sceneLevel(sol, fallback) {
  const n = Number(sol?.params?.level);
  if (Number.isFinite(n)) return Math.max(0, Math.min(100, n));
  return fallback;
}

function clampPct(n, fallback) {
  const v = Number(n);
  if (Number.isFinite(v)) return Math.max(0, Math.min(100, v));
  return fallback;
}

/**
 * Уровень на линию: target.level → params.level → дефолт сцены.
 * Кино: люстра 0%, бра 15%, подсветка 40% — без трёх отдельных карточек.
 */
function emitLevels(sol, level) {
  const when = triggerWhen(sol.trigger);
  const targets = (sol.targets || []).filter((t) => pathOf(t));
  if (!when || !targets.length) return "";
  const id = "desk_sol_" + sol.id + "_scene";
  const fallback = sceneLevel(sol, level);
  const sets = targets
    .flatMap((t) => {
      const p = pathOf(t);
      const pct = clampPct(t.level, fallback);
      return wbActuatorSetLines(p, pct, id, 55).map((line) => "      " + line);
    })
    .join("\n");
  return [
    `defineRule(${esc(id)}, {`,
    deskWhenSpec(when),
    "  then: function (newValue) {",
    "    try {",
    deskPressEdgeLine(when),
    sets,
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id) + ", e); }",
    "  }",
    "});",
  ].join("\n");
}

/** Штора: Open/Close/Stop — пишем в выбранный привод (Open-путь или Close). */
function emitCurtain(sol, kind) {
  const when = triggerWhen(sol.trigger);
  const loads = (sol.targets || []).map(pathOf).filter(Boolean);
  if (!when || !loads.length) return "";
  const id = "desk_sol_" + sol.id + "_curt";
  const lines = loads.flatMap((p) => {
    if (kind === "stop") {
      const open = p.replace(/ Close$/i, " Open");
      const close = p.replace(/ Open$/i, " Close");
      const both = open === close ? [p] : [open, close];
      return both.map((path) => `      wbActuatorSet(${esc(path)}, 0, ${esc(id)}, 55);`);
    }
    let path = p;
    if (kind === "close" && / Open$/i.test(p)) path = p.replace(/ Open$/i, " Close");
    if (kind === "open" && / Close$/i.test(p)) path = p.replace(/ Close$/i, " Open");
    return [`      wbActuatorSet(${esc(path)}, 1, ${esc(id)}, 55);`];
  });
  return [
    `defineRule(${esc(id)}, {`,
    deskWhenSpec(when),
    "  then: function (newValue) {",
    "    try {",
    deskPressEdgeLine(when),
    lines.join("\n"),
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id) + ", e); }",
    "  }",
    "});",
  ].join("\n");
}

/** Замок — жест кнопки, не уровень входа. Счётчик не читаем через wbIsOn. */
function emitLock(sol) {
  const when = triggerWhen(sol.trigger);
  const loads = (sol.targets || []).map(pathOf).filter(Boolean);
  if (!when || !loads.length) return "";
  const id = "desk_sol_" + sol.id + "_sec";
  const sets = loads.map((p) => `      wbActuatorSet(${esc(p)}, 1, ${esc(id)}, 55);`).join("\n");
  return [
    `defineRule(${esc(id)}, {`,
    deskWhenSpec(when),
    "  then: function (newValue) {",
    "    try {",
    deskPressEdgeLine(when),
    sets,
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id) + ", e); }",
    "  }",
    "});",
  ].join("\n");
}

function emitSensorOn(sol) {
  const when = pathOf(sol.trigger);
  const loads = (sol.targets || []).map(pathOf).filter(Boolean);
  if (!when || !loads.length) return "";
  const id = "desk_sol_" + sol.id + "_sec";
  const sets = loads
    .map((p) => `      if (on) wbActuatorSet(${esc(p)}, 1, ${esc(id)}, 55);`)
    .join("\n");
  return [
    `defineRule(${esc(id)}, {`,
    deskWhenSpec(when),
    "  then: function () {",
    "    try {",
    `      var on = wbIsOn(readValue(${esc(when)}));`,
    sets,
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id) + ", e); }",
    "  }",
    "});",
  ].join("\n");
}

export function isDeskSceneSolution(sol) {
  return SCENES.has(String(sol?.solutionId || ""));
}

export function emitDeskScene(sol) {
  const sid = String(sol?.solutionId || "");
  if (!SCENES.has(sid)) return "";
  if (sid === "curtain_button_open" || sid === "gate_button_open") return emitCurtain(sol, "open");
  if (sid === "curtain_button_close" || sid === "gate_button_close") return emitCurtain(sol, "close");
  if (sid === "curtain_button_stop" || sid === "gate_button_stop") return emitCurtain(sol, "stop");
  if (sid === "lock_button_set") return emitLock(sol);
  if (sid === "leak_close_valves" || sid === "siren_motion") return emitSensorOn(sol);
  const level = SCENE_LEVEL[sid];
  if (level == null) return "";
  return emitLevels(sol, level);
}
