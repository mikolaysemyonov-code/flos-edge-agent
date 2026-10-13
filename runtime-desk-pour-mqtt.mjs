/**
 * Прячем FORM LOGIC OS в MQTT с агента.
 * homeui читает JSON `/controls/<id>/meta` → поле hidden (не subtopic meta/hidden).
 * Subtopic пишем тоже — на старых сборках / для отладки.
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

/** @returns {Promise<{ids:string[], metas:Map<string,object>}>} */
export async function discoverFormLogicOsControls(timeoutMs = 2200) {
  const ids = new Set();
  const metas = new Map();
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
    client.on("message", (topic, payload) => {
      const m = /^\/devices\/form_logic_os\/controls\/([^/]+)(?:\/(.*))?$/.exec(String(topic || ""));
      if (!m?.[1]) return;
      const id = m[1];
      const rest = m[2] || "";
      ids.add(id);
      if (rest === "meta") {
        try {
          metas.set(id, JSON.parse(payload.toString()));
        } catch {
          metas.set(id, { type: "switch", title: { en: id } });
        }
      }
    });
  });
  return { ids: [...ids], metas };
}

/** @deprecated use discoverFormLogicOsControls */
export async function discoverFormLogicOsControlIds(timeoutMs = 1800) {
  const { ids } = await discoverFormLogicOsControls(timeoutMs);
  return ids;
}

function metaWithHidden(base, hidden) {
  const src = base && typeof base === "object" ? { ...base } : { type: "switch" };
  src.hidden = Boolean(hidden);
  return JSON.stringify(src);
}

/**
 * @param {string[]} ghostIds
 * @param {string[]} activeIds
 * @param {Map<string, object>} [metas]
 */
export async function publishFormLogicOsMetaHide(ghostIds, activeIds, metas = new Map()) {
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
    const watchdog = setTimeout(() => finish(n), 5000);
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
        pub(`${base}/meta`, metaWithHidden(metas.get(id), true));
        pub(`${base}/meta/hidden`, "1");
        pub(`${base}/meta/error`, "1");
      }
      for (const id of active) {
        const base = `/devices/form_logic_os/controls/${id}`;
        const cur = metas.get(id);
        if (cur && cur.hidden) {
          pub(`${base}/meta`, metaWithHidden(cur, false));
        }
        pub(`${base}/meta/hidden`, "0");
        pub(`${base}/meta/error`, "");
      }
      setTimeout(() => {
        clearTimeout(watchdog);
        finish(n);
      }, 400);
    });
  });
  return { ok: published > 0, published, ghosts: ghosts.length };
}

/**
 * После apply/restart: дождаться settle, прочитать live meta, спрятать ghosts через JSON.hidden.
 * @param {string[]} activeIds
 * @param {string[]} [extraGhostIds]
 */
export async function hideFormLogicOsGhostsNow(activeIds, extraGhostIds = []) {
  const keep = new Set((activeIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  // wb-rules после restart ещё пишет meta — ждём settle, иначе наш hidden затрут.
  await sleep(2500);
  let live = [];
  let metas = new Map();
  try {
    const disc = await discoverFormLogicOsControls(2500);
    live = disc.ids;
    metas = disc.metas;
  } catch {
    live = [];
  }
  const ghosts = [
    ...new Set([
      ...(extraGhostIds || []).map((id) => String(id || "").trim()).filter(Boolean),
      ...live.filter((id) => id && !keep.has(id)),
    ]),
  ];
  const mqtt = await publishFormLogicOsMetaHide(ghosts, [...keep], metas);
  // Повтор через 2с — если defineVirtualDevice дописал meta позже.
  await sleep(2000);
  const again = await publishFormLogicOsMetaHide(ghosts, [...keep], metas);
  return {
    ok: mqtt.ok || again.ok,
    published: (mqtt.published || 0) + (again.published || 0),
    ghosts: ghosts.length,
    liveCount: live.length,
    ghostIds: ghosts,
  };
}
