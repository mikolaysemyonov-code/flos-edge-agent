/**
 * Типовые на столе. JSON рядом с разметкой, wb-rules не пишем.
 */
import fs from "node:fs";
import path from "node:path";
import { deskMarkingPath, readDeskDocument } from "./runtime-desk-marking.mjs";

export const DESK_SOLUTION_CARDS = [
  { id: "light_button_toggle", cat: "Свет", title: "Свет кнопкой — переключить", summary: "Одиночное или двойное нажатие — вкл ↔ выкл. Удержание — карточка «Диммирование» на том же входе.", multi: false },
  { id: "light_dim_hold_mcm", cat: "Свет", title: "Диммирование (лента / WB-LED)", summary: "Удержание — яркость↑. Вкл/выкл — «Свет кнопкой» на том же входе.", multi: false },
  { id: "light_all_off", cat: "Свет", title: "Мастер выключатель", summary: "Кнопка гасит выбранный свет сразу. Обычно удержание.", multi: true },
  { id: "light_motion", cat: "Свет", title: "Свет по движению", summary: "Датчик включает свет. Слоты — с этой шины.", multi: false },
  { id: "light_night_path", cat: "Свет", title: "Ночной путь / дежурный свет", summary: "PIR или геркон — мягкий свет ночью. Слоты с этой разметки.", multi: false },
  { id: "light_reed_on", cat: "Свет", title: "Свет по геркону", summary: "Открытие двери/окна включает свет.", multi: false },
  { id: "socket_button_toggle", cat: "Розетки", title: "Розетка кнопкой", summary: "Кнопка переключает розетку (как реле света).", multi: false },
  { id: "scene_away", cat: "Сцены", title: "Не дома", summary: "Одна кнопка гасит выбранные линии. Диск не пишем, пока не зальём.", multi: true },
  { id: "scene_vacation", cat: "Сцены", title: "В отпуске", summary: "Сцена на время отсутствия. Линии из этой разметки.", multi: true },
  { id: "scene_home", cat: "Сцены", title: "Я дома", summary: "Кнопка включает выбранный свет.", multi: true },
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
  if (!trigger) return { ok: false, error: "need_trigger" };
  const rawTargets = Array.isArray(input?.targets) ? input.targets : input?.target ? [input.target] : [];
  const targets = rawTargets.map(contactOf).filter(Boolean);
  if (!targets.length) return { ok: false, error: "need_target" };
  if (targets.some((t) => /^Input /i.test(t.controlId))) return { ok: false, error: "need_load" };
  const doc = readDeskDocument();
  const id = String(input?.id ?? "").trim() || `sol_${Date.now().toString(36)}`;
  const row = { id, solutionId: card.id, title: card.title, trigger, targets, savedAt: new Date().toISOString() };
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
