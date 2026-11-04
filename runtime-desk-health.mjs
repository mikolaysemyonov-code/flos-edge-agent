/**
 * Диагностика стола перед заливкой: дыры в разметке, плане, типовых.
 * Без MQTT — чистая функция по снимку полок + планам.
 */
import { deskInputBaseControl } from "./runtime-desk-marking.mjs";
import { findContinuousOutputClash, findScheduleOutputClash } from "./runtime-desk-solutions.mjs";

function contactKey(dk, cid) {
  return String(dk || "") + "::" + String(cid || "");
}

function isInput(cid) {
  const c = String(cid || "").trim();
  return /^Input\s+/i.test(c) || /^EXT\d+_IN/i.test(c) || /^[A-D]\d+_IN/i.test(c);
}

function isLoad(cid) {
  const c = String(cid || "").trim();
  return /^Channel\s+\d+$/i.test(c) || /^K\d+$/i.test(c) || /^CCT\d+$/i.test(c);
}

export const DESK_TIME_ZONES = [
  { id: "Europe/Kaliningrad", label: "Калининград", offset: "UTC+2" },
  { id: "Europe/Moscow", label: "Москва", offset: "UTC+3" },
  { id: "Europe/Samara", label: "Самара", offset: "UTC+4" },
  { id: "Asia/Yekaterinburg", label: "Екатеринбург", offset: "UTC+5" },
  { id: "Asia/Omsk", label: "Омск", offset: "UTC+6" },
  { id: "Asia/Krasnoyarsk", label: "Красноярск", offset: "UTC+7" },
  { id: "Asia/Irkutsk", label: "Иркутск", offset: "UTC+8" },
  { id: "Asia/Yakutsk", label: "Якутск", offset: "UTC+9" },
  { id: "Asia/Vladivostok", label: "Владивосток", offset: "UTC+10" },
  { id: "Asia/Magadan", label: "Магадан", offset: "UTC+11" },
  { id: "Asia/Kamchatka", label: "Камчатка", offset: "UTC+12" },
];

export function deskTimeZoneById(id) {
  const want = String(id || "").trim();
  return DESK_TIME_ZONES.find((zone) => zone.id === want) || null;
}

function clockLabel(year, month, day, hh, mm) {
  const ok = year >= 2026 && year <= 2035;
  const dd = String(day).padStart(2, "0");
  const mo = String(month).padStart(2, "0");
  return {
    ok,
    label: ok ? dd + "." + mo + " " + String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0") : "часы неверные",
  };
}

/** Строка `date -Iseconds` с часов контроллера, не из контейнера. */
export function clockFromHostText(text) {
  const raw = String(text || "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(raw);
  if (!m) return null;
  const face = clockLabel(Number(m[1]), Number(m[2]), Number(m[3]), m[4], m[5]);
  return { ...face, source: "host", iso: raw, unverified: false };
}

/** Часы процесса. Сценарий «в 23:15» идёт по часам контроллера, этот циферблат — запасной. */
export function assessControllerClock(now = new Date()) {
  const face = clockLabel(now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes());
  return { ...face, source: "process", iso: now.toISOString(), unverified: true };
}

function issue(level, code, text, extra = {}) {
  return { level, code, text, ...extra };
}

/**
 * @param {Array} shelves
 * @param {{ keyPlan?:Array, linePlan?:Array, solutions?:Array }} ctx
 */
export function assessDeskHealth(shelves, ctx = {}) {
  const rows = Array.isArray(shelves) ? shelves : [];
  const keyPlan = Array.isArray(ctx.keyPlan) ? ctx.keyPlan : [];
  const linePlan = Array.isArray(ctx.linePlan) ? ctx.linePlan : [];
  const solutions = Array.isArray(ctx.solutions) ? ctx.solutions : [];
  const issues = [];

  if (!rows.length) {
    issues.push(issue("bad", "no_bus", "Шина пуста — нет полок MQTT. Обновите скан."));
    return { ok: false, issues, summary: { modules: 0, named: 0, unboundLoads: 0 } };
  }

  let named = 0;
  let unboundLoads = 0;
  const nameMap = new Map();
  const byContact = new Map();

  for (const s of rows) {
    const dk = String(s?.deviceTopicKey || "");
    for (const ch of Array.isArray(s?.channels) ? s.channels : []) {
      const cid = String(ch?.controlId || "");
      if (/\s+(?:Single|Short|Long|Shortlong|Double) Press Counter$/i.test(cid)) continue;
      const name = String(ch?.name || "").trim();
      byContact.set(contactKey(dk, cid), { dk, cid, name, s });
      if (name) {
        named += 1;
        const k = name.toLowerCase();
        if (!nameMap.has(k)) nameMap.set(k, []);
        nameMap.get(k).push(dk + "/" + cid);
      } else if (isLoad(cid)) {
        unboundLoads += 1;
      }
    }
  }

  for (const [name, hits] of nameMap) {
    if (hits.length > 1) {
      issues.push(
        issue("warn", "dup_name", "Одинаковое имя на " + hits.length + " каналах: «" + name + "»", {
          hits,
        }),
      );
    }
  }

  const unboundKeys = keyPlan.filter((k) => !k.deviceTopicKey).length;
  if (unboundKeys) {
    issues.push(
      issue("warn", "key_plan_open", "В плане клавиш без привязки: " + unboundKeys, {
        count: unboundKeys,
      }),
    );
  }
  const unboundLines = linePlan.filter((k) => !k.deviceTopicKey).length;
  if (unboundLines) {
    issues.push(
      issue("warn", "line_plan_open", "В плане линий без привязки: " + unboundLines, {
        count: unboundLines,
      }),
    );
  }

  const trigUsed = new Map();
  for (const sol of solutions) {
    const t = sol?.trigger;
    if (!t?.deviceTopicKey || !t?.controlId) {
      if (sol?.solutionId && !/^cron_|outdoor_|anti_ice/i.test(String(sol.solutionId))) {
        issues.push(
          issue("warn", "sol_no_trig", "Типовая без кнопки: «" + (sol.title || sol.solutionId) + "»"),
        );
      }
      continue;
    }
    const base =
      deskInputBaseControl(t.controlId) ||
      String(t.controlId || "").replace(/\s+(?:Single|Short|Long|Shortlong|Double) Press Counter$/i, "").trim();
    const k = contactKey(t.deviceTopicKey, base);
    if (!trigUsed.has(k)) trigUsed.set(k, []);
    trigUsed.get(k).push(sol.title || sol.solutionId || sol.id);
    const hit = byContact.get(k) || byContact.get(contactKey(t.deviceTopicKey, t.controlId));
    if (!hit || !hit.name) {
      issues.push(
        issue(
          "bad",
          "trig_unnamed",
          "Типовая «" + (sol.title || sol.solutionId) + "» на неподписанном входе "
            + t.deviceTopicKey + "/" + base,
        ),
      );
    }
    const targets = Array.isArray(sol.targets) ? sol.targets : [];
    if (!targets.length) {
      issues.push(
        issue("bad", "sol_no_load", "Типовая «" + (sol.title || sol.solutionId) + "» без линий"),
      );
    }
  }

  const busy = findContinuousOutputClash(solutions);
  if (busy) {
    issues.push(
      issue(
        "bad",
        "output_busy",
        "Два постоянных правила на " + busy.deviceTopicKey + "/" + busy.controlId + ". Заливка их не запишет.",
      ),
    );
  }
  const schedule = findScheduleOutputClash(solutions);
  if (schedule) {
    issues.push(
      issue(
        "bad",
        "output_schedule",
        "Расписание и постоянное правило на " +
          schedule.deviceTopicKey +
          "/" +
          schedule.controlId +
          ". Заливка их не запишет.",
      ),
    );
  }

  for (const [k, titles] of trigUsed) {
    if (titles.length > 1) {
      issues.push(
        issue(
          "warn",
          "trig_multi",
          "Один вход → несколько типовых: " + titles.join(", "),
          { contact: k },
        ),
      );
    }
  }

  const summary = {
    modules: rows.length,
    named,
    unboundLoads,
    keyPlan: keyPlan.length,
    linePlan: linePlan.length,
    solutions: solutions.length,
    bad: issues.filter((i) => i.level === "bad").length,
    warn: issues.filter((i) => i.level === "warn").length,
  };
  return {
    ok: summary.bad === 0,
    issues,
    summary,
  };
}
