/**
 * Пароль стола. Хеш на диске, сессия в памяти процесса. Пароль в проект не пишется.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { deskMarkingPath } from "./runtime-desk-marking.mjs";

const SESSION_MS = 12 * 60 * 60 * 1000;
const sessions = new Map();

export function deskGatePath() {
  return path.join(path.dirname(deskMarkingPath()), "desk-gate.json");
}

export function cleanDeskPassword(value) {
  const password = String(value ?? "");
  if (password.length < 8 || password.length > 64) return "";
  if (/[\u0000-\u001f]/.test(password)) return "";
  return password;
}

export function hashDeskPassword(password, salt = crypto.randomBytes(16)) {
  const hash = crypto.scryptSync(password, salt, 32);
  return { salt: salt.toString("hex"), hash: hash.toString("hex") };
}

export function verifyDeskPassword(password, stored) {
  try {
    const salt = Buffer.from(String(stored?.salt || ""), "hex");
    const want = Buffer.from(String(stored?.hash || ""), "hex");
    if (!salt.length || want.length !== 32) return false;
    const got = crypto.scryptSync(String(password ?? ""), salt, 32);
    return crypto.timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

export function readDeskGate() {
  try {
    const json = JSON.parse(fs.readFileSync(deskGatePath(), "utf8"));
    if (!json || typeof json.salt !== "string" || typeof json.hash !== "string") return null;
    return { salt: json.salt, hash: json.hash };
  } catch {
    return null;
  }
}

export function writeDeskGate(record) {
  const file = deskGatePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, JSON.stringify({ salt: record.salt, hash: record.hash }) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* права уже выставлены записью */ }
}

export function clearDeskSessions() {
  sessions.clear();
}

export function openDeskSession() {
  const now = Date.now();
  for (const [token, exp] of sessions) {
    if (exp <= now) sessions.delete(token);
  }
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, now + SESSION_MS);
  return token;
}

export function deskSessionCookie(token) {
  return "flos_desk=" + token + "; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200";
}

export function deskCookieToken(header) {
  const raw = String(header || "");
  const match = /(?:^|;\s*)flos_desk=([a-f0-9]{48})(?:;|$)/.exec(raw);
  return match ? match[1] : "";
}

export function deskSessionOpen(token) {
  const exp = sessions.get(String(token || ""));
  return typeof exp === "number" && exp > Date.now();
}

export function deskGateAllows(cookieHeader, bearerOk) {
  if (!readDeskGate()) return true;
  if (bearerOk === true) return true;
  return deskSessionOpen(deskCookieToken(cookieHeader));
}
