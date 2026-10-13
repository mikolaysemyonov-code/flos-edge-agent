/**
 * Ветка main на щите: заливка = пуш, журнал = лог. Без git(1).
 */
import fs from "node:fs";
import path from "node:path";

/** Журнал main: пуш/checkout. Больше слотов — сентябрьский эталон не выпадает при пробах. */
const MAX = 16;

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

export function filesSavedAt(files) {
  const dir = deployDir();
  let t = 0;
  for (const f of files || []) {
    const name = typeof f === "string" ? f : f.filename;
    if (!name) continue;
    try {
      const st = fs.statSync(path.join(dir, name));
      if (st.mtimeMs > t) t = st.mtimeMs;
    } catch {
      /* shard may be gone */
    }
  }
  return t ? new Date(t).toISOString() : "";
}

/** fnv1a32:f36878e3 → f36878e3 */
export function shortRevisionId(revisionId) {
  const s = String(revisionId || "").trim();
  if (!s) return "";
  const m = /^(?:fnv1a32:)?([a-f0-9]{6,})$/i.exec(s);
  if (m) return m[1].slice(0, 8).toLowerCase();
  return s.length > 14 ? s.slice(-8) : s;
}

/** 2026-10-13T14:41:00Z → 13.10 */
export function releaseDayLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => (n < 10 ? "0" : "") + n;
  return p(d.getDate()) + "." + p(d.getMonth() + 1);
}

/** f36878e3 · 13.10 — то, что видит монтажник в main. */
export function releaseLabel(revisionId, savedAt) {
  const short = shortRevisionId(revisionId);
  const day = releaseDayLabel(savedAt);
  if (short && day) return short + " · " + day;
  return short || day || String(revisionId || "");
}

export function recordRelease(manifest, opts = {}) {
  const replace = opts.replace !== false;
  const id = String(manifest?.revisionId || "").trim();
  if (!id) return readReleaseRing();
  const ring = readReleaseRing();
  const row = {
    revisionId: id,
    deployMode: manifest.deployMode || (manifest.files?.length > 1 ? "shards" : "monolith"),
    savedAt: manifest.savedAt || new Date().toISOString(),
    files: Array.isArray(manifest.files) ? manifest.files : [],
  };
  const hit = ring.find((r) => r.revisionId === id);
  if (!replace && hit) {
    const disk = Date.parse(row.savedAt) || 0;
    const had = Date.parse(hit.savedAt || "") || 0;
    if (disk && (!had || disk < had)) {
      hit.savedAt = row.savedAt;
      writeJson(releasesPath(), ring);
    }
    return ring;
  }
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
  const ring = [...readReleaseRing()].sort((a, b) => {
    if (cur) {
      if (a.revisionId === cur && b.revisionId !== cur) return -1;
      if (b.revisionId === cur && a.revisionId !== cur) return 1;
    }
    const ta = Date.parse(a.savedAt || "") || 0;
    const tb = Date.parse(b.savedAt || "") || 0;
    return tb - ta;
  });
  return ring.map((r, i) => {
    const parentId = ring[i + 1]?.revisionId || "";
    return {
      revisionId: r.revisionId,
      shortId: shortRevisionId(r.revisionId),
      dayLabel: releaseDayLabel(r.savedAt),
      label: releaseLabel(r.revisionId, r.savedAt),
      savedAt: r.savedAt || "",
      fileCount: Array.isArray(r.files) ? r.files.length : 0,
      files: (r.files || []).map((f) => f.filename).filter(Boolean),
      current: Boolean(cur) && r.revisionId === cur,
      parentId,
      parentShortId: shortRevisionId(parentId),
    };
  });
}
