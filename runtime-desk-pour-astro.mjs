/**
 * Сцена «свет по закату»: NOAA sunset/dusk, cron каждую минуту, раз в локальные сутки.
 * Часы и TZ — контроллер. Широта/долгота — поля карточки (дефолт Москва).
 */
import { wbActuatorSetLines } from "./runtime-desk-pour-light.mjs";
import { physPath } from "./runtime-desk-pour-core.mjs";

export const DESK_ASTRO_IDS = new Set(["scene_astro_on"]);

function esc(s) {
  return JSON.stringify(String(s ?? ""));
}

function pathOf(c) {
  if (!c?.deviceTopicKey || !c?.controlId) return "";
  return physPath(c.deviceTopicKey, c.controlId);
}

function num(params, key, fallback) {
  const n = Number(params?.[key]);
  return Number.isFinite(n) ? n : fallback;
}

function clampPct(n, fallback) {
  const v = Number(n);
  if (Number.isFinite(v)) return Math.max(0, Math.min(100, v));
  return fallback;
}

/** NOAA / Williams: UTC hours of rise or set, or null beyond polar circle. */
export function deskSunUtcHours(lat, lon, year, month, day, rising, zenithDeg) {
  const zenith = Number.isFinite(zenithDeg) ? zenithDeg : 90.833;
  const N1 = Math.floor((275 * month) / 9);
  const N2 = Math.floor((month + 9) / 12);
  const N3 = 1 + Math.floor((year - 4 * Math.floor(year / 4) + 2) / 3);
  const N = N1 - N2 * N3 + day - 30;
  const lngHour = lon / 15;
  const t = N + ((rising ? 6 : 18) - lngHour) / 24;
  const M = 0.9856 * t - 3.289;
  let L = M + 1.916 * Math.sin((M * Math.PI) / 180) + 0.02 * Math.sin((2 * M * Math.PI) / 180) + 282.634;
  L = ((L % 360) + 360) % 360;
  let RA = (180 / Math.PI) * Math.atan(0.91764 * Math.tan((L * Math.PI) / 180));
  RA = ((RA % 360) + 360) % 360;
  RA += Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90;
  RA /= 15;
  const sinDec = 0.39782 * Math.sin((L * Math.PI) / 180);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH =
    (Math.cos((zenith * Math.PI) / 180) - sinDec * Math.sin((lat * Math.PI) / 180)) /
    (cosDec * Math.cos((lat * Math.PI) / 180));
  if (cosH > 1 || cosH < -1) return null;
  let H = (180 / Math.PI) * Math.acos(cosH);
  if (rising) H = 360 - H;
  H /= 15;
  const UT = H + RA - 0.06571 * t - 6.622 - lngHour;
  return ((UT % 24) + 24) % 24;
}

export function deskSunLocalMinutes(lat, lon, year, month, day, rising, zenithDeg, tzMin) {
  const utc = deskSunUtcHours(lat, lon, year, month, day, rising, zenithDeg);
  if (utc == null) return null;
  let m = Math.round(utc * 60 + Number(tzMin || 0));
  m %= 1440;
  if (m < 0) m += 1440;
  return m;
}

export function isDeskAstroSolution(sol) {
  return DESK_ASTRO_IDS.has(String(sol?.solutionId || ""));
}

export function emitDeskAstroHelper() {
  return [
    "function __deskSunUtcH(lat, lon, y, m, d, rising, zenith) {",
    "  var N1 = Math.floor(275 * m / 9);",
    "  var N2 = Math.floor((m + 9) / 12);",
    "  var N3 = 1 + Math.floor((y - 4 * Math.floor(y / 4) + 2) / 3);",
    "  var N = N1 - N2 * N3 + d - 30;",
    "  var lngHour = lon / 15;",
    "  var t = N + ((rising ? 6 : 18) - lngHour) / 24;",
    "  var M = 0.9856 * t - 3.289;",
    "  var L = M + 1.916 * Math.sin(M * Math.PI / 180) + 0.020 * Math.sin(2 * M * Math.PI / 180) + 282.634;",
    "  L = ((L % 360) + 360) % 360;",
    "  var RA = (180 / Math.PI) * Math.atan(0.91764 * Math.tan(L * Math.PI / 180));",
    "  RA = ((RA % 360) + 360) % 360;",
    "  RA = RA + (Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90);",
    "  RA = RA / 15;",
    "  var sinDec = 0.39782 * Math.sin(L * Math.PI / 180);",
    "  var cosDec = Math.cos(Math.asin(sinDec));",
    "  var cosH = (Math.cos(zenith * Math.PI / 180) - (sinDec * Math.sin(lat * Math.PI / 180))) / (cosDec * Math.cos(lat * Math.PI / 180));",
    "  if (cosH > 1 || cosH < -1) return null;",
    "  var H = (180 / Math.PI) * Math.acos(cosH);",
    "  if (rising) H = 360 - H;",
    "  H = H / 15;",
    "  var UT = H + RA - 0.06571 * t - 6.622 - lngHour;",
    "  return ((UT % 24) + 24) % 24;",
    "}",
  ].join("\n");
}

export function emitDeskAstro(sol) {
  if (!isDeskAstroSolution(sol)) return "";
  const targets = (sol.targets || []).filter((t) => pathOf(t));
  if (!targets.length) return "";
  const lat = Math.max(-89.9, Math.min(89.9, num(sol.params, "lat", 55.75)));
  const lon = Math.max(-180, Math.min(180, num(sol.params, "lon", 37.62)));
  const offset = Math.max(-180, Math.min(180, Math.round(num(sol.params, "offsetMin", 0))));
  const zenith = String(sol.params?.event || "sunset").toLowerCase() === "dusk" ? 96 : 90.833;
  const fallback = clampPct(sol.params?.level, 100);
  const id = "desk_sol_" + sol.id + "_astro";
  const stamp = "_desk_astro_" + String(sol.id || "").replace(/[^a-zA-Z0-9_]/g, "_");
  const sets = targets
    .flatMap((t) => wbActuatorSetLines(pathOf(t), clampPct(t.level, fallback), id, 55).map((line) => "      " + line))
    .join("\n");
  return [
    `var ${stamp} = "";`,
    `defineRule(${esc(id)}, {`,
    `  cron: "* * * * *",`,
    "  then: function () {",
    "    try {",
    "      var now = new Date();",
    "      var y = now.getFullYear();",
    "      var mo = now.getMonth() + 1;",
    "      var d = now.getDate();",
    "      var day = y + '-' + mo + '-' + d;",
    `      if (${stamp} === day) return;`,
    `      var utc = __deskSunUtcH(${lat}, ${lon}, y, mo, d, false, ${zenith});`,
    "      if (utc == null) return;",
    `      var localMin = Math.round(utc * 60 + (-now.getTimezoneOffset())) + ${offset};`,
    "      localMin = ((localMin % 1440) + 1440) % 1440;",
    "      var nowMin = now.getHours() * 60 + now.getMinutes();",
    "      if (nowMin < localMin) return;",
    `      ${stamp} = day;`,
    sets,
    "    } catch (e) { if (typeof wbRuleGuardCatch === 'function') wbRuleGuardCatch(" + esc(id) + ", e); }",
    "  }",
    "});",
  ].join("\n");
}
