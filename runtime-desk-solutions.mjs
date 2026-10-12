/**
 * Типовые на столе — тот же каталог, что в Связях. JSON рядом с разметкой, диск не пишем.
 * Telegram на контроллере нет.
 */
import fs from "node:fs";
import path from "node:path";
import { deskMarkingPath, readDeskDocument } from "./runtime-desk-marking.mjs";

const L = (id, cat, title, summary, extra = {}) => ({ id, cat, title, summary, multi: false, ...extra });
const M = (id, cat, title, summary, extra = {}) => L(id, cat, title, summary, { multi: true, ...extra });
const C = (id, cat, title, summary, extra = {}) => M(id, cat, title, summary, { needTrig: false, ...extra });

export const DESK_SOLUTION_CARDS = [
  L("light_button_toggle", "Свет", "Свет кнопкой — переключить", "Одиночное или двойное нажатие — вкл ↔ выкл. Удержание — карточка «Диммирование» на том же входе."),
  L("light_dim_hold_mcm", "Свет", "Диммирование (лента / MDM3 / WB-LED)", "Удержание — яркость↑ плавно, короткое+удержание — ↓. Вкл/выкл — «Свет кнопкой»."),
  L("custom_control_task", "Общее", "Иная задача", "Кнопка или датчик → любая нагрузка с заданным значением (0/1/100/STOP…)."),
  M("light_all_off", "Свет", "Мастер выключатель", "Кнопка гасит выбранный свет сразу; отдельно — реле с задержкой. Обычно удержание."),
  M("light_scene_on", "Сцены", "Сцена: включить несколько", "Кнопка всегда включает одну или несколько групп — кино, гости, общий свет."),
  L("light_motion", "Свет", "Свет по движению", "Датчик включает свет. Слоты — с этой шины."),
  L("light_night_path", "Свет", "Ночной путь / дежурный свет", "PIR или геркон — мягкий свет ночью. Для коридора и санузла."),
  M("stair_light_motion", "Свет", "Подсветка лестницы по зонам", "PIR включает свет лестницы; несколько зон в одной карточке. Второй PIR — опционально."),
  L("light_reed_on", "Свет", "Свет по геркону", "Открытие двери/окна включает свет."),
  L("socket_button_toggle", "Розетки", "Розетка кнопкой", "Управляемая розетка 230В — toggle. Топик как у реле света."),
  M("master_power_off_restore", "Свет", "Мастер OFF + восстановление", "Гасит выбранный свет и возвращает снимок. Кнопка + VD."),
  C("cron_presence_on", "Свет", "Имитация присутствия", "По расписанию включает свет — как будто дома."),
  C("cron_all_off", "Свет", "Ночью — всё OFF", "По расписанию гасит свет. Тихий час без ручного обхода."),
  C("outdoor_dusk_on", "Свет", "Улица: сумерки ON", "Вечерний cron включает уличный свет. Время можно сдвинуть."),
  C("outdoor_dawn_off", "Свет", "Улица: рассвет OFF", "Утренний cron гасит улицу."),
  C("anti_ice_cron_on", "Общее", "Антилёд: включить (cron)", "Греющий кабель / антиобледенение по расписанию ON."),
  C("anti_ice_cron_off", "Общее", "Антилёд: выключить (cron)", "Греющий кабель OFF по расписанию (утро / оттепель)."),
  L("ac_cool_comfort", "Климат", "Кондиционер по температуре", "Комната ≥ уставки → реле или шлюз кондея ON. Геркон окна — по желанию."),
  L("ac_window_off", "Климат", "Окно открыто — стоп кондея", "Геркон открыт → каналы кондея OFF. Обратно не включает."),
  L("thermostat_simple_vd", "Климат", "Термостат VD (уставка на контроллере)", "Виртуальный Termostat + гистерезис. Датчик → реле; уставка в VD."),
  C("rollers_evening", "Шторы", "Роллеты: вечер", "По расписанию закрывает роллеты/жалюзи. Проверьте полярность 0/1."),
  L("curtain_button_open", "Шторы", "Шторы: открыть кнопкой", "Кнопка открывает штору/роллету."),
  L("curtain_button_close", "Шторы", "Шторы: закрыть кнопкой", "Кнопка закрывает штору."),
  L("curtain_button_stop", "Шторы", "Шторы: стоп кнопкой", "Кнопка останавливает привод. Значение команды настраивается."),
  L("gate_button_open", "Общее", "Ворота: открыть кнопкой", "Кнопка открывает привод ворот / калитки."),
  L("gate_button_close", "Общее", "Ворота: закрыть кнопкой", "Кнопка закрывает ворота."),
  L("gate_button_stop", "Общее", "Ворота: стоп кнопкой", "Кнопка останавливает привод ворот."),
  C("curtain_dusk_close", "Шторы", "Шторы: вечер — закрыть", "По cron закрывает шторы. Payload закрытия — под мотор."),
  C("curtain_dawn_open", "Шторы", "Шторы: утро — открыть", "По cron открывает шторы. Значение открытия — в карточке."),
  L("vent_humidity", "Климат", "Вытяжка по влажности", "Выше порога — вытяжка ON; ниже порога − гистерезис — OFF."),
  L("vent_humidity_motion", "Климат", "Вытяжка: влажность и движение", "Вытяжка при высокой влажности и движении. Без движения — OFF."),
  L("vent_co2", "Климат", "Вентиляция по CO₂", "Выше порога CO₂ — приточка/форсаж ON; ниже − гистерезис — OFF."),
  L("vent_diy_vav", "Климат", "Приточка DIY / VAV", "CO₂ → реле мотора + обороты + заслонки. Калорифер только после пуска."),
  L("humidifier_low", "Климат", "Увлажнитель в диапазоне", "Влажность в диапазоне → увлажнитель ON. По умолчанию 40–55%."),
  L("warm_floor_comfort", "Климат", "Тёплый пол: комфорт", "Ниже уставки → насос/серво ON; выше + гистерезис → OFF."),
  L("warm_floor_electric_comfort", "Климат", "Тёплый пол электрический: комфорт", "DS18B20: ниже уставки → реле ON; выше + гистерезис → OFF."),
  L("warm_floor_water_comfort", "Климат", "Тёплый пол водяной: комфорт", "Датчик пола или воздуха: ниже уставки → насос/серво ON."),
  L("weather_climate_link", "Климат", "Погода → климат", "Улица ≥ порога °C → разрешить охлаждение/вентиляцию."),
  M("leak_close_valves", "Охрана", "Протечка — закрыть краны", "Датчик протечки → закрыть краны перекрытия. Несколько линий."),
  L("lock_button_set", "Охрана", "Замок кнопкой", "Кнопка подаёт команду на эл.мех. замок."),
  L("siren_motion", "Охрана", "Сирена по движению", "Датчик движения включает сирену/реле тревоги."),
  M("scene_away", "Сцены", "Не дома", "Гасит свет, розетки и закрывает шторы. Для телефона и голоса — та же кнопка."),
  M("scene_vacation", "Сцены", "В отпуске", "Как «Не дома» + eco-климат. Имитацию присутствия — отдельно cron."),
  M("scene_home", "Сцены", "Я дома", "Включает свет прихожей/зоны, открывает шторы и по желанию розетки."),
  M("scene_morning", "Сцены", "Утро", "Утренний свет + открытие штор."),
  M("scene_day", "Сцены", "День", "Естественный свет: шторы открыть, искусственный свет выключить."),
  M("scene_evening", "Сцены", "Вечер", "Вечерний свет ~60% + закрытие штор."),
  M("scene_good_night", "Сцены", "Спокойной ночи", "Гасит свет зоны и закрывает шторы."),
  M("scene_kids_night", "Сцены", "Детский сон", "Ночник ~5% + шторы закрыть."),
  M("scene_cinema", "Сцены", "Кино", "Приглушить зону ~15% + шторы закрыть."),
  M("scene_dinner", "Сцены", "Ужин", "Мягкий свет ~40% + шторы закрыть."),
  M("scene_guests", "Сцены", "Гости", "Яркий свет гостиной + шторы открыть."),
  M("scene_work", "Сцены", "Работа", "Рабочий свет + шторы открыть для дневного режима."),
  M("scene_relax", "Сцены", "Отдых", "Приглушённый свет ~25% + шторы закрыть."),
];

function contactOf(raw) {
  const deviceTopicKey = String(raw?.deviceTopicKey ?? "").trim();
  const controlId = String(raw?.controlId ?? "").trim();
  if (!/^wb-[a-z0-9._-]+$/i.test(deviceTopicKey)) return null;
  if (!controlId || controlId.length > 40) return null;
  return { deviceTopicKey, controlId };
}

function writeDoc(doc) {
  const file = deskMarkingPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ version: 3, shelves: doc.shelves || {}, solutions: doc.solutions || [] }, null, 2) + "\n",
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
  if (targets.some((t) => /^Input /i.test(t.controlId))) return { ok: false, error: "need_load" };
  const doc = readDeskDocument();
  const id = String(input?.id ?? "").trim() || `sol_${Date.now().toString(36)}`;
  const row = { id, solutionId: card.id, title: card.title, trigger: trigger || null, targets, savedAt: new Date().toISOString() };
  const next = doc.solutions.filter((s) => s.id !== id);
  next.push(row);
  writeDoc({ ...doc, solutions: next });
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
