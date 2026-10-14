/**
 * Типовые на столе — тот же каталог, что в Связях. JSON рядом с разметкой, диск не пишем.
 * Telegram на контроллере нет.
 */
import fs from "node:fs";
import path from "node:path";
import { deskMarkingPath, isDeskDeviceKey, readDeskDocument, upsertDeskShelfMark } from "./runtime-desk-marking.mjs";
import { exclusiveDeskCards, isLoadControl } from "./runtime-desk-rules-marks.mjs";

function isPourLoad(controlId) {
  const c = String(controlId ?? "").trim();
  if (/^(On|Off|Toggle) K\d+$/i.test(c)) return false;
  if (/^Input /i.test(c)) return false;
  return isLoadControl(c);
}

const L = (id, cat, title, summary, extra = {}) => ({ id, cat, title, summary, multi: false, ...extra });
const M = (id, cat, title, summary, extra = {}) => L(id, cat, title, summary, { multi: true, ...extra });
const C = (id, cat, title, summary, extra = {}) => M(id, cat, title, summary, { needTrig: false, ...extra });

/** L1 витрина «Свет» — как Home на Vercel; остальное — «Ещё». */
export const DESK_L1_LIGHT_IDS = [
  "light_button_toggle",
  "light_dim_hold_mcm",
  "light_all_off",
  "light_motion",
  "light_night_path",
  "stair_light_motion",
  "light_reed_on",
  "master_power_off_restore",
  "cron_presence_on",
];

export const DESK_SOLUTION_CARDS = [
  L("light_button_toggle", "Свет", "Свет кнопкой — переключить", "Если нажали кнопку → свет вкл ↔ выкл."),
  L("light_dim_hold_mcm", "Свет", "Диммирование", "Если удерживаете кнопку → яркость плавно."),
  L("custom_control_task", "Общее", "Иная задача", "Если кнопка или датчик → любая нагрузка с вашим значением."),
  M("light_all_off", "Свет", "Мастер выключатель", "Если нажали → гасит выбранный свет."),
  M("light_scene_on", "Сцены", "Сцена: включить несколько", "Если нажали → всегда включает выбранные группы света."),
  L("light_motion", "Свет", "Свет по движению", "Если есть движение → включить свет."),
  L("light_night_path", "Свет", "Ночной путь", "Если движение ночью → мягкий свет."),
  M("stair_light_motion", "Свет", "Подсветка лестницы", "Если движение → свет зон лестницы."),
  L("light_reed_on", "Свет", "Свет по двери", "Если дверь открыта → включить свет."),
  L("socket_button_toggle", "Розетки", "Розетка кнопкой", "Если нажали → розетка вкл ↔ выкл."),
  M("master_power_off_restore", "Свет", "Мастер OFF + восстановление", "Гасит свет и потом возвращает как было."),
  C("cron_presence_on", "Свет", "Имитация присутствия", "По расписанию включает свет — как будто дома."),
  C("cron_all_off", "Свет", "Ночью — всё OFF", "По расписанию гасит свет — тихий час."),
  C("outdoor_dusk_on", "Свет", "Улица: сумерки ON", "Если вечер по расписанию → уличный свет ON."),
  C("outdoor_dawn_off", "Свет", "Улица: рассвет OFF", "Если утро по расписанию → улица OFF."),
  C("anti_ice_cron_on", "Общее", "Антилёд: включить", "По расписанию греет кабель / антиобледенение."),
  C("anti_ice_cron_off", "Общее", "Антилёд: выключить", "По расписанию выключает греющий кабель."),
  L("ac_cool_comfort", "Климат", "Кондиционер по температуре", "Если в комнате жарче нужного → кондей ON.", {
    fields: [
      { key: "thr", label: "Жарче чем", unit: "°C", def: 25 },
      { key: "hyst", label: "Стоп ниже на", unit: "°C", def: 1 },
    ],
  }),
  L("ac_window_off", "Климат", "Окно открыто — стоп кондея", "Если окно открыто → кондей OFF. Сам обратно не включает."),
  L("thermostat_simple_vd", "Климат", "Термостат на щите", "Если холоднее нужного → греет; теплее — стоп.", {
    fields: [
      { key: "thr", label: "Нужно", unit: "°C", def: 25 },
      { key: "hyst", label: "Стоп выше на", unit: "°C", def: 1 },
    ],
  }),
  C("rollers_evening", "Шторы", "Роллеты: вечер", "По расписанию закрывает роллеты."),
  L("curtain_button_open", "Шторы", "Шторы: открыть кнопкой", "Если нажали → штора / роллета открывается."),
  L("curtain_button_close", "Шторы", "Шторы: закрыть кнопкой", "Если нажали → штора закрывается."),
  L("curtain_button_stop", "Шторы", "Шторы: стоп кнопкой", "Если нажали → привод останавливается."),
  L("gate_button_open", "Общее", "Ворота: открыть кнопкой", "Если нажали → ворота / калитка открываются."),
  L("gate_button_close", "Общее", "Ворота: закрыть кнопкой", "Если нажали → ворота закрываются."),
  L("gate_button_stop", "Общее", "Ворота: стоп кнопкой", "Если нажали → привод ворот стоп."),
  C("curtain_dusk_close", "Шторы", "Шторы: вечер — закрыть", "По расписанию закрывает шторы."),
  C("curtain_dawn_open", "Шторы", "Шторы: утро — открыть", "По расписанию открывает шторы."),
  L("vent_humidity", "Климат", "Вытяжка по влажности", "Если влажно → вытяжка ON; когда сухо — OFF.", {
    fields: [
      { key: "thr", label: "Влажнее чем", unit: "%", def: 70 },
      { key: "hyst", label: "Суше на", unit: "%", def: 5 },
    ],
  }),
  L("vent_humidity_motion", "Климат", "Вытяжка: влажность и движение", "Если влажно и есть люди → вытяжка; никого — OFF.", {
    fields: [
      { key: "thr", label: "Влажнее чем", unit: "%", def: 70 },
      { key: "hyst", label: "Суше на", unit: "%", def: 5 },
    ],
  }),
  L("vent_co2", "Климат", "Вентиляция по CO₂", "Если душно → приточка ON; воздух чистый — OFF.", {
    fields: [
      { key: "thr", label: "Душно от", unit: "ppm", def: 1000 },
      { key: "hyst", label: "Чище на", unit: "ppm", def: 50 },
    ],
  }),
  L("vent_diy_vav", "Климат", "Приточка DIY / VAV", "Если душно → мотор и заслонки. Калорифер — только после пуска."),
  L("humidifier_low", "Климат", "Увлажнитель в диапазоне", "Если сухо → увлажнитель ON; влажно — OFF.", {
    fields: [
      { key: "lo", label: "Сухо ниже", unit: "%", def: 40 },
      { key: "hi", label: "Хватит выше", unit: "%", def: 55 },
    ],
  }),
  L("warm_floor_comfort", "Климат", "Тёплый пол: комфорт", "Если пол холоднее нужного → греет; теплее — стоп.", {
    fields: [
      { key: "thr", label: "Греть ниже", unit: "°C", def: 22 },
      { key: "hyst", label: "Стоп выше на", unit: "°C", def: 1 },
    ],
  }),
  L("warm_floor_electric_comfort", "Климат", "Тёплый пол электрический", "Если холоднее нужного → реле ON; теплее — OFF.", {
    fields: [
      { key: "thr", label: "Греть ниже", unit: "°C", def: 22 },
      { key: "hyst", label: "Стоп выше на", unit: "°C", def: 1 },
    ],
  }),
  L("warm_floor_water_comfort", "Климат", "Тёплый пол водяной", "Если холоднее нужного → насос / серво ON.", {
    fields: [
      { key: "thr", label: "Греть ниже", unit: "°C", def: 22 },
      { key: "hyst", label: "Стоп выше на", unit: "°C", def: 1 },
    ],
  }),
  L("weather_climate_link", "Климат", "Погода → климат", "Если на улице жарко → можно охлаждение / вентиляцию.", {
    fields: [
      { key: "thr", label: "На улице жарче", unit: "°C", def: 24 },
      { key: "hyst", label: "Стоп ниже на", unit: "°C", def: 1 },
    ],
  }),
  M("leak_close_valves", "Охрана", "Протечка — закрыть краны", "Если протечка → закрыть краны. Можно несколько линий."),
  L("lock_button_set", "Охрана", "Замок кнопкой", "Если нажали → команда на замок."),
  L("siren_motion", "Охрана", "Сирена по движению", "Если движение → сирена / тревога."),
  M("scene_away", "Сцены", "Не дома", "Если нажали → гасит свет и розетки, закрывает шторы."),
  M("scene_vacation", "Сцены", "В отпуске", "Как «Не дома» + бережный климат. Имитацию — отдельно по расписанию."),
  M("scene_home", "Сцены", "Я дома", "Если нажали → свет зоны, шторы открыть, розетки по желанию."),
  M("scene_morning", "Сцены", "Утро", "Если нажали → утренний свет и шторы открыть."),
  M("scene_day", "Сцены", "День", "Если нажали → шторы открыть, искусственный свет выключить."),
  M("scene_evening", "Сцены", "Вечер", "Если нажали → свет ~60% и шторы закрыть."),
  M("scene_good_night", "Сцены", "Спокойной ночи", "Если нажали → гасит свет зоны и закрывает шторы."),
  M("scene_kids_night", "Сцены", "Детский сон", "Если нажали → ночник ~5% и шторы закрыть."),
  M("scene_cinema", "Сцены", "Кино", "Если нажали → свет ~15% и шторы закрыть."),
  M("scene_dinner", "Сцены", "Ужин", "Если нажали → мягкий свет ~40% и шторы закрыть."),
  M("scene_guests", "Сцены", "Гости", "Если нажали → яркий свет и шторы открыть."),
  M("scene_work", "Сцены", "Работа", "Если нажали → рабочий свет и шторы открыть."),
  M("scene_relax", "Сцены", "Отдых", "Если нажали → свет ~25% и шторы закрыть."),
];

function contactOf(raw) {
  const deviceTopicKey = String(raw?.deviceTopicKey ?? "").trim();
  const controlId = String(raw?.controlId ?? "").trim();
  if (!isDeskDeviceKey(deviceTopicKey)) return null;
  if (!controlId || controlId.length > 64) return null;
  return { deviceTopicKey, controlId };
}

function writeDoc(doc) {
  const file = deskMarkingPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 3,
      shelves: doc.shelves || {},
      solutions: doc.solutions || [],
      rooms: Array.isArray(doc.rooms) ? doc.rooms : [],
    }, null, 2) + "\n",
    "utf8",
  );
}

export function listDeskSolutions() {
  return readDeskDocument().solutions;
}

export function upsertDeskSolution(input) {
  const card = DESK_SOLUTION_CARDS.find((c) => c.id === String(input?.solutionId ?? "").trim());
  if (!card) return { ok: false, error: "bad_card" };
  const trigger = contactOf(input?.trigger);
  if (card.needTrig !== false && !trigger) return { ok: false, error: "need_trigger" };
  const rawTargets = Array.isArray(input?.targets) ? input.targets : input?.target ? [input.target] : [];
  const targets = rawTargets.map(contactOf).filter(Boolean);
  if (!targets.length) return { ok: false, error: "need_target" };
  if (targets.some((t) => !isPourLoad(t.controlId))) return { ok: false, error: "need_load" };
  const doc = readDeskDocument();
  const id = String(input?.id ?? "").trim() || `sol_${Date.now().toString(36)}`;
  const params = {};
  for (const f of Array.isArray(card.fields) ? card.fields : []) {
    const raw = input?.params?.[f.key];
    const n = Number(raw);
    params[f.key] = Number.isFinite(n) ? n : Number(f.def);
  }
  const row = {
    id,
    solutionId: card.id,
    title: card.title,
    trigger: trigger || null,
    targets,
    ...(Object.keys(params).length ? { params } : {}),
    savedAt: new Date().toISOString(),
  };
  const next = doc.solutions.filter((s) => s.id !== id);
  next.push(row);
  writeDoc({ ...doc, solutions: next });
  // Merge: вкл + дим на одной линии должны жить вместе, не затирать друг друга.
  {
    const stamp = exclusiveDeskCards([card.id]);
    if (stamp.length) {
      const shelves = doc.shelves || {};
      targets.forEach((t) => {
        if (!isPourLoad(t.controlId)) return;
        const prev = shelves[t.deviceTopicKey]?.channels?.[t.controlId]?.cards;
        const merged = exclusiveDeskCards([...(Array.isArray(prev) ? prev : []), card.id]);
        if (!merged.length) return;
        upsertDeskShelfMark({
          deviceTopicKey: t.deviceTopicKey,
          controlId: t.controlId,
          cards: merged,
        });
      });
    }
  }
  return { ok: true, solution: row, solutions: next };
}

export function deleteDeskSolution(id) {
  const want = String(id ?? "").trim();
  if (!want) return { ok: false, error: "need_id" };
  const doc = readDeskDocument();
  const solutions = doc.solutions.filter((s) => s.id !== want);
  writeDoc({ ...doc, solutions });
  return { ok: true, solutions };
}
