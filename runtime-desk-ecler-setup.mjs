/**
 * Первичная настройка PLAYER ZERO: AirPlay, unmute, громкость. Без Open пресета.
 */
import {
  eclerAirPlayIndex,
  eclerLiveVolumeFrame,
  eclerOpenSourceFrame,
  eclerProbeFrame,
  eclerRpcLine,
  eclerSetupSnapshot,
  eclerSourceListFrame,
  normalizeEclerZone,
} from "./runtime-desk-ecler.mjs";
import { eclerSendTcp, readDeskEclerConfig, writeDeskEclerConfig } from "./runtime-desk-ecler-rpc.mjs";

const SETUP_VOLUME = 40;

function zoneOf(input) {
  return normalizeEclerZone(input) || readDeskEclerConfig().zones.find((z) => z.id === String(input?.id || "").trim()) || null;
}

function saveSetup(row, setup) {
  const cur = readDeskEclerConfig();
  const next = { ...row, setup };
  const zones = cur.zones.filter((z) => z.id !== next.id && z.host !== next.host);
  zones.push(next);
  return writeDeskEclerConfig({ zones });
}

export async function commissionDeskEclerZone(input) {
  const row = zoneOf(input);
  if (!row) return { ok: false, error: "bad_zone" };
  const listed = await eclerSendTcp(row.host, row.port, [eclerSourceListFrame()], 4000);
  const airplay = eclerAirPlayIndex(listed?.body?.SourceList);
  const opened = await eclerSendTcp(row.host, row.port, [eclerOpenSourceFrame(airplay)], 5000);
  if (opened?.ok === false) {
    const snap = eclerSetupSnapshot(opened.body, listed?.body?.SourceList);
    const cfg = saveSetup(row, snap);
    return { ok: false, error: "usb_or_open", airplay, ...cfg, zone: row, setup: snap };
  }
  await eclerSendTcp(row.host, row.port, [eclerLiveVolumeFrame(SETUP_VOLUME)], 4000);
  await eclerSendTcp(row.host, row.port, [eclerRpcLine({ method: "Player.Stop" })], 4000);
  const after = await eclerSendTcp(row.host, row.port, [eclerProbeFrame()], 4000);
  if (after?.ok === false) {
    return { ok: false, error: after.error || "timeout", zone: row, airplay };
  }
  const setup = eclerSetupSnapshot(after.body, listed?.body?.SourceList || after.body?.SourceList);
  const cfg = saveSetup(row, setup);
  return { ok: setup.ready, error: setup.ready ? undefined : "not_airplay", airplay, ...cfg, zone: row, setup };
}
