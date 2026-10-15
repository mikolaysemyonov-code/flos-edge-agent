/**
 * Диагностика стола перед заливкой: дыры в разметке, плане, типовых.
 * Без MQTT — чистая функция по снимку полок + планам.
 */

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
      if (/Short Press Counter$/i.test(cid)) continue;
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
    const base = String(t.controlId).replace(/\s+Short Press Counter$/i, "").trim();
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
