/**
 * Classify wb-rules journal lines into field incidents (edge-side mirror of SaaS KB).
 * No firehose — only matched patterns.
 */

/** @typedef {{ ruleId: string, severity: "error"|"warning", reason: string, actionStep: string, sampleLogLine: string }} JournalIncident */

const RULES = [
  {
    id: "reactor-rule-error",
    pattern: /\[REACTOR_RULE_ERROR\]/i,
    severity: /** @type {"error"} */ ("error"),
    reason: "Сценарий упал при выполнении — в логе есть трасса ошибки.",
    actionStep: "Откройте «Ошибки на контроллере», сверьте правило и перезалейте пакет.",
  },
  {
    id: "reactor-virtual-bus-collision",
    pattern: /\[REACTOR_VIRTUAL_BUS_COLLISION\]/i,
    severity: /** @type {"warning"} */ ("warning"),
    reason: "Два правила пишут в один выход (virtual bus collision).",
    actionStep: "Разведите приоритеты или актуаторы на один канал.",
  },
  {
    id: "modbus-timeout",
    pattern:
      /(?:modbus|485|rs-?485).{0,80}?(?:timeout|timed?\s*out|no\s*response|не\s*ответ|таймаут)|(?:timeout|timed?\s*out).{0,40}?(?:modbus|485|slave)/i,
    severity: /** @type {"error"} */ ("error"),
    reason: "Нет ответа от модуля на шине связи.",
    actionStep: "Проверьте A/B, питание 24 В и системный номер модуля.",
  },
  {
    id: "modbus-crc",
    pattern: /(?:crc|checksum).*(?:error|fail|bad)|(?:bad|invalid)\s*(?:crc|frame)|ошибк[аи]\s*crc/i,
    severity: /** @type {"warning"} */ ("warning"),
    reason: "Помехи на шине: кадр доходит битым.",
    actionStep: "Отведите шину от силовых, проверьте экран и GND.",
  },
  {
    id: "script-syntax",
    pattern: /SyntaxError:\s*/i,
    severity: /** @type {"error"} */ ("error"),
    reason: "Синтаксическая ошибка в сценарии — пакет мог не загрузиться.",
    actionStep: "Исправьте правило и снова залейте.",
  },
  {
    id: "script-reference",
    pattern: /ReferenceError:\s*\S+\s+is not defined|is not defined/i,
    severity: /** @type {"error"} */ ("error"),
    reason: "В сценарии обращение к несуществующему имени.",
    actionStep: "Найдите строку в логе, исправьте имя, перезалейте.",
  },
  {
    id: "mqtt-publish-error",
    pattern: /mqtt.*(?:publish|error|fail)|wb-rules.*(?:error|fail)/i,
    severity: /** @type {"warning"} */ ("warning"),
    reason: "Сбой отправки команды / ошибка wb-rules.",
    actionStep: "Проверьте связь и разметку канала, повторите заливку.",
  },
];

/**
 * @param {readonly string[]} lines
 * @returns {JournalIncident[]}
 */
export function classifyWbRulesJournalLines(lines) {
  /** @type {JournalIncident[]} */
  const out = [];
  const seen = new Set();
  for (const raw of lines) {
    const line = String(raw ?? "").trim();
    if (!line) continue;
    for (const rule of RULES) {
      if (!rule.pattern.test(line)) continue;
      const key = `${rule.id}|${line.slice(0, 120)}`;
      if (seen.has(key)) break;
      seen.add(key);
      out.push({
        ruleId: rule.id,
        severity: rule.severity,
        reason: rule.reason,
        actionStep: rule.actionStep,
        sampleLogLine: line.slice(0, 2000),
      });
      break;
    }
  }
  return out;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function splitJournalText(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}
