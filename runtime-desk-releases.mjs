/**
 * Ветка main на щите: заливка = пуш, журнал = лог. Без git(1).
 */
import fs from "node:fs";
import path from "node:path";

const MAX = 8;

function deployDir() {
  return (
    process.env.FLOS_WB_RULES_DEPLOY_DIR ||
    process.env.REACTOR_WB_RULES_DEPLOY_DIR ||
    "/etc/wb-rules"
  ).trim();
}

function backupDir() {
  return path.join(deployDir(), ".integrator-backup");
}

export function releasesPath() {
  return path.join(backupDir(), "releases.json");
}

function lastManifestPath() {
  return path.join(backupDir(), "last-manifest.json");
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value), "utf8");
  fs.renameSync(tmp, file);
}

export function readReleaseRing() {
  const raw = readJson(releasesPath());
  return Array.isArray(raw) ? raw.filter((r) => r && r.revisionId) : [];
}

export function recordRelease(manifest, opts = {}) {
  const replace = opts.replace !== false;
  const id = String(manifest?.revisionId || "").trim();
  if (!id) return readReleaseRing();
  const ring = readReleaseRing();
  if (!replace && ring.some((r) => r.revisionId === id)) return ring;
  const row = {
    revisionId: id,
    deployMode: manifest.deployMode || (manifest.files?.length > 1 ? "shards" : "monolith"),
    savedAt: manifest.savedAt || new Date().toISOString(),
    files: Array.isArray(manifest.files) ? manifest.files : [],
  };
  const next = [row, ...ring.filter((r) => r.revisionId !== id)].slice(0, MAX);
  writeJson(releasesPath(), next);
  return next;
}

export function readRelease(revisionId) {
  const id = String(revisionId || "").trim();
  if (!id) return null;
  return readReleaseRing().find((r) => r.revisionId === id) || null;
}

export function importLastManifest() {
  const last = readJson(lastManifestPath());
  if (!last?.revisionId || !Array.isArray(last.files) || !last.files.length) return;
  recordRelease(last, { replace: false });
}

export function listReleaseSummaries(currentId) {
  importLastManifest();
  const cur = String(currentId || "").trim();
  return readReleaseRing().map((r, i, ring) => ({
    revisionId: r.revisionId,
    savedAt: r.savedAt || "",
    fileCount: Array.isArray(r.files) ? r.files.length : 0,
    files: (r.files || []).map((f) => f.filename).filter(Boolean),
    current: Boolean(cur) && r.revisionId === cur,
    parentId: ring[i + 1]?.revisionId || "",
  }));
}
