/**
 * Ecler PLAYER ZERO: JSON-RPC по TCP 2003. MQTT /flos/audio/{zone}/set → агент.
 */
export const ECLER_TCP_PORT = 2003;

export function eclerZoneIdFromHost(host) {
  const h = String(host || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/:\d+$/, "")
    .replace(/\/.*$/, "");
  if (!h || /\s/.test(h)) return "";
  return "ecler-zero_" + h.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "");
}

export function normalizeEclerHost(host) {
  return String(host || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
}

export function normalizeEclerZone(input) {
  const host = normalizeEclerHost(input?.host);
  const port = Number(input?.port) > 0 ? Number(input.port) : ECLER_TCP_PORT;
  const id = String(input?.id || "").trim() || eclerZoneIdFromHost(host);
  const title = String(input?.title || "").trim() || host;
  if (!host || !id) return null;
  if (host === "0.0.0.0" || /[/?#]/.test(host)) return null;
  if (!Number.isFinite(port) || port < 1 || port > 65535) return null;
  return { id, host, port, title };
}

export function eclerTopics(zoneId) {
  const z = String(zoneId || "").trim();
  return { command: `/flos/audio/${z}/set`, state: `/flos/audio/${z}/state` };
}

export function parseEclerCommand(topic) {
  const m = /^\/?flos\/audio\/([^/]+)\/set$/i.exec(String(topic || "").trim());
  if (!m) return null;
  return { zoneId: m[1] };
}

export function eclerIsPlaying(stats) {
  return Number(stats?.status) === 1;
}

export function eclerCommandFromPayload(raw) {
  const s = String(raw || "").trim();
  const out = { play: false, stop: false, toggle: false, volume: null, preset: null, volumeDir: "" };
  if (!s) return out;
  if (/^(stop|off|0)$/i.test(s)) return { ...out, stop: true };
  if (/^(play|on|1)$/i.test(s)) return { ...out, play: true };
  if (/^(inc|up|\+)$/i.test(s)) return { ...out, volumeDir: "inc" };
  if (/^(dec|down|-)$/i.test(s)) return { ...out, volumeDir: "dec" };
  if (s.charAt(0) === "{") {
    try {
      const j = JSON.parse(s);
      const st = String(j.state || j.action || "").toUpperCase();
      if (st === "OFF" || st === "STOP" || j.stop === true) out.stop = true;
      if (st === "ON" || st === "PLAY" || j.play === true) out.play = true;
      if (st === "TOGGLE" || j.toggle === true) out.toggle = true;
      const vol = Number(j.volume ?? j.Volume);
      if (Number.isFinite(vol)) out.volume = Math.max(0, Math.min(100, Math.round(vol)));
      const p = Number(j.preset ?? j.Preset);
      if (Number.isFinite(p) && p >= 1 && p <= 20) out.preset = Math.round(p);
      const dir = String(j.volumeDir || j.Action || "").toLowerCase();
      if (dir === "inc" || dir === "up") out.volumeDir = "inc";
      if (dir === "dec" || dir === "down") out.volumeDir = "dec";
    } catch {
      return out;
    }
    return out;
  }
  const n = Number(s);
  if (Number.isFinite(n) && n >= 0 && n <= 100) out.volume = Math.round(n);
  return out;
}

export function eclerRpcLine(fields) {
  return JSON.stringify({ jsonrpc: "2.0", ...fields }) + "\n";
}

/** Кадры JSON-RPC: пресет, громкость, play/stop. */
export function eclerRpcFrames(cmd) {
  const frames = [];
  if (cmd?.stop) frames.push(eclerRpcLine({ method: "Player.Stop" }));
  if (cmd?.preset != null) frames.push(eclerRpcLine({ method: "Player.Open", Preset: cmd.preset }));
  if (cmd?.volume != null) frames.push(eclerRpcLine({ method: "Player.Volume", Volume: cmd.volume }));
  if (cmd?.volumeDir === "inc") frames.push(eclerRpcLine({ method: "Player.Volume", Action: "inc" }));
  if (cmd?.volumeDir === "dec") frames.push(eclerRpcLine({ method: "Player.Volume", Action: "dec" }));
  if (cmd?.play && !cmd?.stop) frames.push(eclerRpcLine({ method: "Player.Play" }));
  return frames;
}

export function eclerProbeFrame() {
  return eclerRpcLine({ method: "Player.GetStats" });
}

export function parseEclerReply(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const chunk = s.split(/\r?\n/).filter(Boolean).pop() || s;
  try {
    const j = JSON.parse(chunk);
    if (j && j.result === false) return { ok: false, error: "ecler_false", body: j };
    if (j && (j.result === true || j.title != null || j.status != null || j.volume != null)) {
      return { ok: true, body: j };
    }
  } catch {
    return null;
  }
  return null;
}

export function eclerStatePayload(cmd, stats) {
  const st = stats && typeof stats === "object" ? stats : {};
  const playing = Number(st.status) === 1 || (cmd && cmd.play && !cmd.stop);
  const vol = Number.isFinite(Number(st.volume))
    ? Number(st.volume)
    : cmd && cmd.volume != null
      ? cmd.volume
      : 0;
  if (cmd?.stop || !playing) return JSON.stringify({ state: "OFF", volume: Math.max(0, Math.round(vol)) });
  return JSON.stringify({
    state: "ON",
    volume: Math.max(0, Math.min(100, Math.round(vol))),
    title: String(st.title || ""),
  });
}

export function eclerShelfRows(zones) {
  return (Array.isArray(zones) ? zones : []).map((z) => ({
    deviceTopicKey: z.id,
    label: "Ecler " + (z.title || z.host),
    channels: [{ controlId: "player", name: z.title || z.host, lastValue: "" }],
  }));
}
