/**
 * Прячем/показываем FORM LOGIC OS в MQTT напрямую с агента.
 * wb-rules IIFE после restart ненадёжен: UI WB смотрит retained meta/hidden.
 */
import mqtt from "mqtt";

function brokerUrl() {
  const host = (
    process.env.FLOS_MQTT_MIRROR_HOST ||
    process.env.REACTOR_MQTT_MIRROR_HOST ||
    "127.0.0.1"
  ).trim();
  const port = Number(process.env.FLOS_MQTT_MIRROR_PORT || process.env.REACTOR_MQTT_MIRROR_PORT || 1883) || 1883;
  return `mqtt://${host}:${port}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Собрать controlId живого form_logic_os с брокера (retained). */
export async function discoverFormLogicOsControlIds(timeoutMs = 1800) {
  const ids = new Set();
  const client = mqtt.connect(brokerUrl(), {
    connectTimeout: 2500,
    reconnectPeriod: 0,
  });
  await new Promise((resolve) => {
    const finish = () => {
      try {
        client.end(true);
      } catch {
        /* ignore */
      }
      resolve();
    };
    const t = setTimeout(finish, timeoutMs);
    client.on("error", () => {
      clearTimeout(t);
      finish();
    });
    client.on("connect", () => {
      client.subscribe("/devices/form_logic_os/controls/#", { qos: 0 }, () => {});
    });
    client.on("message", (topic) => {
      const m = /^\/devices\/form_logic_os\/controls\/([^/]+)(?:\/|$)/.exec(String(topic || ""));
      if (m?.[1] && !m[1].includes("meta")) ids.add(m[1]);
    });
  });
  return [...ids];
}

/**
 * @param {string[]} ghostIds
 * @param {string[]} activeIds
 */
export async function publishFormLogicOsMetaHide(ghostIds, activeIds) {
  const ghosts = [...new Set((ghostIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  const active = [...new Set((activeIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ghosts.length && !active.length) return { ok: true, published: 0, ghosts: 0 };
  const client = mqtt.connect(brokerUrl(), {
    connectTimeout: 2500,
    reconnectPeriod: 0,
  });
  const published = await new Promise((resolve) => {
    let n = 0;
    const finish = (count) => {
      try {
        client.end(true);
      } catch {
        /* ignore */
      }
      resolve(count);
    };
    const watchdog = setTimeout(() => finish(n), 4000);
    client.on("error", () => {
      clearTimeout(watchdog);
      finish(n);
    });
    client.on("connect", () => {
      const pub = (topic, payload) => {
        client.publish(topic, payload, { qos: 1, retain: true });
        n += 1;
      };
      for (const id of ghosts) {
        const base = `/devices/form_logic_os/controls/${id}`;
        pub(`${base}/meta/hidden`, "1");
        pub(`${base}/meta/error`, "1");
      }
      for (const id of active) {
        const base = `/devices/form_logic_os/controls/${id}`;
        pub(`${base}/meta/hidden`, "0");
        pub(`${base}/meta/error`, "");
      }
      setTimeout(() => {
        clearTimeout(watchdog);
        finish(n);
      }, 250);
    });
  });
  return { ok: published > 0, published, ghosts: ghosts.length };
}

/**
 * После apply: найти живые топики и спрятать всё, чего нет в activeIds.
 * @param {string[]} activeIds
 * @param {string[]} [extraGhostIds]
 */
export async function hideFormLogicOsGhostsNow(activeIds, extraGhostIds = []) {
  const keep = new Set((activeIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  await sleep(400);
  let live = [];
  try {
    live = await discoverFormLogicOsControlIds(2000);
  } catch {
    live = [];
  }
  const ghosts = [
    ...new Set([
      ...(extraGhostIds || []).map((id) => String(id || "").trim()).filter(Boolean),
      ...live.filter((id) => id && !keep.has(id)),
    ]),
  ];
  const mqtt = await publishFormLogicOsMetaHide(ghosts, [...keep]);
  return { ...mqtt, liveCount: live.length, ghostIds: ghosts };
}
