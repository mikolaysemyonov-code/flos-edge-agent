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
import {
  collectFlosIdsFromReleaseRing,
  prepareCoreWithStaleHide,
} from "./runtime-desk-pour-stale.mjs";
import { mergeDeskSolutionsIntoUser, supportedDeskSolution } from "./runtime-desk-pour-user.mjs";
import { readReleaseRing } from "./runtime-desk-releases.mjs";

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

function isDriveClose(controlId) {
  return /^(Curtain|Actuator)\s+\d+\s+Close$/i.test(String(controlId || "").trim());
}

function namedLoadsFromDesk() {
  const shelves = readDeskMarking()?.shelves || {};
  const out = [];
  const seenNamePath = new Set();
  for (const [deviceTopicKey, shelf] of Object.entries(shelves)) {
    const chs = shelf?.channels || {};
    for (const [controlId, ch] of Object.entries(chs)) {
      if (!isLoadControl(controlId)) continue;
      if (isDriveClose(controlId)) continue;
      const name = typeof ch?.name === "string" ? ch.name.trim() : "";
      if (!name) continue;
      const key = liveDeskDeviceKey(deviceTopicKey);
      const pathKey = key + "/" + String(controlId).trim();
      if (seenNamePath.has(pathKey)) continue;
      seenNamePath.add(pathKey);
      out.push({ deviceTopicKey: key, controlId, name });
    }
  }
  return out;
}

function fnvRevision(parts) {
  const h = crypto.createHash("sha256").update(parts.join("\n"), "utf8").digest("hex").slice(0, 8);
  return "fnv1a32:" + h;
}

function buildCoreRepair(coreSrc, named, opts = {}) {
  const core = mergeDeskNamesIntoCore(coreSrc, named);
  if (!core.ok) return core;
  const ringIds = collectFlosIdsFromReleaseRing(readReleaseRing());
  const prepared = prepareCoreWithStaleHide(core.content, {
    beforeIds: [...(core.removedIds || [])],
    ringIds,
    extraIds: core.removedIds || [],
    persist: opts.persist === true,
  });
  return {
    ok: true,
    content: prepared.content,
    changed: core.changed || prepared.changed || prepared.content !== coreSrc,
    removedIds: core.removedIds || [],
    hiddenGhosts: prepared.ghostCount,
    activeIds: prepared.activeIds || [],
  };
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
  const named = namedLoadsFromDesk();
  const repair = /form_logic_os/.test(core)
    ? buildCoreRepair(core, named, { persist: false })
    : { changed: false, hiddenGhosts: 0 };
  // Починить всегда доступен при живом form_logic_os: MQTT-hide даже если диск «совпал».
  const canRepair = /form_logic_os/.test(core) && blocked === 0;
  const hasWork = diffs.length > 0 || supported.length > 0 || canRepair;
  if (!hasWork) reasons.push("нечего заливать");
  if (unsupported.length && !supported.length && !diffs.length && !canRepair) {
    reasons.push("дим и прочие карточки — пока из облака");
  }
  const canPour = reasons.length === 0 && blocked === 0 && /form_logic_os/.test(core) && hasWork;
  return {
    canPour,
    canRepair,
    reason: canPour
      ? !diffs.length && !supported.length
        ? "Починить FORM LOGIC OS: дубли в файле + meta/hidden в MQTT."
        : repair.changed || repair.hiddenGhosts
          ? "Готово к пушу на main (с починкой FORM LOGIC OS)."
          : "Готово к пушу на main."
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
  const core = buildCoreRepair(coreSrc, named, { persist: true });
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
    canRepair: gate.canRepair,
    reason: gate.reason,
    revisionId,
    loadOrder: shards.map((s) => s.filename),
    shards,
    emittedSolutions: user.emitted,
    namedCount: named.length,
    hiddenGhosts: core.hiddenGhosts || 0,
    removedIds: core.removedIds || [],
    activeIds: core.activeIds || [],
  };
}

/** MQTT-only починка, если диск уже «совпал», а в WB UI ещё призраки. */
export function buildDeskMqttRepairPlan() {
  const coreSrc = readShard("00_core.js");
  if (!/defineVirtualDevice\s*\(\s*["']form_logic_os["']/.test(coreSrc)) {
    return { ok: false, reason: "на диске нет form_logic_os в 00_core" };
  }
  const named = namedLoadsFromDesk();
  const core = buildCoreRepair(coreSrc, named, { persist: true });
  if (!core.ok) return { ok: false, reason: core.error || "core" };
  const shards = [];
  if (core.changed) shards.push({ filename: "00_core.js", content: core.content });
  const revisionId = shards.length
    ? fnvRevision(shards.map((s) => s.filename + "\n" + s.content))
    : "";
  return {
    ok: true,
    shards,
    revisionId,
    removedIds: core.removedIds || [],
    activeIds: core.activeIds || [],
    hiddenGhosts: core.hiddenGhosts || 0,
    changed: core.changed,
  };
}
