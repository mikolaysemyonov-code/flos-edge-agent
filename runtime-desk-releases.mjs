/**
 * Ветка main на щите: заливка = пуш, журнал = лог. Без git(1).
 */
import fs from "node:fs";
import path from "node:path";

/** Журнал main: пуш/checkout. Больше слотов — старый эталон не выпадает при пробах. */
const MAX = 16;

/**
 * Известные first-seen (UTC), если backup/checkout уже затёрли savedAt.
 * Vesennaya: e7c3b1f7 был 23.09 20:12 MSK.
 */
const PINNED_FIRST_SAVED = {
  "fnv1a32:e7c3b1f7": "2026-09-23T17:12:00.000Z",
};

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

function earlierIso(a, b) {
  const ta = Date.parse(a || "") || 0;
  const tb = Date.parse(b || "") || 0;
  if (!ta) return b || "";
  if (!tb) return a || "";
  return ta <= tb ? a : b;
}

/** Не даём backup/checkout омолодить дату пуша. */
function coalesceSavedAt(existing, incoming, revisionId) {
  const pinned = PINNED_FIRST_SAVED[String(revisionId || "").trim()] || "";
  let out = earlierIso(existing?.firstSavedAt || existing?.savedAt, incoming);
  out = earlierIso(out, pinned);
  return out || incoming || existing?.savedAt || new Date().toISOString();
}

export function readReleaseRing() {
  const raw = readJson(releasesPath());
  const ring = Array.isArray(raw) ? raw.filter((r) => r && r.revisionId) : [];
  let dirty = false;
  for (const r of ring) {
    const id = String(r.revisionId || "").trim();
    const pinned = PINNED_FIRST_SAVED[id];
    const first = coalesceSavedAt(r, r.savedAt, id);
    if (pinned && (!r.firstSavedAt || Date.parse(r.savedAt || "") > Date.parse(pinned))) {
      r.firstSavedAt = pinned;
      r.savedAt = pinned;
      dirty = true;
    } else if (!r.firstSavedAt && first) {
      r.firstSavedAt = first;
      dirty = true;
    } else if (r.firstSavedAt && r.savedAt && Date.parse(r.savedAt) > Date.parse(r.firstSavedAt)) {
      // Показать в UI дату первого пуша, не mtime после checkout.
      r.savedAt = r.firstSavedAt;
      dirty = true;
    }
  }
  if (dirty) writeJson(releasesPath(), ring);
  return ring;
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

/** 2026-09-23 → 23.09 · 2026-10-13 → 13.10 (год, если не текущий) */
export function releaseDayLabel(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => (n < 10 ? "0" : "") + n;
  const day = p(d.getDate()) + "." + p(d.getMonth() + 1);
  if (d.getFullYear() !== now.getFullYear()) return day + "." + String(d.getFullYear()).slice(-2);
  return day;
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
  const hit = ring.find((r) => r.revisionId === id);
  const incomingSaved = manifest.savedAt || new Date().toISOString();
  const savedAt = coalesceSavedAt(hit, incomingSaved, id);
  const row = {
    revisionId: id,
    deployMode: manifest.deployMode || (manifest.files?.length > 1 ? "shards" : "monolith"),
    savedAt,
    firstSavedAt: hit?.firstSavedAt || savedAt,
    files: Array.isArray(manifest.files) ? manifest.files : [],
  };
  if (!replace && hit) {
    // Не трогаем файлы/дату без явной замены — только подтянуть более раннюю дату.
    const disk = Date.parse(incomingSaved) || 0;
    const had = Date.parse(hit.savedAt || "") || 0;
    if (disk && (!had || disk < had)) {
      hit.savedAt = incomingSaved;
      hit.firstSavedAt = earlierIso(hit.firstSavedAt, incomingSaved);
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
    const ta = Date.parse(a.firstSavedAt || a.savedAt || "") || 0;
    const tb = Date.parse(b.firstSavedAt || b.savedAt || "") || 0;
    return tb - ta;
  });
  return ring.map((r, i) => {
    const parentId = ring[i + 1]?.revisionId || "";
    const when = r.firstSavedAt || r.savedAt || "";
    return {
      revisionId: r.revisionId,
      shortId: shortRevisionId(r.revisionId),
      dayLabel: releaseDayLabel(when),
      label: releaseLabel(r.revisionId, when),
      savedAt: when,
      fileCount: Array.isArray(r.files) ? r.files.length : 0,
      files: (r.files || []).map((f) => f.filename).filter(Boolean),
      current: Boolean(cur) && r.revisionId === cur,
      parentId,
      parentShortId: shortRevisionId(parentId),
    };
  });
}
