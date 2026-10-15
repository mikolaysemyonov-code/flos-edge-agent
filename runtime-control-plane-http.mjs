/**
 * Stage B: HTTP control-plane на edge (Wiren Board / gateway).
 * GET /runtime/health · POST /runtime/apply · POST /runtime/verify
 */

import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildRulesInventory } from "./runtime-rules-inventory.mjs";
import {
  filesSavedAt,
  listReleaseSummaries,
  readRelease,
  readReleaseRing,
  recordRelease,
} from "./runtime-desk-releases.mjs";
import {
  collectFlosIdsFromReleaseRing,
  extractFormLogicOsCellIds,
  prepareCoreWithStaleHide,
  staleGhostIds,
} from "./runtime-desk-pour-stale.mjs";
import { hideFormLogicOsGhostsNow } from "./runtime-desk-pour-mqtt.mjs";
import {
  buildDeskPourPackage,
  assessDeskCanPour,
  handleRuntimeDeskActuate,
  handleRuntimeDeskKeyPlan,
  handleRuntimeDeskMarking,
  handleRuntimeDeskPourPreview,
  handleRuntimeDeskPoured,
  handleRuntimeDeskSolutions,
  handleRuntimeFieldCert,
  handleRuntimeMqttScan,
  serveCommissionDesk,
  serveCommissionDeskFile,
} from "./runtime-desk-http.mjs";

const MAX_SCRIPT_BYTES = 512_000;
const MAX_SHARD_BODY_BYTES = 2_500_000;
const SHARD_FILENAME_RE = /^[\w.-]+\.js$/;

function env(primary, legacy) {
  const v = process.env[primary];
  if (v != null && String(v).length > 0) return v;
  return legacy ? process.env[legacy] : undefined;
}

function jsonWrite(res, status, obj) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("BODY_TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("INVALID_JSON"));
      }
    });
    req.on("error", reject);
  });
}

function runtimeAuthToken() {
  return (env("FLOS_RUNTIME_HTTP_AUTH_TOKEN", "REACTOR_RUNTIME_HTTP_AUTH_TOKEN") ?? "").trim();
}

function authorizeRuntimeRequest(req) {
  const expected = runtimeAuthToken();
  if (!expected) return true;
  const header = req.headers.authorization ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m != null && m[1] === expected;
}

function wbRulesDeployPath() {
  return (
    env("FLOS_WB_RULES_DEPLOY_PATH", "REACTOR_WB_RULES_DEPLOY_PATH") ?? "/etc/wb-rules/40_rules_integrator.js"
  ).trim();
}

export function wbRulesDeployDir() {
  const explicit = env("FLOS_WB_RULES_DEPLOY_DIR", "REACTOR_WB_RULES_DEPLOY_DIR");
  if (explicit?.trim()) return explicit.trim();
  return path.dirname(wbRulesDeployPath());
}

function releaseHashPath() {
  const primary =
    env("FLOS_WB_RULES_RELEASE_HASH_PATH", "REACTOR_WB_RULES_RELEASE_HASH_PATH") ??
    env("FORMLOGIC_RELEASE_HASH_PATH", null);
  return (primary ?? "/etc/formlogic/current_release.hash").trim();
}

/** Incl. DI runtime 15_* — иначе stale shard остаётся после apply. */
const INTEGRATOR_SHARD_RE = /^(00_|01_|10_|15_|20_|30_|40_rules).*\.js$/;

function backupManifestPath() {
  return path.join(wbRulesDeployDir(), ".integrator-backup", "last-manifest.json");
}

function listIntegratorRuleFiles() {
  const deployDir = wbRulesDeployDir();
  const monolithBase = path.basename(wbRulesDeployPath());
  const files = [];
  try {
    for (const name of fs.readdirSync(deployDir)) {
      if (name === ".integrator-backup") continue;
      const full = path.join(deployDir, name);
      if (!fs.statSync(full).isFile()) continue;
      if (INTEGRATOR_SHARD_RE.test(name) || name === monolithBase) {
        files.push({ filename: name, content: fs.readFileSync(full, "utf8") });
      }
    }
  } catch {
    /* deploy dir may not exist */
  }
  return files;
}

export function loadBackupManifest() {
  try {
    const raw = fs.readFileSync(backupManifestPath(), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveBackupManifest(manifest) {
  const target = backupManifestPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(manifest), "utf8");
  fs.renameSync(tmp, target);
}

export function backupCurrentStateBeforeApply() {
  const revisionId = readAppliedRevisionId();
  const files = listIntegratorRuleFiles();
  if (files.length === 0 && !revisionId) return;
  const manifest = {
    revisionId: revisionId ?? "unknown",
    deployMode: files.length > 1 ? "shards" : "monolith",
    savedAt: new Date().toISOString(),
    files,
  };
  saveBackupManifest(manifest);
  recordRelease(manifest);
}

export async function rollbackToPreviousBackup() {
  const manifest = loadBackupManifest();
  if (!manifest?.files?.length) throw new Error("No backup available for rollback");
  const deployDir = wbRulesDeployDir();
  const beforeCore = listIntegratorRuleFiles().find((f) => f.filename === "00_core.js")?.content || "";
  const beforeIds = extractFormLogicOsCellIds(beforeCore);
  const ringIds = collectFlosIdsFromReleaseRing(readReleaseRing());
  const keep = [];
  let hiddenGhosts = 0;
  let extraGhosts = [];
  for (const file of manifest.files) {
    validateShardFilename(file.filename);
    let content = file.content;
    if (file.filename === "00_core.js") {
      const prepared = prepareCoreWithStaleHide(content, {
        beforeIds,
        ringIds,
        persist: true,
      });
      content = prepared.content;
      hiddenGhosts = prepared.ghostCount;
      extraGhosts = staleGhostIds(
        [...beforeIds, ...ringIds, ...collectFlosIdsFromReleaseRing(readReleaseRing())],
        prepared.activeIds || extractFormLogicOsCellIds(content),
      );
    }
    atomicWriteFile(path.join(deployDir, file.filename), content);
    keep.push(file.filename);
  }
  removeStaleIntegratorShards(deployDir, keep);
  const monolithPath = wbRulesDeployPath();
  const monolithBase = path.basename(monolithPath);
  if (!keep.includes(monolithBase)) {
    try {
      fs.unlinkSync(monolithPath);
    } catch {
      /* legacy monolith may be absent */
    }
  }
  const revisionId = typeof manifest.revisionId === "string" ? manifest.revisionId : "unknown";
  writeReleaseHash(revisionId);
  const restarted = restartWbRules();
  const coreAfter =
    keep.includes("00_core.js")
      ? listIntegratorRuleFiles().find((f) => f.filename === "00_core.js")?.content || ""
      : "";
  const activeIds = extractFormLogicOsCellIds(coreAfter);
  let mqttHide = { ok: false, published: 0, ghosts: hiddenGhosts, liveCount: 0 };
  try {
    mqttHide = await hideFormLogicOsGhostsNow(activeIds, extraGhosts);
    hiddenGhosts = Math.max(hiddenGhosts, mqttHide.ghosts || 0);
  } catch (err) {
    console.warn("[runtime-control-plane] mqtt hide after rollback:", err?.message ?? err);
  }
  return {
    appliedRevisionId: revisionId,
    ackCount: manifest.files.length,
    deployMode: manifest.deployMode ?? "monolith",
    restarted: restarted != null,
    hiddenGhosts,
    mqttPublished: mqttHide.published || 0,
    mqttLive: mqttHide.liveCount || 0,
  };
}

function removeStaleIntegratorShards(deployDir, keepFilenames) {
  let removed = 0;
  try {
    for (const name of fs.readdirSync(deployDir)) {
      if (!INTEGRATOR_SHARD_RE.test(name)) continue;
      if (keepFilenames.includes(name)) continue;
      try {
        fs.unlinkSync(path.join(deployDir, name));
        removed += 1;
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* deploy dir may not exist yet */
  }
  return removed;
}

function readAppliedRevisionId() {
  try {
    const raw = fs.readFileSync(releaseHashPath(), "utf8").trim();
    return raw ? raw.split("\n")[0] : null;
  } catch {
    return null;
  }
}

function writeReleaseHash(revisionId) {
  try {
    fs.mkdirSync(path.dirname(releaseHashPath()), { recursive: true });
    fs.writeFileSync(releaseHashPath(), `${revisionId}\n`, "utf8");
  } catch (hashErr) {
    console.warn("[runtime-control-plane] release hash write failed:", hashErr?.message ?? hashErr);
  }
}

export function restartWbRules() {
  // pid:host + privileged: systemctl на host; иначе nsenter в PID 1 (Wiren Board).
  const cmds = [
    "nsenter --target 1 --mount --uts --ipc --net --pid -- systemctl restart wb-rules",
    "systemctl restart wb-rules",
    "systemctl restart wb-rules@default",
    "service wb-rules restart",
  ];
  for (const cmd of cmds) {
    try {
      execSync(cmd, { stdio: "ignore", timeout: 15_000 });
      return cmd;
    } catch {
      /* try next */
    }
  }
  return null;
}

function atomicWriteFile(target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, { encoding: "utf8", mode: 0o644 });
  fs.renameSync(tmp, target);
}

function validateShardFilename(filename) {
  if (!SHARD_FILENAME_RE.test(filename)) {
    throw new Error(`Invalid shard filename: ${filename}`);
  }
}

export function applyMonolithScript(script, revisionId) {
  const target = wbRulesDeployPath();
  atomicWriteFile(target, script);
  writeReleaseHash(revisionId);
  const restarted = restartWbRules();
  return { deployPath: target, ackCount: 1, deployMode: "monolith", restarted: restarted != null };
}

export function applyShardBundle(shards, loadOrder, revisionId, options = {}) {
  const preserveOtherShards = options?.preserveOtherShards === true;
  const deployDir = wbRulesDeployDir();
  const byName = new Map(shards.map((s) => [s.filename, s.content]));
  const order =
    Array.isArray(loadOrder) && loadOrder.length > 0 ? loadOrder : shards.map((s) => s.filename);
  let ackCount = 0;
  for (const filename of order) {
    const content = byName.get(filename);
    if (content == null) continue;
    validateShardFilename(filename);
    if (Buffer.byteLength(content, "utf8") > MAX_SCRIPT_BYTES) {
      throw new Error(`Shard ${filename} exceeds size limit`);
    }
    atomicWriteFile(path.join(deployDir, filename), content);
    ackCount += 1;
  }
  if (ackCount === 0) throw new Error("No shards written");

  if (!preserveOtherShards) {
    removeStaleIntegratorShards(deployDir, order);
  }

  const monolithPath = wbRulesDeployPath();
  const monolithBase = path.basename(monolithPath);
  if (!order.includes(monolithBase)) {
    try {
      fs.unlinkSync(monolithPath);
    } catch {
      /* legacy monolith may be absent */
    }
  }

  writeReleaseHash(revisionId);
  const restarted = restartWbRules();
  return { deployDir, ackCount, deployMode: "shards", restarted: restarted != null };
}

/** Heartbeat snapshot: ids on disk, no bodies. */
export function snapshotRulesInventory() {
  return buildRulesInventory(listIntegratorRuleFiles(), readAppliedRevisionId());
}

export function handleRuntimeHealth(_req, res) {
  const manifest = loadBackupManifest();
  const extra = typeof runtimeHealthExtraProvider === "function" ? runtimeHealthExtraProvider() : {};
  const appliedRevisionId = readAppliedRevisionId();
  jsonWrite(res, 200, {
    ok: true,
    service: "integrator-runtime-control-plane",
    wbRulesDeployPath: wbRulesDeployPath(),
    wbRulesDeployDir: wbRulesDeployDir(),
    appliedRevisionId,
    canRollback: Boolean(manifest?.files?.length),
    previousRevisionId: manifest?.revisionId ?? null,
    supportsRulesExport: true,
    ...(extra && typeof extra === "object" ? extra : {}),
    rulesInventory: buildRulesInventory(listIntegratorRuleFiles(), appliedRevisionId),
  });
}

/** Пруф диска: revision + sha шардов. Не ack apply и не LAN health. */
export function verifyIntegratorRulesOnDisk(expectedRevisionId) {
  const expected =
    typeof expectedRevisionId === "string" ? expectedRevisionId.trim() : "";
  const appliedRevisionId = readAppliedRevisionId();
  const files = listIntegratorRuleFiles().map((f) => ({
    filename: f.filename,
    bytes: Buffer.byteLength(f.content, "utf8"),
    sha256: crypto.createHash("sha256").update(f.content, "utf8").digest("hex"),
  }));
  const revisionMatch = Boolean(expected && appliedRevisionId && appliedRevisionId === expected);
  return {
    expectedRevisionId: expected || null,
    appliedRevisionId,
    releaseHashValue: appliedRevisionId,
    revisionMatch,
    files,
    source: "disk",
  };
}

/** Тела 40_user* — HTTP export и команда агента wb_rules_export. */
export function exportIntegratorUserRuleFiles() {
  const appliedRevisionId = readAppliedRevisionId();
  const files = listIntegratorRuleFiles().filter((f) => /^40_rules.*\.js$/i.test(f.filename));
  return {
    revisionId: appliedRevisionId,
    files: files.map((f) => ({
      filename: f.filename,
      content: f.content,
      bytes: Buffer.byteLength(f.content, "utf8"),
    })),
  };
}

/** POST /runtime/verify — пруф revision+sha с диска (LAN). */
export async function handleRuntimeVerify(req, res) {
  if (!authorizeRuntimeRequest(req)) {
    jsonWrite(res, 401, { ok: false, error: "AUTH: invalid or missing bearer token" });
    return;
  }
  let body = {};
  try {
    body = await readJsonBody(req, 8_192);
  } catch {
    jsonWrite(res, 400, { ok: false, error: "Invalid JSON body" });
    return;
  }
  const expected =
    typeof body.expectedRevisionId === "string" ? body.expectedRevisionId.trim() : "";
  if (!expected) {
    jsonWrite(res, 400, { ok: false, error: "Missing expectedRevisionId" });
    return;
  }
  const proof = verifyIntegratorRulesOnDisk(expected);
  jsonWrite(res, 200, { ok: proof.revisionMatch && proof.files.length > 0, ...proof });
}

/** GET /runtime/rules-export — тела 40_user* для «Сверить с щитом» (preserve orphans). */
export function handleRuntimeRulesExport(_req, res) {
  if (!authorizeRuntimeRequest(_req)) {
    jsonWrite(res, 401, { ok: false, error: "AUTH: invalid or missing bearer token" });
    return;
  }
  jsonWrite(res, 200, { ok: true, ...exportIntegratorUserRuleFiles() });
}

/** Optional enricher for GET /runtime/health (enrollment state from reactor-edge-agent). */
let runtimeHealthExtraProvider = null;
export function setRuntimeHealthExtraProvider(fn) {
  runtimeHealthExtraProvider = typeof fn === "function" ? fn : null;
}

export async function handleRuntimeApply(req, res) {
  if (!authorizeRuntimeRequest(req)) {
    jsonWrite(res, 401, { status: "blocked", reasons: ["AUTH: invalid or missing bearer token"] });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req, MAX_SHARD_BODY_BYTES);
  } catch (err) {
    const code = err instanceof Error ? err.message : "BAD_REQUEST";
    if (code === "BODY_TOO_LARGE") {
      jsonWrite(res, 413, { status: "blocked", reasons: ["Payload too large"] });
      return;
    }
    jsonWrite(res, 400, { status: "blocked", reasons: ["Invalid JSON body"] });
    return;
  }

  const revisionId = typeof body.revisionId === "string" ? body.revisionId.trim() : "";
  const script = typeof body.script === "string" ? body.script : "";
  const shards = Array.isArray(body.shards) ? body.shards : [];
  const loadOrder = Array.isArray(body.loadOrder) ? body.loadOrder : [];
  const preserveOtherShards = body.preserveOtherShards === true;

  if (!revisionId) {
    jsonWrite(res, 400, { status: "blocked", reasons: ["Missing revisionId"] });
    return;
  }

  const useShards = shards.length > 0 || body.deployMode === "shards";
  if (!useShards && !script.trim()) {
    jsonWrite(res, 400, { status: "blocked", reasons: ["Missing script or shards"] });
    return;
  }
  if (!useShards && Buffer.byteLength(script, "utf8") > MAX_SCRIPT_BYTES) {
    jsonWrite(res, 413, { status: "blocked", reasons: ["Script exceeds size limit"] });
    return;
  }

  try {
    backupCurrentStateBeforeApply();
    const result = useShards
      ? applyShardBundle(shards, loadOrder, revisionId, { preserveOtherShards })
      : applyMonolithScript(script, revisionId);
    console.log(
      `[runtime-control-plane] applied revision=${revisionId} mode=${result.deployMode} acks=${result.ackCount}`,
    );
    jsonWrite(res, 200, {
      status: "applied",
      appliedRevisionId: revisionId,
      ackCount: result.ackCount,
      deployMode: result.deployMode,
      deployPath: result.deployPath ?? null,
      deployDir: result.deployDir ?? null,
      restarted: result.restarted,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "deploy failed";
    console.error("[runtime-control-plane] apply failed:", message);
    jsonWrite(res, 500, { status: "blocked", reasons: [`DEPLOY: ${message}`] });
  }
}

export function handleRuntimeReleases(_req, res) {
  const files = listIntegratorRuleFiles();
  const revisionId = readAppliedRevisionId();
  if (revisionId && files.length) {
    recordRelease(
      {
        revisionId,
        deployMode: files.length > 1 ? "shards" : "monolith",
        savedAt: filesSavedAt(files),
        files,
      },
      { replace: false },
    );
  }
  const pushes = listReleaseSummaries(revisionId);
  const gate = assessDeskCanPour();
  jsonWrite(res, 200, {
    ok: true,
    canPour: gate.canPour === true,
    canPourNames: gate.canPourNames === true,
    canPourRules: gate.canPourRules === true,
    canRepair: gate.canRepair === true,
    reason: gate.reason || "",
    branch: "main",
    head: revisionId || "",
    currentId: revisionId || "",
    pushes: pushes,
    releases: pushes,
  });
}

export async function handleRuntimeDeskPour(req, res) {
  const { buildDeskMqttRepairPlan, normalizePourScope } = await import("./runtime-desk-pour.mjs");
  let scope = "all";
  try {
    const url = new URL(req.url || "/runtime/desk-pour", "http://local");
    if (url.searchParams.get("scope")) scope = normalizePourScope(url.searchParams.get("scope"));
    else {
      const body = await readJsonBody(req, 4096).catch(() => ({}));
      if (body && body.scope) scope = normalizePourScope(body.scope);
    }
  } catch {
    scope = "all";
  }
  let pkg = buildDeskPourPackage(scope);
  let usedMqttOnly = false;
  // MQTT-hide только для names/all — иначе «Залить сценарии» не должно чинить ядро взамен.
  if ((!pkg.ok || !pkg.canPour || !pkg.shards?.length) && scope !== "rules") {
    const plan = buildDeskMqttRepairPlan();
    if (!plan.ok) {
      jsonWrite(res, 400, {
        ok: false,
        canPour: false,
        scope,
        error: pkg.reason || plan.reason || "blocked",
        reason: pkg.reason || plan.reason,
      });
      return;
    }
    pkg = {
      ...pkg,
      ok: true,
      canPour: true,
      scope,
      shards: plan.shards,
      loadOrder: plan.shards.map((s) => s.filename),
      revisionId: plan.revisionId || `mqtt-hide:${Date.now().toString(36)}`,
      removedIds: plan.removedIds,
      activeIds: plan.activeIds,
      hiddenGhosts: plan.hiddenGhosts,
      namedCount: 0,
      emittedSolutions: 0,
    };
    usedMqttOnly = !plan.shards.length;
  } else if (!pkg.ok || !pkg.canPour || !pkg.shards?.length) {
    jsonWrite(res, 400, {
      ok: false,
      canPour: false,
      scope,
      error: pkg.reason || "blocked",
      reason: pkg.reason,
    });
    return;
  }
  try {
    let result = {
      ackCount: 0,
      deployMode: "shards",
      restarted: false,
    };
    if (pkg.shards?.length) {
      backupCurrentStateBeforeApply();
      result = applyShardBundle(pkg.shards, pkg.loadOrder, pkg.revisionId, {
        preserveOtherShards: true,
      });
      recordRelease({
        revisionId: pkg.revisionId,
        deployMode: result.deployMode,
        savedAt: new Date().toISOString(),
        files: listIntegratorRuleFiles(),
      });
    }
    const coreNow =
      pkg.shards?.find((s) => s.filename === "00_core.js")?.content ||
      listIntegratorRuleFiles().find((f) => f.filename === "00_core.js")?.content ||
      "";
    const activeIds = pkg.activeIds?.length ? pkg.activeIds : extractFormLogicOsCellIds(coreNow);
    const mqttHide = await hideFormLogicOsGhostsNow(activeIds, pkg.removedIds || []);
    console.log(
      `[runtime-control-plane] desk-pour revision=${pkg.revisionId} acks=${result.ackCount} mqtt=${mqttHide.published} ghosts=${mqttHide.ghosts}`,
    );
    jsonWrite(res, 200, {
      ok: true,
      status: "applied",
      scope: pkg.scope || scope,
      appliedRevisionId: pkg.revisionId,
      ackCount: result.ackCount,
      deployMode: result.deployMode,
      restarted: result.restarted,
      emittedSolutions: pkg.emittedSolutions,
      namedCount: pkg.namedCount,
      hiddenGhosts: Math.max(pkg.hiddenGhosts || 0, mqttHide.ghosts || 0),
      mqttPublished: mqttHide.published || 0,
      mqttLive: mqttHide.liveCount || 0,
      mqttOnly: usedMqttOnly,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "deploy failed";
    console.error("[runtime-control-plane] desk-pour failed:", message);
    jsonWrite(res, 500, { ok: false, error: message });
  }
}

export async function handleRuntimeRollback(req, res) {
  if (!authorizeRuntimeRequest(req)) {
    jsonWrite(res, 401, { status: "blocked", reasons: ["AUTH: invalid or missing bearer token"] });
    return;
  }
  try {
    const url = new URL(req.url || "/runtime/rollback", "http://local");
    const want = (url.searchParams.get("revisionId") || "").trim();
    if (want) {
      const hit = readRelease(want);
      if (!hit?.files?.length) throw new Error("No snapshot for that revision");
      saveBackupManifest(hit);
    }
    const result = await rollbackToPreviousBackup();
    console.log(
      `[runtime-control-plane] rollback revision=${result.appliedRevisionId} mode=${result.deployMode} mqtt=${result.mqttPublished || 0}`,
    );
    jsonWrite(res, 200, {
      status: "applied",
      appliedRevisionId: result.appliedRevisionId,
      ackCount: result.ackCount,
      deployMode: result.deployMode,
      restarted: result.restarted,
      rolledBack: true,
      hiddenGhosts: result.hiddenGhosts || 0,
      mqttPublished: result.mqttPublished || 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "rollback failed";
    console.error("[runtime-control-plane] rollback failed:", message);
    jsonWrite(res, 409, { status: "blocked", reasons: [`ROLLBACK: ${message}`] });
  }
}

export function runtimeHttpPathHandler(req, res) {
  const method = (req.method ?? "GET").toUpperCase();
  const urlPath = (req.url ?? "/").split("?")[0];
  if (method === "GET" && (urlPath === "/" || urlPath === "/desk")) {
    return serveCommissionDesk(req, res);
  }
  if (method === "GET" && serveCommissionDeskFile(urlPath, res)) {
    return true;
  }
  if (method === "GET" && urlPath === "/runtime/desk-poured") {
    handleRuntimeDeskPoured(req, res);
    return true;
  }
  if (method === "GET" && urlPath === "/runtime/field-cert") {
    const extra = typeof runtimeHealthExtraProvider === "function" ? runtimeHealthExtraProvider() : {};
    const mirror = extra.mqttMirror || {};
    const topics = Number(mirror.topicCount) || 0;
    const cloudState = extra.enrollment && extra.enrollment.state;
    handleRuntimeFieldCert(req, res, {
      agentVersion: extra.agentVersion,
      topics,
      busOk: mirror.connected === true && topics > 0,
      cloudOk: /^(restored|online|enrolled_awaiting_heartbeat)$/.test(String(cloudState || "")),
    });
    return true;
  }
  if (method === "GET" && urlPath === "/runtime/releases") {
    handleRuntimeReleases(req, res);
    return true;
  }
  if (method === "GET" && urlPath === "/runtime/desk-pour-preview") {
    handleRuntimeDeskPourPreview(req, res);
    return true;
  }
  if (method === "POST" && urlPath === "/runtime/desk-pour") {
    void handleRuntimeDeskPour(req, res).catch((err) => {
      console.error("[runtime-control-plane] desk-pour:", err?.message ?? err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: false, error: "INTERNAL" }));
      }
    });
    return true;
  }
  if ((method === "GET" || method === "PUT" || method === "POST" || method === "DELETE") && urlPath === "/runtime/desk-solutions") {
    void handleRuntimeDeskSolutions(req, res).catch((err) => {
      console.error("[runtime-control-plane] desk-solutions:", err?.message ?? err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: false, error: "INTERNAL" }));
      }
    });
    return true;
  }
  if ((method === "GET" || method === "PUT" || method === "POST" || method === "DELETE") && urlPath === "/runtime/desk-key-plan") {
    void handleRuntimeDeskKeyPlan(req, res).catch((err) => {
      console.error("[runtime-control-plane] desk-key-plan:", err?.message ?? err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: false, error: "INTERNAL" }));
      }
    });
    return true;
  }
  if ((method === "GET" || method === "PUT" || method === "POST") && urlPath === "/runtime/desk-marking") {
    void handleRuntimeDeskMarking(req, res).catch((err) => {
      console.error("[runtime-control-plane] desk-marking:", err?.message ?? err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: false, error: "INTERNAL" }));
      }
    });
    return true;
  }
  if ((method === "GET" || method === "POST") && urlPath === "/runtime/desk-actuate") {
    void handleRuntimeDeskActuate(req, res).catch((err) => {
      console.error("[runtime-control-plane] desk-actuate:", err?.message ?? err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: false, error: "INTERNAL" }));
      }
    });
    return true;
  }
  if ((method === "POST" || method === "GET") && urlPath === "/runtime/mqtt-scan") {
    void handleRuntimeMqttScan(req, res).catch((err) => {
      console.error("[runtime-control-plane] mqtt-scan:", err?.message ?? err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: false, error: "INTERNAL" }));
      }
    });
    return true;
  }
  if (method === "GET" && (urlPath === "/runtime/health" || urlPath === "/health")) {
    handleRuntimeHealth(req, res);
    return true;
  }
  if (method === "GET" && urlPath === "/runtime/rules-export") {
    handleRuntimeRulesExport(req, res);
    return true;
  }
  if (method === "POST" && urlPath === "/runtime/verify") {
    void handleRuntimeVerify(req, res).catch((err) => {
      console.error("[runtime-control-plane] verify unhandled:", err?.message ?? err);
      if (!res.headersSent) jsonWrite(res, 500, { ok: false, error: "INTERNAL" });
    });
    return true;
  }
  if (method === "POST" && urlPath === "/runtime/apply") {
    void handleRuntimeApply(req, res).catch((err) => {
      console.error("[runtime-control-plane] unhandled:", err?.message ?? err);
      if (!res.headersSent) jsonWrite(res, 500, { status: "blocked", reasons: ["INTERNAL"] });
    });
    return true;
  }
  if (method === "POST" && urlPath === "/runtime/rollback") {
    void handleRuntimeRollback(req, res).catch((err) => {
      console.error("[runtime-control-plane] rollback unhandled:", err?.message ?? err);
      if (!res.headersSent) jsonWrite(res, 500, { status: "blocked", reasons: ["INTERNAL"] });
    });
    return true;
  }
  return false;
}
