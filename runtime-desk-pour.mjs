/**
 * Заливка со стола: разметка + типовые → шарды → диск. Дим пока не эмитим.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildDeskPourPreview, readDeskDocument, readDeskMarking } from "./runtime-desk-marking.mjs";
import { listDeskSolutions } from "./runtime-desk-solutions.mjs";
import {
  isLoadControl,
  liveDeskDeviceKey,
  readPouredChannelMarks,
  readPouredDeskSnapshot,
} from "./runtime-desk-rules-marks.mjs";
import { mergeDeskNamesIntoCore } from "./runtime-desk-pour-core.mjs";
import { mergeDeskSolutionsIntoUser, supportedDeskSolution } from "./runtime-desk-pour-user.mjs";

function deployDir() {
  return (
    process.env.FLOS_WB_RULES_DEPLOY_DIR ||
    process.env.REACTOR_WB_RULES_DEPLOY_DIR ||
    "/etc/wb-rules"
  ).trim();
}

function readShard(name) {
  try {
    return fs.readFileSync(path.join(deployDir(), name), "utf8");
  } catch {
    return "";
  }
}

function namedLoadsFromDesk() {
  const shelves = readDeskMarking()?.shelves || {};
  const out = [];
  for (const [deviceTopicKey, shelf] of Object.entries(shelves)) {
    const chs = shelf?.channels || {};
    for (const [controlId, ch] of Object.entries(chs)) {
      if (!isLoadControl(controlId)) continue;
      const name = typeof ch?.name === "string" ? ch.name.trim() : "";
      if (!name) continue;
      out.push({ deviceTopicKey: liveDeskDeviceKey(deviceTopicKey), controlId, name });
    }
  }
  return out;
}

function fnvRevision(parts) {
  const h = crypto.createHash("sha256").update(parts.join("\n"), "utf8").digest("hex").slice(0, 8);
  return "fnv1a32:" + h;
}

export function assessDeskCanPour(preview) {
  const p = preview || buildDeskPourPreview(readDeskMarking(), readPouredChannelMarks(), readPouredDeskSnapshot().rules || []);
  const blocked = p.ready?.blocked || 0;
  const core = readShard("00_core.js");
  const reasons = [];
  if (blocked > 0) reasons.push("есть блоки без имени");
  if (!/defineVirtualDevice\s*\(\s*["']form_logic_os["']/.test(core)) {
    reasons.push("на диске нет form_logic_os в 00_core");
  }
  const sols = listDeskSolutions();
  const unsupported = sols.filter((s) => !supportedDeskSolution(s));
  const supported = sols.filter(supportedDeskSolution);
  const diffs = (p.rows || []).filter((r) => r.status === "new_name" || r.status === "name" || r.status === "card");
  const hasWork = diffs.length > 0 || supported.length > 0;
  if (!hasWork) reasons.push("нечего заливать");
  if (unsupported.length && !supported.length && !diffs.length) {
    reasons.push("дим и прочие карточки — пока из облака");
  }
  const canPour = reasons.length === 0 && blocked === 0 && /form_logic_os/.test(core) && hasWork;
  return {
    canPour,
    reason: canPour
      ? "Готово к пушу на main."
      : reasons.join(" · ") || "Превью. Диск не трогаем.",
    ready: p.ready,
    rows: p.rows,
    gaps: p.gaps,
    unsupported: unsupported.map((s) => s.solutionId),
  };
}

export function buildDeskPourPackage() {
  const gate = assessDeskCanPour();
  if (!gate.canPour) return { ok: false, ...gate, shards: [], loadOrder: [] };
  const coreSrc = readShard("00_core.js");
  const userSrc = readShard("40_rules_user.js") || readShard("40_rules_integrator.js");
  const named = namedLoadsFromDesk();
  const core = mergeDeskNamesIntoCore(coreSrc, named);
  if (!core.ok) return { ok: false, canPour: false, reason: core.error || "core", shards: [] };
  const sols = listDeskSolutions().filter(supportedDeskSolution);
  const user = mergeDeskSolutionsIntoUser(userSrc, sols);
  if (!core.changed && !user.changed) {
    return { ok: false, canPour: false, reason: "стол уже совпадает с диском", shards: [] };
  }
  const shards = [];
  if (core.changed) shards.push({ filename: "00_core.js", content: core.content });
  if (user.changed) shards.push({ filename: "40_rules_user.js", content: user.content });
  const revisionId = fnvRevision(shards.map((s) => s.filename + "\n" + s.content));
  return {
    ok: true,
    canPour: true,
    reason: gate.reason,
    revisionId,
    loadOrder: shards.map((s) => s.filename),
    shards,
    emittedSolutions: user.emitted,
    namedCount: named.length,
  };
}
