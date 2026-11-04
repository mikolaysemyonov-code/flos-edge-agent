/**
 * Обход выключателей: квартира/дом, комнаты с кодом, назначение клавиши.
 * Код: этаж × 100 + порядок на этаже. 1 этаж спальня 101, прихожая 102, 2 этаж спальня 201.
 */
import { patchDeskDocument, readDeskDocument, upsertDeskRoom } from "./runtime-desk-marking.mjs";

export const DESK_ROOM_CATALOG = [
  { group: "Жилые", names: ["Кухня", "Гостиная", "Спальня", "Детская", "Кабинет", "Гардероб", "Столовая", "Игровая", "Библиотека", "Кинозал"] },
  { group: "Мокрые", names: ["Ванная", "Душевая", "Гостевой санузел", "Туалет", "Постирочная", "Сауна"] },
  { group: "Проход", names: ["Прихожая", "Коридор", "Холл", "Лестница", "Тамбур"] },
  { group: "Улица", names: ["Балкон", "Лоджия", "Терраса", "Крыльцо", "Участок", "Гараж"] },
  { group: "Технические", names: ["Котельная", "Кладовая", "Подвал", "Щитовая", "Мастерская", "Серверная"] },
];

export const DESK_KEY_PURPOSES = [
  "Основной свет",
  "Люстра",
  "Бра",
  "Подсветка",
  "Ночник",
  "Рабочий свет",
  "Свет у зеркала",
  "Подсветка лестницы",
  "Улица",
  "Дежурный свет",
  "Сцена",
  "Мастер выкл",
  "Диммирование",
  "Шторы",
  "Ворота",
  "Розетка",
];

export function cleanDeskSite(value) {
  const kind = value?.kind === "house" || value?.kind === "flat" ? value.kind : "";
  let floors = Math.max(1, Math.min(9, Math.round(Number(value?.floors) || 1)));
  if (kind !== "house") floors = 1;
  return { kind, floors };
}

export function cleanRoomBook(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const codes = new Set();
  for (const raw of value) {
    const name = String(raw?.name || "").trim().replace(/\s+/g, " ").slice(0, 40);
    const floor = Math.max(1, Math.min(9, Math.round(Number(raw?.floor) || 1)));
    const code = String(raw?.code || "").trim();
    if (!name || !/^\d{3}$/.test(code) || codes.has(code)) continue;
    codes.add(code);
    out.push({ id: String(raw?.id || code), floor, name, code });
    if (out.length >= 80) break;
  }
  return out;
}

/** Следующий свободный код на этаже: 1 → 101, 102…; 2 → 201, 202… */
export function nextRoomCode(book, floor) {
  const f = Math.max(1, Math.min(9, Math.round(Number(floor) || 1)));
  const used = new Set((book || []).map((r) => String(r.code || "")));
  for (let n = 1; n <= 99; n += 1) {
    const code = String(f * 100 + n);
    if (!used.has(code)) return code;
  }
  return "";
}

function uniqueOnFloor(book, floor, name) {
  const hit = (n) => (book || []).some((r) => r.floor === floor && String(r.name).toLowerCase() === n.toLowerCase());
  if (!hit(name)) return name;
  let i = 2;
  while (hit(name + " " + i)) i += 1;
  return name + " " + i;
}

export function listDeskWalk() {
  const doc = readDeskDocument();
  return {
    site: cleanDeskSite(doc.site),
    roomBook: cleanRoomBook(doc.roomBook),
    roomCatalog: DESK_ROOM_CATALOG,
    purposes: DESK_KEY_PURPOSES,
  };
}

export function setDeskSite(input) {
  const site = cleanDeskSite(input);
  if (!site.kind) return { ok: false, error: "need_site" };
  const written = patchDeskDocument({ site });
  if (written?.ok === false) return written;
  return { ok: true, ...listDeskWalk() };
}

export function addDeskRoom(input) {
  const doc = readDeskDocument();
  const site = cleanDeskSite(doc.site);
  if (!site.kind) return { ok: false, error: "need_site" };
  const book = cleanRoomBook(doc.roomBook);
  let floor = Math.round(Number(input?.floor) || 1);
  if (site.kind !== "house") floor = 1;
  floor = Math.max(1, Math.min(site.floors, floor));
  const rawName = String(input?.name || "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (!rawName || /·/.test(rawName)) return { ok: false, error: "need_room" };
  const name = uniqueOnFloor(book, floor, rawName);
  const code = nextRoomCode(book, floor);
  if (!code) return { ok: false, error: "floor_full" };
  const room = { id: "rm_" + code, floor, name, code };
  const written = patchDeskDocument({ roomBook: [...book, room] });
  if (written?.ok === false) return written;
  upsertDeskRoom(name);
  return { ok: true, room, ...listDeskWalk() };
}
