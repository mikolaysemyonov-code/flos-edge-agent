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
];

export const DESK_SOLUTION_CARDS = [
  M("light_button_toggle", "Свет", "Свет кнопкой — переключить", "Кнопка управляет выбранным светом (режим ниже).", {
    loadKind: "light",
    fields: [
      {
        key: "mode",
        kind: "select",
        label: "Режим кнопки",
        def: "toggle",
        options: [
          { v: "toggle", t: "Синхронный вкл ↔ выкл" },
          { v: "off", t: "Только выкл" },
          { v: "on", t: "Только вкл" },
        ],
      },
    ],
  }),
  M("light_dim_hold_mcm", "Свет", "Диммирование", "Если удерживаете кнопку → яркость плавно на выбранных линиях.", {
    loadKind: "light",
  }),
  M("custom_control_task", "Общее", "Иная задача", "Если нажали → записать значение на выбранные нагрузки.", {
    fields: [{ key: "val", label: "Значение на нагрузку", unit: "", def: 1 }],
  }),
  M("light_all_off", "Свет", "Мастер выключатель", "Долгое нажатие → гасит выбранный свет.", { loadKind: "light" }),
  M("light_scene_on", "Сцены", "Сцена: включить несколько", "Если нажали → включает выбранные группы.", {
    loadKind: "light",
    fields: [{ key: "level", label: "Уровень света", unit: "%", def: 100 }],
  }),
  M("light_motion", "Свет", "Свет по движению", "Если есть движение → свет; ушло — гасит по таймеру.", {
    loadKind: "light",
    fields: [
      { key: "level", label: "Яркость", unit: "%", def: 100 },
      { key: "offDelay", label: "Гасить через", unit: "сек · 0=сразу", def: 90 },
    ],
  }),
  M("light_night_path", "Свет", "Ночной путь", "Если движение → мягкий свет; ушло — гасит по таймеру.", {
    loadKind: "light",
    fields: [
      { key: "level", label: "Яркость", unit: "%", def: 15 },
      { key: "offDelay", label: "Гасить через", unit: "сек · 0=сразу", def: 45 },
    ],
  }),
  M("stair_light_motion", "Свет", "Подсветка лестницы", "Если движение → зоны лестницы; ушло — гасит по таймеру.", {
    loadKind: "light",
    fields: [
      { key: "level", label: "Яркость", unit: "%", def: 100 },
      { key: "offDelay", label: "Гасить через", unit: "сек · 0=сразу", def: 60 },
    ],
  }),
  M("light_reed_on", "Свет", "Свет по двери", "Если дверь открыта → свет; закрыта — гасит (или по таймеру).", {
    loadKind: "light",
    fields: [
      { key: "level", label: "Яркость", unit: "%", def: 100 },
      { key: "offDelay", label: "Гасить через", unit: "сек · 0=сразу", def: 0 },
    ],
  }),
  M("socket_button_toggle", "Розетки", "Розетка кнопкой", "Если нажали → выбранные розетки.", {
    loadKind: "socket",
    fields: [
      {
        key: "mode",
        kind: "select",
        label: "Режим кнопки",
        def: "toggle",
        options: [
          { v: "toggle", t: "Синхронный вкл ↔ выкл" },
          { v: "off", t: "Только выкл" },
          { v: "on", t: "Только вкл" },
        ],
      },
    ],
  }),
  // Расписание / мастер-restore — пока без emit: скрыты с витрины.
  M("master_power_off_restore", "Свет", "Мастер OFF + восстановление", "Гасит свет и потом возвращает как было.", { pour: false }),
  C("cron_presence_on", "Свет", "Имитация присутствия", "По расписанию включает свет — как будто дома.", { pour: false }),
  C("cron_all_off", "Свет", "Ночью — всё OFF", "По расписанию гасит свет — тихий час.", { pour: false }),
  C("outdoor_dusk_on", "Свет", "Улица: сумерки ON", "Если вечер по расписанию → уличный свет ON.", { pour: false }),
  C("outdoor_dawn_off", "Свет", "Улица: рассвет OFF", "Если утро по расписанию → улица OFF.", { pour: false }),
  C("anti_ice_cron_on", "Общее", "Антилёд: включить", "По расписанию греет кабель / антиобледенение.", { pour: false }),
  C("anti_ice_cron_off", "Общее", "Антилёд: выключить", "По расписанию выключает греющий кабель.", { pour: false }),
  M("ac_cool_comfort", "Климат", "Кондиционер по температуре", "Если в комнате жарче нужного → кондей ON.", {
    loadKind: "ac",
    fields: [
      { key: "on", label: "Включать выше", unit: "°C", def: 25 },
      { key: "off", label: "Выключать ниже", unit: "°C", def: 24 },
      { key: "minOn", label: "Мин. работа", unit: "сек", def: 180 },
      { key: "minOff", label: "Мин. пауза", unit: "сек", def: 180 },
    ],
  }),
  M("ac_window_off", "Климат", "Окно открыто — стоп кондея", "Если окно открыто → кондей OFF. Сам обратно не включает.", {
    loadKind: "ac",
  }),
  M("thermostat_simple_vd", "Климат", "Термостат на щите", "Если холоднее нужного → греет; теплее — стоп.", {
    loadKind: "heat",
    fields: [
      { key: "thr", label: "Желаемая температура", unit: "°C", def: 25 },
      { key: "hyst", label: "Превышение для отключения", unit: "+°C", def: 1 },
      { key: "minOn", label: "Мин. работа", unit: "сек", def: 60 },
      { key: "minOff", label: "Мин. пауза", unit: "сек", def: 60 },
    ],
  }),
  C("rollers_evening", "Шторы", "Роллеты: вечер", "По расписанию закрывает роллеты.", { pour: false }),
  M("curtain_button_open", "Шторы", "Шторы: открыть кнопкой", "Если нажали → выбранные шторы / роллеты открываются.", { loadKind: "curtain" }),
  M("curtain_button_close", "Шторы", "Шторы: закрыть кнопкой", "Если нажали → выбранные шторы закрываются.", { loadKind: "curtain" }),
  M("curtain_button_stop", "Шторы", "Шторы: стоп кнопкой", "Если нажали → выбранные приводы стоп.", { loadKind: "curtain" }),
  M("gate_button_open", "Общее", "Ворота: открыть кнопкой", "Если нажали → выбранные ворота / калитки открываются.", { loadKind: "gate" }),
  M("gate_button_close", "Общее", "Ворота: закрыть кнопкой", "Если нажали → выбранные ворота закрываются.", { loadKind: "gate" }),
  M("gate_button_stop", "Общее", "Ворота: стоп кнопкой", "Если нажали → выбранные приводы ворот стоп.", { loadKind: "gate" }),
  C("curtain_dusk_close", "Шторы", "Шторы: вечер — закрыть", "По расписанию закрывает шторы.", { pour: false }),
  C("curtain_dawn_open", "Шторы", "Шторы: утро — открыть", "По расписанию открывает шторы.", { pour: false }),
  M("vent_humidity", "Климат", "Вытяжка по влажности", "Гистерезис по влажности → вытяжка.", {
    loadKind: "exhaust",
    fields: [
      { key: "on", label: "Включать при влажности выше", unit: "%", def: 70 },
      { key: "off", label: "Выключать при влажности ниже", unit: "%", def: 65 },
      { key: "minOn", label: "Мин. работа", unit: "сек", def: 180 },
      { key: "minOff", label: "Мин. пауза", unit: "сек", def: 180 },
    ],
  }),
  M("vent_humidity_motion", "Климат", "Вытяжка: влажность и движение", "Влажность + люди → вытяжка.", {
    loadKind: "exhaust",
    needAux: true,
    auxLabel: "Движение",
    fields: [
      { key: "on", label: "Включать при влажности выше", unit: "%", def: 70 },
      { key: "off", label: "Выключать при влажности ниже", unit: "%", def: 65 },
      { key: "minOn", label: "Мин. работа", unit: "сек", def: 180 },
      { key: "minOff", label: "Мин. пауза", unit: "сек", def: 180 },
    ],
  }),
  M("vent_co2", "Климат", "Вентиляция по CO₂ (реле)", "Гистерезис CO₂ → реле приточки ON/OFF (не VAV).", {
    loadKind: "supply",
    fields: [
      { key: "on", label: "Включать при CO₂ выше", unit: "ppm", def: 1000 },
      { key: "off", label: "Выключать при CO₂ ниже", unit: "ppm", def: 800 },
      { key: "minOn", label: "Мин. работа", unit: "сек", def: 180 },
      { key: "minOff", label: "Мин. пауза", unit: "сек", def: 180 },
    ],
  }),
  M("vent_diy_vav", "Климат", "Приточка реле (ON/OFF)", "Если душно → выбранные реле ON; чисто — OFF. Для настоящей VAV — карточки зоны/вентилятора.", {
    loadKind: "supply",
    fields: [
      { key: "on", label: "Включать при CO₂ выше", unit: "ppm", def: 1000 },
      { key: "off", label: "Выключать при CO₂ ниже", unit: "ppm", def: 800 },
      { key: "minOn", label: "Мин. работа", unit: "сек", def: 180 },
      { key: "minOff", label: "Мин. пауза", unit: "сек", def: 180 },
    ],
  }),
  L("vent_vav_zone", "Климат", "Зона VAV (комната)", "CO₂ комнаты → заслонка 0–10 В пропорционально. По одной карточке на комнату.", {
    loadKind: "damper",
    fields: [
      { key: "xmin", label: "Чистый воздух (CO₂)", unit: "ppm", def: 600 },
      { key: "xmax", label: "Душно (CO₂)", unit: "ppm", def: 1100 },
      { key: "ymin", label: "Мин. открытие заслонки", unit: "%", def: 10 },
      { key: "ymax", label: "Макс. открытие заслонки", unit: "%", def: 100 },
    ],
  }),
  L("vent_vav_fan", "Климат", "Вентилятор VAV (Max-Selector)", "Скорость приточки = max(открытие зон). Без датчика — только AO вентилятора.", {
    needTrig: false,
    loadKind: "fan",
    fields: [{ key: "ymin", label: "Мин. скорость вентилятора", unit: "%", def: 10 }],
  }),
  M("humidifier_low", "Климат", "Увлажнитель в диапазоне", "Если сухо → увлажнитель ON; влажно — OFF.", {
    loadKind: "humid",
    fields: [
      { key: "lo", label: "Включать при влажности ниже", unit: "%", def: 40 },
      { key: "hi", label: "Выключать при влажности выше", unit: "%", def: 55 },
      { key: "minOn", label: "Мин. работа", unit: "сек", def: 180 },
      { key: "minOff", label: "Мин. пауза", unit: "сек", def: 180 },
    ],
  }),
  M("warm_floor_comfort", "Климат", "Тёплый пол: комфорт", "Если пол холоднее нужного → греет; теплее — стоп. Нет данных с датчика > stale → OFF.", {
    loadKind: "floor",
    fields: [
      { key: "thr", label: "Желаемая температура", unit: "°C", def: 22 },
      { key: "hyst", label: "Превышение для отключения", unit: "+°C", def: 1 },
      { key: "minOn", label: "Мин. работа", unit: "сек", def: 120 },
      { key: "minOff", label: "Мин. пауза", unit: "сек", def: 120 },
      { key: "staleSec", label: "Нет данных — стоп через", unit: "сек", def: 900 },
    ],
  }),
  M("warm_floor_electric_comfort", "Климат", "Тёплый пол электрический", "Если холоднее нужного → реле ON; теплее — OFF.", {
    loadKind: "floor",
    fields: [
      { key: "thr", label: "Желаемая температура", unit: "°C", def: 22 },
      { key: "hyst", label: "Превышение для отключения", unit: "+°C", def: 1 },
      { key: "minOn", label: "Мин. работа", unit: "сек", def: 120 },
      { key: "minOff", label: "Мин. пауза", unit: "сек", def: 120 },
      { key: "staleSec", label: "Нет данных — стоп через", unit: "сек", def: 900 },
    ],
  }),
  M("warm_floor_water_comfort", "Климат", "Тёплый пол водяной", "Если холоднее нужного → насос / серво ON.", {
    loadKind: "floor",
    fields: [
      { key: "thr", label: "Желаемая температура", unit: "°C", def: 22 },
      { key: "hyst", label: "Превышение для отключения", unit: "+°C", def: 1 },
      { key: "minOn", label: "Мин. работа", unit: "сек", def: 120 },
      { key: "minOff", label: "Мин. пауза", unit: "сек", def: 120 },
      { key: "staleSec", label: "Нет данных — стоп через", unit: "сек", def: 900 },
    ],
  }),
  M("weather_climate_link", "Климат", "Погода → климат", "Если на улице жарко → можно охлаждение / вентиляцию.", {
    loadKind: "climate",
    fields: [
      { key: "on", label: "Включать при улице выше", unit: "°C", def: 24 },
      { key: "off", label: "Выключать при улице ниже", unit: "°C", def: 23 },
      { key: "minOn", label: "Мин. работа", unit: "сек", def: 180 },
      { key: "minOff", label: "Мин. пауза", unit: "сек", def: 180 },
    ],
  }),
  M("leak_close_valves", "Охрана", "Протечка — закрыть краны", "Если протечка → закрыть краны. Только линии с именем «кран/клапан».", { loadKind: "valve" }),
  M("lock_button_set", "Охрана", "Замок кнопкой", "Если нажали → команда на выбранные замки.", { loadKind: "lock" }),
  M("siren_motion", "Охрана", "Сирена по движению", "Если движение → выбранные сирены / тревога.", { loadKind: "siren" }),
  M("scene_away", "Сцены", "Не дома", "Если нажали → гасит выбранный свет.", {
    loadKind: "light",
    fields: [{ key: "level", label: "Уровень света", unit: "%", def: 0 }],
  }),
  M("scene_vacation", "Сцены", "В отпуске", "Если нажали → гасит выбранный свет.", {
    loadKind: "light",
    fields: [{ key: "level", label: "Уровень света", unit: "%", def: 0 }],
  }),
  M("scene_home", "Сцены", "Я дома", "Если нажали → включает выбранный свет.", {
    loadKind: "light",
    fields: [{ key: "level", label: "Уровень света", unit: "%", def: 100 }],
  }),
  M("scene_morning", "Сцены", "Утро", "Если нажали → утренний свет на выбранных линиях.", {
    loadKind: "light",
    fields: [{ key: "level", label: "Уровень света", unit: "%", def: 80 }],
  }),
  M("scene_day", "Сцены", "День", "Если нажали → гасит искусственный свет (шторы — отдельной карточкой).", {
    loadKind: "light",
    fields: [{ key: "level", label: "Уровень света", unit: "%", def: 0 }],
  }),
  M("scene_evening", "Сцены", "Вечер", "Если нажали → вечерний свет на выбранных линиях.", {
    loadKind: "light",
    fields: [{ key: "level", label: "Уровень света", unit: "%", def: 60 }],
  }),
  M("scene_good_night", "Сцены", "Спокойной ночи", "Если нажали → гасит выбранный свет.", {
    loadKind: "light",
    fields: [{ key: "level", label: "Уровень света", unit: "%", def: 0 }],
  }),
  M("scene_kids_night", "Сцены", "Детский сон", "Если нажали → ночник на выбранных линиях.", {
    loadKind: "light",
    fields: [{ key: "level", label: "Уровень света", unit: "%", def: 5 }],
  }),
  M("scene_cinema", "Сцены", "Кино", "Если нажали → приглушает выбранный свет.", {
    loadKind: "light",
    fields: [{ key: "level", label: "Уровень света", unit: "%", def: 15 }],
  }),
  M("scene_dinner", "Сцены", "Ужин", "Если нажали → мягкий свет на выбранных линиях.", {
    loadKind: "light",
    fields: [{ key: "level", label: "Уровень света", unit: "%", def: 40 }],
  }),
  M("scene_guests", "Сцены", "Гости", "Если нажали → яркий свет на выбранных линиях.", {
    loadKind: "light",
    fields: [{ key: "level", label: "Уровень света", unit: "%", def: 100 }],
  }),
  M("scene_work", "Сцены", "Работа", "Если нажали → рабочий свет на выбранных линиях.", {
    loadKind: "light",
    fields: [{ key: "level", label: "Уровень света", unit: "%", def: 100 }],
  }),
  M("scene_relax", "Сцены", "Отдых", "Если нажали → приглушает выбранный свет.", {
    loadKind: "light",
    fields: [{ key: "level", label: "Уровень света", unit: "%", def: 25 }],
  }),
];

/** Витрина L1: только то, что реально льётся в wb-rules. */
export function deskSolutionCatalog() {
  return DESK_SOLUTION_CARDS.filter((c) => c.pour !== false);
}

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
  if (card.pour === false) return { ok: false, error: "not_pourable" };
  const trigger = contactOf(input?.trigger);
  if (card.needTrig !== false && !trigger) return { ok: false, error: "need_trigger" };
  let aux = null;
  if (card.needAux) {
    aux = contactOf(input?.aux);
    if (!aux) return { ok: false, error: "need_aux" };
  }
  const rawTargets = Array.isArray(input?.targets) ? input.targets : input?.target ? [input.target] : [];
  const targets = rawTargets.map(contactOf).filter(Boolean);
  if (!targets.length) return { ok: false, error: "need_target" };
  if (targets.some((t) => !isPourLoad(t.controlId))) return { ok: false, error: "need_load" };
  const doc = readDeskDocument();
  const id = String(input?.id ?? "").trim() || `sol_${Date.now().toString(36)}`;
  const params = {};
  for (const f of Array.isArray(card.fields) ? card.fields : []) {
    const raw = input?.params?.[f.key];
    if (f.kind === "select") {
      const opts = Array.isArray(f.options) ? f.options.map((o) => String(o.v)) : [];
      const v = String(raw ?? f.def ?? "");
      params[f.key] = opts.includes(v) ? v : String(f.def ?? opts[0] ?? "");
      continue;
    }
    const n = Number(raw);
    params[f.key] = Number.isFinite(n) ? n : Number(f.def);
  }
  const row = {
    id,
    solutionId: card.id,
    title: card.title,
    trigger: trigger || null,
    ...(aux ? { aux } : {}),
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
