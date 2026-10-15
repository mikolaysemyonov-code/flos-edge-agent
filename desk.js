    const $ = (id) => document.getElementById(id);
    let liveKeys = {};
    let pouredRules = [];
    let lastShelvesRows = [];
    let lastGapCount = 0;
    let lastPreview = { rows: [], gaps: [], ready: {}, reason: "" };
    const READY_BUCKETS = [
      { id: "light", ru: "Свет" },
      { id: "relays", ru: "Реле" },
      { id: "buttons", ru: "Кнопки" },
      { id: "scenes", ru: "Сценарии" },
    ];
    let activeTab = "mark";
    let markPath = "modules";
    let modFamily = "all";
    let openAssign = "";
    let deskCatalog = [];
    let deskSolutions = [];
    let cardFilter = "Свет";
    let showMoreLight = false;
    const L1_LIGHT = [
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
    let deskRooms = [];
    let markPending = {};
    let roomFilter = "";
    let openMod = "";
    let pouredPane = "send";
    let openPourMod = "";
    let lastReleases = [];
    let rollingBack = false;
    let canPourDesk = false;
    let canPourNamesDesk = false;
    let canPourRulesDesk = false;
    let canRepairDesk = false;
    let openSceneId = "";
    let openContact = "";
    let wantButtonFocus = false;
    let probeBusy = {};
    let listenUntil = 0;
    let listenTimer = 0;
    let listenAutoMod = "";
    const LED_TYPES = [
      "Световая линия",
      "Подсветка зеркала", "Подсветка ниши", "Подсветка полки",
      "Подсветка шкафа", "Подсветка плинтуса",
    ];
    const DALI_TYPES = [
      "DALI линия", "Точечные", "Люстра", "Подвес", "Потолочный", "Бра",
    ];
    const RELAY_TYPES = [
      "Свет 220 В", "Люстра", "Подвес", "Потолочный", "Точечные", "Трек",
      "Бра", "Торшер", "Гирлянда", "Ёлка",
      "Управляемая розетка",
      "Сервопривод 24 В", "Сервопривод 220 В",
      "Тёплый пол", "Насос", "Вытяжка", "Вентиляция", "Полотенцесушитель",
      "Клапан", "Замок", "Антилёд",
    ];
    const DRIVE_LABELS = ["Штора", "Роллета", "Жалюзи", "Тюль", "Экран"];
    const BUTTON_TYPES = ["Кнопка", "Клавиша", "Геркон", "Датчик движения", "Сценарий"];
    function isDeskDrive(id) {
      return /^(Curtain|Actuator) \d+ (Open|Close)$/i.test(String(id || "").trim());
    }
    function isDeskRelay(id) {
      return /^K\d+$/i.test(id) || isDeskDrive(id);
    }
    function isDeskLoad(id) {
      return /^(Channel \d+|K\d+)$/i.test(id) || isDeskDrive(id);
    }
    function isDeskInput(id, deviceTopicKey) {
      const c = String(id || "").trim();
      const key = String(deviceTopicKey || "").toLowerCase();
      if (/^Input\s+/i.test(c)) return true;
      if (/^EXT\d+_IN/i.test(c) || /^[A-D]\d+_IN/i.test(c)) return true;
      if (/mcm|wd14|mdi|gpio/i.test(key) && (/^IN/i.test(c) || /_IN/i.test(c)) && !/^K\d+$/i.test(c)) {
        return true;
      }
      return false;
    }
    function patchChannelValue(deviceTopicKey, controlId, lastValue) {
      lastShelvesRows = (lastShelvesRows || []).map((s) => {
        if (!s || s.deviceTopicKey !== deviceTopicKey) return s;
        return {
          ...s,
          channels: (s.channels || []).map((c) =>
            c && c.controlId === controlId ? { ...c, lastValue: lastValue } : c,
          ),
        };
      });
    }
    async function actuateChannel(deviceTopicKey, controlId, desired) {
      const key = contactKey(deviceTopicKey, controlId);
      if (probeBusy[key]) return { ok: false, error: "busy" };
      probeBusy[key] = true;
      renderMark();
      try {
        const r = await fetch("/runtime/desk-actuate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ deviceTopicKey: deviceTopicKey, controlId: controlId, desired: desired }),
        });
        const j = await r.json().catch(() => ({}));
        if (j && j.ok) {
          if (desired === "on") patchChannelValue(deviceTopicKey, controlId, j.value || "1");
          else if (desired === "off") patchChannelValue(deviceTopicKey, controlId, "0");
        }
        return j || { ok: false };
      } catch (_) {
        return { ok: false, error: "net" };
      } finally {
        delete probeBusy[key];
        renderMark();
      }
    }
    function startInputListen(ms) {
      listenUntil = Date.now() + (ms || 12000);
      if (listenTimer) clearInterval(listenTimer);
      const tick = () => {
        if (Date.now() > listenUntil) {
          clearInterval(listenTimer);
          listenTimer = 0;
          renderMark();
          return;
        }
        fetch("/runtime/mqtt-scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ durationMs: 900 }),
        })
          .then((r) => r.json())
          .then((j) => {
            if (j && j.ok && Array.isArray(j.shelves)) {
              lastShelvesRows = j.shelves;
              renderMark();
            }
          })
          .catch(() => {});
      };
      tick();
      listenTimer = setInterval(tick, 1100);
      renderMark();
    }
    function makeAppleSwitch(opts) {
      const on = Boolean(opts && opts.on);
      const busy = Boolean(opts && opts.busy);
      const live = Boolean(opts && opts.live);
      const disabled = Boolean(opts && opts.disabled) || busy;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "apple-sw" + (on ? " on" : "") + (busy ? " busy" : "") + (live ? " live" : "");
      btn.setAttribute("role", "switch");
      btn.setAttribute("aria-checked", on ? "true" : "false");
      btn.disabled = disabled;
      btn.title = opts && opts.title ? opts.title : (on ? "Вкл" : "Выкл");
      const knob = document.createElement("span");
      knob.className = "apple-knob";
      btn.appendChild(knob);
      if (typeof (opts && opts.onToggle) === "function" && !disabled) {
        btn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          opts.onToggle(!on);
        });
      }
      return btn;
    }
    function prettyControlId(id) {
      const m = /^(?:Curtain|Actuator)\s+(\d+)\s+(Open|Close)$/i.exec(String(id || "").trim());
      if (!m) return id;
      return "Привод " + m[1];
    }
    function driveTwin(controlId) {
      const m = /^((?:Curtain|Actuator)\s+\d+\s+)(Open|Close)$/i.exec(String(controlId || "").trim());
      if (!m) return "";
      return m[1] + (/open/i.test(m[2]) ? "Close" : "Open");
    }
    function isDriveClose(id) {
      return /^(Curtain|Actuator)\s+\d+\s+Close$/i.test(String(id || "").trim());
    }
    function pairOpenId(id) {
      const m = /^((?:Curtain|Actuator)\s+\d+\s+)Close$/i.exec(String(id || "").trim());
      return m ? m[1] + "Open" : id;
    }
    function visibleChannels(s) {
      return (s.channels || []).filter((ch) => !isDriveClose(ch.controlId));
    }
    function pairName(s, ch) {
      const name = String(ch.name || "").trim();
      if (name) return name;
      const twinId = driveTwin(ch.controlId);
      const twin = twinId && (s.channels || []).find((x) => x.controlId === twinId);
      return twin ? String(twin.name || "").trim() : "";
    }
    function markTypes(s, ch, isLoad) {
      if (isDeskDrive(ch.controlId)) return DRIVE_LABELS;
      if (/^K\d+$/i.test(ch.controlId)) return RELAY_TYPES;
      if (!isLoad) return BUTTON_TYPES;
      const k = String(s && s.deviceTopicKey || "");
      if (/dali/i.test(k)) return DALI_TYPES;
      return LED_TYPES;
    }
    const CARDS = [
      { id: "light_button_toggle", ru: "Переключение" },
      { id: "light_dim_hold_mcm", ru: "Дим-удержание" },
      { id: "light_all_off", ru: "Все выкл" },
    ];
    const ALL_OFF = "light_all_off";
    function exclusiveCards(ids) {
      const out = [...new Set(ids || [])].filter((id) => CARDS.some((c) => c.id === id));
      if (out.includes(ALL_OFF) && out.length > 1) return out.filter((id) => id !== ALL_OFF);
      return out;
    }
    function toggleDeskCard(selected, cardId) {
      if (cardId === ALL_OFF) {
        if (selected.has(ALL_OFF) && selected.size === 1) selected.clear();
        else {
          selected.clear();
          selected.add(ALL_OFF);
        }
      } else {
        selected.delete(ALL_OFF);
        if (selected.has(cardId)) selected.delete(cardId);
        else selected.add(cardId);
      }
    }
    function paintChips(chips, selected) {
      chips.querySelectorAll("[data-card]").forEach((btn) => {
        btn.setAttribute("aria-pressed", selected.has(btn.dataset.card) ? "true" : "false");
      });
    }
    function makeLoadChips(key, controlId, selected) {
      const chips = document.createElement("div");
      chips.className = "chips" + (selected.size === 0 ? " need" : "");
      chips.setAttribute("role", "group");
      chips.setAttribute("aria-label", "Типовая карточка");
      CARDS.forEach((card) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "chip";
        btn.dataset.card = card.id;
        btn.textContent = card.ru;
        btn.setAttribute("aria-pressed", selected.has(card.id) ? "true" : "false");
        btn.addEventListener("click", () => {
          toggleDeskCard(selected, card.id);
          paintChips(chips, selected);
          chips.classList.toggle("need", selected.size === 0);
          saveCards(key, controlId, [...selected]).catch(() => {});
        });
        chips.appendChild(btn);
      });
      return chips;
    }
    function busRu(mirror) {
      if (!mirror) return "Шина: —";
      const n = Number(mirror.topicCount) || 0;
      if (mirror.connected && n > 0) return "Шина ок · " + n + " топиков";
      if (mirror.connected) return "Шина: ждёт топики";
      return "Шина: нет MQTT";
    }
    function cloudRu(state) {
      if (state === "restored" || state === "online" || state === "enrolled_awaiting_heartbeat") {
        return "Облако ок";
      }
      if (state === "enrolling") return "Облако: подключаюсь";
      if (state === "enroll_failed" || state === "enroll_transient") return "Облако: нет связи";
      if (!state) return "Облако: —";
      return "Облако: " + state;
    }
    function humanPourError(raw) {
      const s = String(raw || "").trim();
      if (!s) return "Не залил";
      if (/Failed to fetch|NetworkError|ECONNREFUSED|fetch failed/i.test(s)) {
        return "Нет связи с агентом на этом адресе.";
      }
      if (/need_trigger/i.test(s)) return "В карточке нужна кнопка или датчик с шины.";
      if (/need_target|need_load/i.test(s)) return "В карточке нужна линия из разметки.";
      if (/EACCES|EROFS|EPERM|permission denied/i.test(s)) {
        return "Нет записи на диск щита (/etc/wb-rules).";
      }
      if (/wb.?rules|restart|pending_restart/i.test(s)) {
        return "Файлы записаны, но wb-rules не перезапустился — смотрите журнал на щите.";
      }
      if (/debounce|boot grace|self.update/i.test(s)) {
        return "Агент ещё стартует — подождите минуту и повторите.";
      }
      if (/tip|cloud pull|GitHub/i.test(s)) {
        return "Не скачал обновление с tip — проверьте интернет щита до сервиса (IPv4).";
      }
      if (s.length > 140) return s.slice(0, 137) + "…";
      return s;
    }
    function enrollRu(s, topics) {
      if (typeof topics === "number" && topics > 0) return "на связи";
      if (s === "restored" || s === "online" || s === "enrolled_awaiting_heartbeat") return "на связи";
      if (s === "enrolling") return "подключаюсь";
      if (s === "enroll_failed" || s === "enroll_transient") return "нет связи с облаком";
      return s || "—";
    }
    function kindRu(k) {
      if (k === "marking") return "разметка";
      if (k === "user") return "сценарий";
      return "ядро";
    }
    function contactLine(c) {
      return (c.label || c.deviceTopicKey) + " · " + c.controlId;
    }
    function familyOf(s) {
      const k = String(s.deviceTopicKey || "");
      if (/led|ampled|dali|mdm/i.test(k)) return "light";
      if (/mcm|gpio|mdi|mwac/i.test(k)) return "buttons";
      if (/mr6|mr12|mrm|mrps/i.test(k)) return "relays";
      return "";
    }
    function splitShelves(rows) {
      const out = { light: [], buttons: [], relays: [] };
      (rows || []).forEach((s) => {
        const f = familyOf(s);
        if (out[f]) out[f].push(s);
      });
      return out;
    }
    function closeModule() {
      if (!openMod) return;
      openMod = "";
      openAssign = "";
      markPending = {};
      renderMark();
    }
    function normalizeTab(tab) {
      if (tab === "light" || tab === "buttons" || tab === "relays" || tab === "all") {
        markPath = "modules";
        modFamily = tab === "buttons" ? "buttons" : tab === "relays" ? "relays" : tab === "all" ? "all" : "light";
        return "mark";
      }
      return tab;
    }
    function setTab(tab, keepMod) {
      tab = normalizeTab(tab);
      if (!/^(mark|cards|poured)$/.test(tab)) return;
      const was = activeTab;
      activeTab = tab;
      closeCardSheet();
      if (tab !== "poured") {
        openSceneId = "";
        openContact = "";
      } else if (was === "poured" && (openSceneId || openContact)) {
        openSceneId = "";
        openContact = "";
        renderReady();
      }
      if (!keepMod) closeModule();
      document.querySelectorAll(".tab").forEach((btn) => {
        btn.setAttribute("aria-selected", btn.dataset.tab === tab ? "true" : "false");
      });
      document.querySelectorAll(".panel").forEach((p) => {
        p.hidden = p.dataset.tab !== tab;
      });
      const ritual = $("ritual");
      if (ritual) {
        ritual.textContent = tab === "mark"
          ? "1 · Разметить → 2 · Типовые → 3 · Залить"
          : tab === "cards"
            ? "2 · Типовые → 3 · Залить"
            : "3 · Залить имена, потом сценарии";
      }
      if (tab === "mark") renderMark();
      if (tab === "cards") {
        paintCardsRoomBanner();
        renderDeskSolutions();
        renderVitrine();
      }
      if (location.hash.replace("#", "") !== tab) history.replaceState(null, "", "#" + tab);
    }
    function previewStatusRu(s) {
      if (s === "blocked") return "без имени — не зальём";
      if (s === "name") return "имя";
      if (s === "new_name") return "новое имя";
      if (s === "card") return "карточка";
      if (s === "no_card") return "нет карточки";
      return s;
    }
    function shelfLabel(key) {
      const s = lastShelvesRows.find((r) => r.deviceTopicKey === key);
      return (s && s.label) || key;
    }
    function previewRow(r, room) {
      const li = document.createElement("li");
      const left = document.createElement("div");
      const title = document.createElement("div");
      const label = room ? titleUnderRoom(r.name || "без имени", room) : (r.name || "без имени");
      title.textContent = label;
      const sub = document.createElement("div");
      sub.className = "meta";
      sub.textContent = shelfLabel(r.deviceTopicKey) + " · " + prettyControlId(r.controlId) +
        (r.pouredName && r.pouredName !== r.name ? " · на контроллере " + r.pouredName : "") +
        (r.pouredCards && r.pouredCards.length ? " · на контроллере " + r.pouredCards.join(" · ") : "");
      if (r.status === "blocked") sub.className = "meta orphan";
      left.appendChild(title);
      left.appendChild(sub);
      li.appendChild(left);
      const withChips = r.status === "no_card" || r.status === "card";
      if (withChips) {
        li.tabIndex = 0;
        li.setAttribute("role", "button");
        const go = () => jumpToContact(r.deviceTopicKey, r.controlId);
        li.addEventListener("click", go);
        li.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            go();
          }
        });
        const ru = new Set(r.cards || []);
        const selected = new Set(exclusiveCards(CARDS.filter((c) => ru.has(c.ru)).map((c) => c.id)));
        const chips = document.createElement("div");
        chips.className = "chips" + (selected.size === 0 ? " need" : "");
        chips.setAttribute("role", "group");
        chips.setAttribute("aria-label", "Типовая карточка");
        CARDS.forEach((card) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "chip";
          btn.dataset.card = card.id;
          btn.textContent = card.ru;
          btn.setAttribute("aria-pressed", selected.has(card.id) ? "true" : "false");
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            toggleDeskCard(selected, card.id);
            paintChips(chips, selected);
            chips.classList.toggle("need", selected.size === 0);
            saveCards(r.deviceTopicKey, r.controlId, [...selected]).then(() => {
              fetch("/runtime/mqtt-scan").then((res) => res.json()).then((j) => {
                if (j.ok && j.shelves) showShelves(j);
              }).catch(() => {});
            });
          });
          chips.appendChild(btn);
        });
        left.appendChild(chips);
      } else {
        const kind = document.createElement("span");
        kind.className = "kind";
        kind.textContent = previewStatusRu(r.status);
        li.appendChild(kind);
      }
      return li;
    }
    function renderPreview(j) {
      const ul = $("preview");
      const gapsUl = $("gaps");
      ul.innerHTML = "";
      gapsUl.innerHTML = "";
      const rows = j.rows || [];
      const gaps = j.gaps || [];
      canPourDesk = j.canPour === true;
      canPourNamesDesk = j.canPourNames === true;
      canPourRulesDesk = j.canPourRules === true;
      canRepairDesk = j.canRepair === true;
      paintPourButtons();
      const ready = j.ready || {};
      lastPreview = { rows: rows, gaps: gaps, ready: ready, reason: j.reason || "" };
      const head = $("previewHead");
      if (head) {
        head.hidden = true;
        head.style.color = "";
        head.textContent = "";
      }
      $("gapsHead").hidden = true;
      lastGapCount = gaps.length;
      renderReady();
      stampBusGaps();
    }
    function stampBusGaps() {
      const bus = $("bus");
      if (!bus) return;
      const base = bus.dataset.base;
      if (!base || !/модулей/.test(base)) return;
      bus.replaceChildren(base);
      if (!lastGapCount) return;
      const go = document.createElement("button");
      go.type = "button";
      go.className = "gapjump";
      go.textContent = lastGapCount + " без карточки";
      go.addEventListener("click", () => {
        setTab("poured");
        requestAnimationFrame(() => {
          const first = $("ready") && $("ready").querySelector("[data-contact]");
          (first || $("ready") || $("previewHead")).scrollIntoView({ block: "start" });
          if (first) first.focus();
        });
      });
      bus.append(" · ", go);
    }
    async function loadPreview() {
      try {
        const r = await fetch("/runtime/desk-pour-preview");
        const j = await r.json();
        if (!j.ok) {
          const head = $("previewHead");
          if (head) {
            head.hidden = false;
            head.style.color = "rgb(var(--bad))";
            head.textContent = humanPourError(j.error || "Нет превью");
          }
          return;
        }
        renderPreview(j);
      } catch (e) {
        const head = $("previewHead");
        if (head) {
          head.hidden = false;
          head.style.color = "rgb(var(--bad))";
          head.textContent = humanPourError(e && e.message);
        }
      }
    }
    function rowSlave(r) {
      const k = (r.contacts && r.contacts[0] && r.contacts[0].deviceTopicKey) || r.deviceTopicKey || "";
      const m = /_(\d+)$/.exec(k);
      return m ? Number(m[1]) : 0;
    }
    function rowCh(r) {
      const c = (r.contacts && r.contacts[0] && r.contacts[0].controlId) || r.controlId || "";
      return Number((/(\d+)\s*$/.exec(c) || [])[1] || 0);
    }
    function appendRoomList(ul, rows, roomFn, makeRow) {
      const roomOf = (r) => {
        const direct = roomFn(r);
        if (direct) return direct;
        const rooms = [...new Set(
          rows.filter((x) => x.deviceTopicKey === r.deviceTopicKey).map(roomFn).filter(Boolean),
        )];
        return rooms.length === 1 ? rooms[0] : "";
      };
      const minSlave = {};
      const minCh = {};
      rows.forEach((r) => {
        const room = roomOf(r);
        if (!room) return;
        const s = rowSlave(r);
        const c = rowCh(r);
        if (minSlave[room] == null || s < minSlave[room]) minSlave[room] = s;
        if (minCh[room] == null || c < minCh[room]) minCh[room] = c;
      });
      rows.sort((a, b) => {
        const ra = roomOf(a);
        const rb = roomOf(b);
        const sa = ra ? (minSlave[ra] ?? rowSlave(a)) : rowSlave(a);
        const sb = rb ? (minSlave[rb] ?? rowSlave(b)) : rowSlave(b);
        if (sa !== sb) return sa - sb;
        const ca = ra ? (minCh[ra] ?? rowCh(a)) : rowCh(a);
        const cb = rb ? (minCh[rb] ?? rowCh(b)) : rowCh(b);
        if (ca !== cb) return ca - cb;
        if (ra !== rb) return ra.localeCompare(rb, "ru");
        return rowCh(a) - rowCh(b);
      });
      let last = "";
      rows.forEach((r) => {
        const room = roomOf(r);
        if (room && room !== last) {
          const h = document.createElement("li");
          h.className = "roomh";
          h.textContent = room;
          ul.appendChild(h);
          last = room;
        }
        ul.appendChild(makeRow(r, room));
      });
    }
    function titleUnderRoom(title, room) {
      const parts = String(title || "").split(/\s*·\s*/).filter(Boolean);
      const roomLc = String(room || "").toLowerCase();
      const out = parts.filter((p) => p.toLowerCase() !== roomLc);
      return out.join(" · ") || title;
    }
    function previewHit(key, cid) {
      const want = contactKey(key, cid);
      const rows = lastPreview.rows || [];
      const gaps = lastPreview.gaps || [];
      return rows.find((r) => contactKey(r.deviceTopicKey, r.controlId) === want)
        || gaps.find((r) => contactKey(r.deviceTopicKey, r.controlId) === want)
        || null;
    }
    function roomFromContacts(contacts) {
      for (const c of contacts || []) {
        const s = lastShelvesRows.find((r) => r.deviceTopicKey === c.deviceTopicKey);
        const ch = s && (s.channels || []).find((x) => x.controlId === pairOpenId(c.controlId));
        const room = nameRoom(ch && (ch.name || pairName(s, ch)));
        if (room) return room;
      }
      return "";
    }
    function roomFromTitle(title) {
      const known = roomsFromBus();
      const parts = String(title || "").split(/\s*·\s*/).map((p) => prettyRoom(p)).filter(Boolean);
      return parts.find((p) => known.includes(p)) || "";
    }
    function readyBucket(key, cid, kind) {
      if (kind === "user") return "scenes";
      if (isDeskDrive(cid)) return "relays";
      const f = familyOf({ deviceTopicKey: key });
      if (f === "light" || f === "buttons" || f === "relays") return f;
      return "light";
    }
    function guessRoom(text) {
      const direct = nameRoom(text);
      if (direct) return direct;
      const known = roomsFromBus();
      const low = String(text || "").toLowerCase();
      return known.find((r) => low.includes(r.toLowerCase())) || "";
    }
    function sceneCardId(title, card) {
      const t = String(card || title || "");
      if (/дим/i.test(t)) return "light_dim_hold_mcm";
      if (/все выкл/i.test(t)) return "light_all_off";
      if (/розетк/i.test(t)) return "socket_button_toggle";
      return "light_button_toggle";
    }
    function sceneParts(contacts) {
      const loads = [];
      const buttons = [];
      (contacts || []).forEach((c) => {
        if (!c || !c.controlId) return;
        if (isDeskLoad(c.controlId)) {
          if (!isDriveClose(c.controlId)) loads.push({ ...c, controlId: pairOpenId(c.controlId) });
        } else buttons.push(c);
      });
      return { loads, buttons };
    }
    function sceneTitleRu(item) {
      const id = (item && item.solutionId) || sceneCardId(item && item.title, item && item.card);
      const hit = CARDS.find((c) => c.id === id);
      if (hit) return hit.ru;
      const first = String((item && (item.card || item.title)) || "").split(/\s*·\s*/)[0];
      return first || "Сценарий";
    }
    function uniqText(rows) {
      const seen = new Set();
      const out = [];
      (rows || []).forEach((n) => {
        const s = String(n || "").trim();
        if (!s || seen.has(s)) return;
        seen.add(s);
        out.push(s);
      });
      return out;
    }
    function loadListLabel(c) {
      const cid = pairOpenId(c.controlId);
      const want = contactKey(c.deviceTopicKey, cid);
      const hit = namedLoads().find((r) => contactKey(r.deviceTopicKey, r.controlId) === want);
      return hit ? hit.label : solContactLabel({ deviceTopicKey: c.deviceTopicKey, controlId: cid });
    }
    function contactOrd(item) {
      const s = String(item.controlId || "");
      let m = /^Channel (\d+)/i.exec(s);
      if (m) return [0, Number(m[1])];
      m = /^K(\d+)/i.exec(s);
      if (m) return [1, Number(m[1])];
      m = /^Input (\d+)/i.exec(s);
      if (m) return [2, Number(m[1])];
      return [8, 0];
    }
    function byContact(a, b) {
      const aa = contactOrd(a);
      const bb = contactOrd(b);
      if (aa[0] !== bb[0]) return aa[0] - bb[0];
      if (aa[1] !== bb[1]) return aa[1] - bb[1];
      return String(a.controlId || "").localeCompare(String(b.controlId || ""), "en", { numeric: true });
    }
    function sceneButtons(contacts) {
      const p = sceneParts(contacts);
      if (p.buttons.length) return p.buttons;
      const seen = new Set();
      const out = [];
      p.loads.forEach((load) => {
        pouredTriggersForLoad(load.deviceTopicKey, load.controlId).forEach((t) => {
          const k = contactKey(t.deviceTopicKey, t.controlId);
          if (seen.has(k)) return;
          seen.add(k);
          out.push(t);
        });
        deskSolutions.forEach((sol) => {
          const want = contactKey(load.deviceTopicKey, pairOpenId(load.controlId));
          if (!(sol.targets || []).some((x) => contactKey(x.deviceTopicKey, pairOpenId(x.controlId)) === want)) return;
          if (!sol.trigger) return;
          const k = contactKey(sol.trigger.deviceTopicKey, sol.trigger.controlId);
          if (seen.has(k)) return;
          seen.add(k);
          out.push(sol.trigger);
        });
      });
      return out;
    }
    function compactPhrase(names) {
      const groups = [];
      uniqText(names).forEach((n) => {
        const m = /^(.*?)(\d+)\s*$/.exec(n);
        if (!m) {
          groups.push({ text: n });
          return;
        }
        const stem = m[1].replace(/[\s·]+$/, "");
        const prev = groups[groups.length - 1];
        if (prev && prev.stem === stem) prev.nums.push(m[2]);
        else groups.push({ stem: stem, nums: [m[2]] });
      });
      return groups.map((g) => {
        if (!g.stem) return g.text;
        const nums = [...new Set(g.nums)].sort((a, b) => Number(a) - Number(b));
        return g.stem + " " + nums.join(" · ");
      }).join(" · ");
    }
    function triggerLine(t) {
      if (t && /^wb-gpio$/i.test(t.deviceTopicKey)) {
        return "GPIO · " + prettyControlId(t.controlId);
      }
      const sku = solContactLabel(t);
      const cid = prettyControlId(t.controlId);
      if (!cid) return sku;
      if (sku.includes(cid)) return sku;
      if (/^(Input |EXT|[A-D]\d+_IN)/i.test(String(t.controlId || ""))) return sku + " · " + cid;
      return sku;
    }
    function btnPrefixLine(line, room) {
      let s = String(line || "").trim();
      if (room) s = titleUnderRoom(s, room) || s;
      s = s.replace(/^(кнопка|клавиша)(?:\s*·\s*|$)/i, "").trim() || s;
      return s;
    }
    function btnHint(line, room) {
      const s = btnPrefixLine(line, room);
      if (!s) return "кнопка · нет в разметке";
      if (/^GPIO\b/i.test(s)) return s;
      return "кнопка · " + s;
    }
    function fileRu(n) {
      const x = Number(n) || 0;
      const m = Math.abs(x) % 100;
      const d = m % 10;
      const w = m > 10 && m < 20 ? "файлов" : d === 1 ? "файл" : d > 1 && d < 5 ? "файла" : "файлов";
      return x + " " + w;
    }
    /** Имена шардов → коротко для монтажника, без 00_core.js. */
    function releaseWhatRu(rel) {
      const files = (rel && rel.files) || [];
      const names = files.map((f) => String(f || "").toLowerCase());
      const hasCore = names.some((f) => /00_core\.js$/.test(f));
      const hasUser = names.some((f) => /40_rules_user\.js$/.test(f));
      if (hasCore && hasUser) return "имена и сценарии";
      if (hasUser) return "сценарии";
      if (hasCore) return "имена";
      const n = rel && (rel.fileCount || names.length);
      return n ? fileRu(n) : "";
    }
    function markTitle(item, room) {
      let t = room ? titleUnderRoom(item.title, room) : item.title;
      if (item.scene || item.isLoad || !item.controlId) return t;
      const cid = prettyControlId(item.controlId);
      if (cid && t && !t.includes(cid)) return t + " · " + cid;
      return t;
    }
    function otherBindLine(exceptLoads) {
      const skip = contactSet(exceptLoads);
      let best = null;
      (lastShelvesRows || []).forEach((s) => {
        (s.channels || []).forEach((ch) => {
          if (isDeskLoad(ch.controlId)) return;
          const binds = Array.isArray(ch.binds) ? ch.binds : [];
          const hit = binds.find((b) => !skip.has(contactKey(b.deviceTopicKey, pairOpenId(b.controlId))));
          if (!hit) return;
          const gpio = /^wb-gpio$/i.test(s.deviceTopicKey);
          const trig = gpio
            ? "GPIO · " + prettyControlId(ch.controlId)
            : triggerLine({ deviceTopicKey: s.deviceTopicKey, controlId: ch.controlId });
          const load = loadListLabel(hit) || solContactLabel(hit);
          const room = nameRoom(load);
          const short = room ? (titleUnderRoom(load, room) || load) : load;
          const row = { gpio: gpio, text: trig + " · " + (room ? room + " · " + short : short) };
          if (row.gpio || !best) best = row;
        });
      });
      return best ? best.text : "";
    }
    function missingButtonText(item) {
      const loads = item && item.scene ? sceneParts(item.contacts).loads
        : (item && item.isLoad ? [{ deviceTopicKey: item.deviceTopicKey, controlId: item.controlId }] : []);
      const busy = otherBindLine(loads);
      return busy ? "кнопка на другой линии · " + busy : "кнопка · нет в разметке";
    }
    function sceneLines(contacts, room) {
      const p = sceneParts(contacts);
      const buttons = sceneButtons(contacts);
      const btn = uniqText(buttons.map(triggerLine)).join(" · ");
      const lights = compactPhrase(p.loads.map((c) => {
        const n = loadListLabel(c);
        return room ? (titleUnderRoom(n, room) || n) : n;
      })) || "нет света";
      return { btn: btn, lights: lights };
    }
    function sceneKey(item) {
      return String((item && (item.id || item.deskId)) || "");
    }
    function sameContact(a, b) {
      if (!a || !b) return false;
      return contactKey(a.deviceTopicKey, pairOpenId(a.controlId)) ===
        contactKey(b.deviceTopicKey, pairOpenId(b.controlId));
    }
    function contactSet(rows) {
      return new Set((rows || []).map((c) => contactKey(c.deviceTopicKey, pairOpenId(c.controlId))).sort());
    }
    function sceneEqualsSol(item, sol) {
      if (!sol) return false;
      const p = sceneParts(item.contacts);
      if (sceneCardId(item.title, item.card) !== sol.solutionId) return false;
      const trigOk = !p.buttons.length ? !sol.trigger
        : p.buttons.some((b) => sameContact(b, sol.trigger));
      if (!trigOk) return false;
      const a = [...contactSet(p.loads)].join("|");
      const b = [...contactSet(sol.targets)].join("|");
      return a === b;
    }
    function matchDeskSol(item, used) {
      const card = sceneCardId(item.title, item.card);
      const p = sceneParts(item.contacts);
      return deskSolutions.find((sol) => {
        if (used.has(sol.id)) return false;
        if (sol.solutionId !== card) return false;
        if (p.buttons.some((b) => sameContact(b, sol.trigger))) return true;
        const a = [...contactSet(p.loads)].join("|");
        const b = [...contactSet(sol.targets)].join("|");
        return a && a === b;
      }) || null;
    }
    function uniqContacts(rows) {
      const seen = new Set();
      return (rows || []).filter((c) => {
        if (!c || !c.controlId) return false;
        const k = contactKey(c.deviceTopicKey, pairOpenId(c.controlId));
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    function pairLoadKey(contacts) {
      const k = [...contactSet(sceneParts(contacts).loads)].join("|");
      return k || "";
    }
    function mergeScenePairs(raw) {
      const map = new Map();
      (raw || []).forEach((item) => {
        const lk = pairLoadKey(item.contacts) || ("id:" + sceneKey(item));
        let g = map.get(lk);
        if (!g) {
          g = {
            id: "pair:" + lk,
            scene: true,
            bucket: "scenes",
            isLoad: false,
            contacts: [],
            cardsOn: [],
            deskByCard: {},
            deskDirty: false,
            room: "",
          };
          map.set(lk, g);
        }
        g.contacts = g.contacts.concat(item.contacts || []);
        const cid = item.solutionId || sceneCardId(item.title, item.card);
        if (cid && !g.cardsOn.includes(cid)) g.cardsOn.push(cid);
        if (item.deskId && cid) g.deskByCard[cid] = item.deskId;
        if (item.deskDirty) g.deskDirty = true;
        if (!g.room) g.room = item.room || "";
      });
      return [...map.values()].map((g) => {
        g.contacts = uniqContacts(g.contacts);
        const loads = sceneParts(g.contacts).loads;
        g.room = roomFromContacts(loads) || g.room;
        const lines = sceneLines(g.contacts, g.room);
        g.btnLine = lines.btn;
        g.lightLine = lines.lights;
        g.title = lines.lights || "Сценарий";
        g.card = g.cardsOn.map((id) => {
          const hit = CARDS.find((c) => c.id === id);
          return hit ? hit.ru : "";
        }).filter(Boolean).join(" · ");
        g.deskId = g.deskByCard[g.cardsOn[0]] || "";
        return g;
      });
    }
    function pourLane(item) {
      if (item.scene) return item.deskDirty ? "send" : "disk";
      const s = item.status;
      // card — тоже «Новое»: иначе смена жеста не видна до заливки.
      if (s === "new_name" || s === "name" || s === "blocked" || s === "card") return "send";
      return "disk";
    }
    function clearDeskItem(item) {
      if (!item) return Promise.resolve();
      if (item.scene) {
        const id = item.deskId || (item.deskByCard && item.cardsOn && item.deskByCard[item.cardsOn[0]]) || "";
        if (!id) return Promise.resolve();
        return fetch("/runtime/desk-solutions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ delete: id }),
        }).then(() => loadSolutions()).then(() => loadPreview());
      }
      if (!item.deviceTopicKey || !item.controlId) return Promise.resolve();
      const jobs = [
        saveName(item.deviceTopicKey, item.controlId, ""),
        saveCards(item.deviceTopicKey, item.controlId, []),
      ];
      const twin = isDeskDrive(item.controlId) ? driveTwin(item.controlId) : "";
      if (twin) {
        jobs.push(saveName(item.deviceTopicKey, twin, ""));
        jobs.push(saveCards(item.deviceTopicKey, twin, []));
      }
      return Promise.all(jobs).then(() => loadLast());
    }
    function loadNeedsButton(item) {
      if (!item || item.scene || !item.isLoad || item.btnLine) return false;
      if (pourLane(item) === "send") return false;
      if (!(item.hints || []).includes("Все выкл")) return false;
      return false;
    }
    function isNewItem(item) {
      return pourLane(item) === "send";
    }
    function laneRu(item) {
      if (item && item.status === "blocked") return "блок";
      return isNewItem(item) ? "новое" : "на контроллере";
    }
    function collectReadyItems() {
      const items = [];
      (lastShelvesRows || []).forEach((s) => {
        visibleChannels(s).forEach((ch) => {
          const name = pairName(s, ch);
          const hints = Array.isArray(ch.hints) ? ch.hints : [];
          const cards = Array.isArray(ch.cards) ? ch.cards : [];
          if (!name && !hints.length && !cards.length) return;
          const prev = previewHit(s.deviceTopicKey, ch.controlId);
          const title = name ? prettyContactName(name) : prettyControlId(ch.controlId);
          const isLoad = isDeskLoad(ch.controlId);
          const room = guessRoom(name) || guessRoom(prev && prev.pouredName) || "";
          const sku = s.label || s.deviceTopicKey;
          items.push({
            room: room,
            bucket: readyBucket(s.deviceTopicKey, ch.controlId),
            title: title,
            sku: sku,
            sub: sku + " · " + prettyControlId(ch.controlId),
            deviceTopicKey: s.deviceTopicKey,
            controlId: ch.controlId,
            cards: cards,
            hints: hints,
            isLoad: isLoad,
            btnLine: "",
            status: prev && prev.status,
            pouredName: prev && prev.pouredName,
          });
        });
      });
      const usedSol = new Set();
      const rawScenes = [];
      pouredRules.filter((r) => r.kind === "user").forEach((r) => {
        const loads = sceneParts(r.contacts).loads;
        const room = roomFromContacts(loads) || roomFromTitle(r.title) || guessRoom(r.title) || "";
        const item = {
          id: r.id,
          room: room,
          title: r.title,
          card: r.card,
          contacts: r.contacts,
        };
        const sol = matchDeskSol(item, usedSol);
        if (sol) {
          usedSol.add(sol.id);
          item.deskId = sol.id;
          item.deskDirty = !sceneEqualsSol(item, sol);
        }
        rawScenes.push(item);
      });
      deskSolutions.forEach((sol) => {
        if (usedSol.has(sol.id)) return;
        const contacts = [sol.trigger].concat(sol.targets || []).filter(Boolean);
        rawScenes.push({
          id: sol.id,
          deskId: sol.id,
          room: roomFromContacts(sceneParts(contacts).loads) || roomFromContacts(contacts) || "",
          title: sol.title,
          solutionId: sol.solutionId,
          contacts: contacts,
          deskDirty: true,
        });
      });
      mergeScenePairs(rawScenes).forEach((g) => items.push(g));
      return items;
    }
    function paneItems(items) {
      if (pouredPane === "hist") return [];
      if (pouredPane === "rules") return items.filter((i) => i.scene);
      if (pouredPane === "send") return items.filter((i) => pourLane(i) === "send");
      return items.filter((i) => !i.scene);
    }
    function relWhen(iso) {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "";
      const p = (n) => (n < 10 ? "0" : "") + n;
      return p(d.getDate()) + "." + p(d.getMonth() + 1) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
    }
    function renderHistory(box) {
      const back = document.createElement("button");
      back.type = "button";
      back.className = "back";
      back.setAttribute("aria-label", "К разметке");
      back.innerHTML = "<svg viewBox='0 0 24 24'><path d='M15 18l-6-6 6-6'/></svg><span>К разметке</span>";
      back.addEventListener("click", () => {
        pouredPane = "send";
        openPourMod = "";
        renderReady();
      });
      back.querySelector("span").textContent = "К новому";
      box.appendChild(back);
      if (!lastReleases.length) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = "Пока нет заливок. Первая появится после «1 · Имена» или «2 · Сценарии».";
        box.appendChild(empty);
        return;
      }
      const ul = document.createElement("ul");
      ul.className = "channels";
      lastReleases.forEach((rel) => {
        const li = document.createElement("li");
        const cap = document.createElement("div");
        cap.className = "ch-cap";
        const top = document.createElement("div");
        top.className = "vtop";
        const left = document.createElement("div");
        const ttl = document.createElement("div");
        ttl.className = "ttl";
        // f36878e3 · 13.10 — коротко; полный fnv1a32:… в title для отладки
        const short =
          rel.label ||
          [rel.shortId || String(rel.revisionId || "").replace(/^fnv1a32:/i, "").slice(0, 8), rel.dayLabel]
            .filter(Boolean)
            .join(" · ") ||
          String(rel.revisionId || "");
        ttl.textContent = short;
        ttl.title = String(rel.revisionId || "");
        const hint = document.createElement("span");
        hint.className = "hint";
        const parent = lastReleases.find((p) => p.revisionId === rel.parentId);
        const parentShort = rel.parentShortId || (parent && (parent.shortId || parent.label)) || "";
        const caret = rel.current && (parentShort || rel.parentId) ? "^ " + (parentShort || rel.parentId) : "";
        const when = relWhen(rel.savedAt);
        const timeOnly = when.includes(" ") ? when.split(" ").slice(1).join(" ") : when;
        const sameWhen = rel.current && parent && relWhen(rel.savedAt) === relWhen(parent.savedAt);
        hint.textContent = [sameWhen ? "" : timeOnly, caret, releaseWhatRu(rel)].filter(Boolean).join(" · ");
        left.append(ttl, hint);
        const st = document.createElement("span");
        st.className = "st" + (rel.current ? " ok" : "");
        st.textContent = rel.current ? "Сейчас" : "Было";
        top.append(left, st);
        cap.appendChild(top);
        li.appendChild(cap);
        if (!rel.current) {
          const go = document.createElement("button");
          go.type = "button";
          go.className = "ghost roll-back";
          go.textContent = rollingBack ? "Ждите…" : "Вернуть";
          go.disabled = rollingBack;
          go.title = rollingBack
            ? "Идёт откат — подождите"
            : "Вернуть правила на щит к этому состоянию. История журнала не стирается.";
          go.addEventListener("click", () => {
            if (rollingBack) return;
            const label = short || rel.revisionId || "эту заливку";
            if (!window.confirm("Вернуть на щит состояние «" + label + "»?\nТекущие правила с диска будут заменены. Журнал останется.")) {
              return;
            }
            rollingBack = true;
            document.querySelectorAll("button.roll-back").forEach((b) => {
              b.disabled = true;
              b.textContent = "Ждите…";
            });
            go.textContent = "Возвращаю…";
            fetch("/runtime/rollback?revisionId=" + encodeURIComponent(rel.revisionId), { method: "POST" })
              .then((r) => r.json())
              .then((j) => {
                rollingBack = false;
                if (!j || (j.status !== "applied" && !j.ok)) {
                  const err = humanPourError((j && (j.error || (j.reasons || []).join(" · "))) || "Не вернул");
                  const head = $("previewHead");
                  if (head) {
                    head.style.color = "rgb(var(--bad))";
                    head.textContent = err;
                  }
                  renderReady();
                  return;
                }
                const head = $("previewHead");
                if (head) {
                  head.style.color = "";
                  head.textContent = "Откат выполнен · " + label;
                }
                loadPoured();
                loadReleases().then(() => renderReady());
              })
              .catch((e) => {
                rollingBack = false;
                const err = humanPourError(e && e.message);
                const head = $("previewHead");
                if (head) {
                  head.style.color = "rgb(var(--bad))";
                  head.textContent = err;
                }
                renderReady();
              });
          });
          li.appendChild(go);
        }
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }
    function closeScene() {
      if (!openSceneId) return;
      openSceneId = "";
      renderReady();
    }
    function closeContact() {
      if (!openContact) return;
      openContact = "";
      renderReady();
    }
    function pouredOpen() {
      return !!(openSceneId || openContact || openPourMod);
    }
    function closePourMod() {
      if (!openPourMod) return;
      openPourMod = "";
      renderReady();
    }
    function pourLiveCh(key, controlId) {
      const shelf = lastShelvesRows.find((s) => s.deviceTopicKey === key);
      return (shelf && (shelf.channels || []).find((c) => c.controlId === controlId)) || { controlId: controlId };
    }
    function pourModuleTile(sku, key, chunk) {
      const n = chunk.length;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "vcard sky on";
      const top = document.createElement("div");
      top.className = "vtop";
      const ico = document.createElement("span");
      ico.className = "ico";
      const shelf = lastShelvesRows.find((s) => s.deviceTopicKey === key);
      ico.innerHTML = MOD_ICO[moduleKind(shelf || { deviceTopicKey: key })] || MOD_ICO.led;
      const cat = document.createElement("span");
      cat.className = "cat on";
      cat.textContent = n + " к заливке";
      top.append(ico, cat);
      const vt = document.createElement("span");
      vt.className = "vt";
      vt.textContent = sku || key;
      const vs = document.createElement("span");
      vs.className = "vs";
      const rooms = [...new Set(chunk.map((i) => i.room).filter(Boolean))];
      vs.textContent = rooms.length ? rooms.join(" · ") : "имена / карточки";
      const bars = document.createElement("div");
      bars.className = "ch-bars";
      bars.setAttribute("aria-hidden", "true");
      let lit = 0;
      chunk.forEach((i) => {
        const on = channelIsOn(pourLiveCh(key, i.controlId));
        if (on) lit += 1;
        const b = document.createElement("span");
        b.className = "ch-bar" + (on ? " lit" : i.status === "blocked" ? "" : " named");
        bars.appendChild(b);
      });
      if (lit) btn.classList.add("amber", "lit");
      const foot = document.createElement("div");
      foot.className = "mod-foot";
      const open = document.createElement("span");
      open.className = "mod-open";
      open.textContent = "Открыть";
      const badge = document.createElement("span");
      badge.className = "mod-badge" + (lit ? " lit" : "");
      badge.textContent = lit ? ("Горит " + lit) : "Новое";
      foot.append(open, badge);
      btn.append(top, vt, vs, bars, foot);
      btn.addEventListener("click", () => {
        openPourMod = key;
        openContact = "";
        openSceneId = "";
        renderReady();
      });
      return btn;
    }
    function paintSendByModule(box, items) {
      const loads = items.filter((i) => !i.scene);
      const scenes = items.filter((i) => i.scene);
      if (openPourMod) {
        const chunk = loads.filter((i) => i.deviceTopicKey === openPourMod);
        const shelf = lastShelvesRows.find((s) => s.deviceTopicKey === openPourMod);
        const sku = (chunk[0] && chunk[0].sku) || (shelf && shelf.label) || openPourMod;
        box.className = "modopen";
        const back = document.createElement("button");
        back.type = "button";
        back.className = "back ghost-back";
        back.innerHTML = "<svg viewBox='0 0 24 24'><path d='M15 18l-6-6 6-6'/></svg><span>Все модули</span>";
        back.addEventListener("click", closePourMod);
        const head = document.createElement("div");
        head.className = "vcard sky on";
        const top = document.createElement("div");
        top.className = "vtop";
        const ico = document.createElement("span");
        ico.className = "ico";
        ico.innerHTML = MOD_ICO[moduleKind(shelf || { deviceTopicKey: openPourMod })] || MOD_ICO.led;
        const cat = document.createElement("span");
        cat.className = "cat on";
        cat.textContent = chunk.length + " к заливке";
        top.append(ico, cat);
        const vt = document.createElement("span");
        vt.className = "vt";
        vt.textContent = sku;
        const vs = document.createElement("span");
        vs.className = "vs";
        vs.textContent = "Имена на щит · кнопка «1 · Имена» выше";
        const bars = document.createElement("div");
        bars.className = "ch-bars";
        bars.setAttribute("aria-hidden", "true");
        let lit = 0;
        chunk.forEach((i) => {
          const on = channelIsOn(pourLiveCh(openPourMod, i.controlId));
          if (on) lit += 1;
          const b = document.createElement("span");
          b.className = "ch-bar" + (on ? " lit" : i.status === "blocked" ? "" : " named");
          bars.appendChild(b);
        });
        if (lit) head.classList.add("amber", "lit");
        const pills = document.createElement("div");
        pills.className = "mod-pills";
        const occ = document.createElement("span");
        occ.className = "mod-pill";
        occ.textContent = chunk.length + " новое";
        const bus = document.createElement("span");
        bus.className = "mod-pill" + (lit ? " lit" : " on");
        bus.textContent = lit ? ("Горит " + lit) : "На шине";
        pills.append(occ, bus);
        head.append(top, vt, vs, bars, pills);
        const tip = document.createElement("p");
        tip.className = "meta";
        const blocked = chunk.filter((i) => i.status === "blocked").length;
        tip.textContent = blocked
          ? ("Блок · " + blocked + " без имени — дайте имя в «Разметить» или «Снять».")
          : (chunk.length ? "Проверьте каналы, затем «1 · Имена»." : "В этом модуле нового нет.");
        const ul = document.createElement("ul");
        ul.className = "channels drill-list";
        chunk.slice().sort(byContact).forEach((i) => ul.appendChild(readyCard(i, i.room)));
        box.append(back, head, tip, ul);
        return;
      }
      box.className = "vitrine";
      const byMod = new Map();
      loads.forEach((i) => {
        const k = i.deviceTopicKey || "";
        if (!byMod.has(k)) byMod.set(k, []);
        byMod.get(k).push(i);
      });
      const keys = [...byMod.keys()].sort((a, b) => {
        const sa = lastShelvesRows.find((s) => s.deviceTopicKey === a);
        const sb = lastShelvesRows.find((s) => s.deviceTopicKey === b);
        return moduleSlaveOf(sa || { deviceTopicKey: a }) - moduleSlaveOf(sb || { deviceTopicKey: b })
          || String(a).localeCompare(String(b));
      });
      keys.forEach((k) => {
        const chunk = byMod.get(k) || [];
        const sku = (chunk[0] && chunk[0].sku) || k;
        box.appendChild(pourModuleTile(sku, k, chunk));
      });
      if (scenes.length) {
        const h = document.createElement("p");
        h.className = "sech";
        h.textContent = "Сценарии · " + scenes.length;
        box.appendChild(h);
        const ul = document.createElement("ul");
        ul.className = "channels";
        scenes.slice().sort(byContact).forEach((i) => ul.appendChild(readyCard(i, i.room)));
        box.appendChild(ul);
      }
    }
    function readyCard(item, room) {
      const li = document.createElement("li");
      const go = item.scene
        ? () => {
            openContact = "";
            openSceneId = sceneKey(item);
            pouredPane = "rules";
            renderReady();
          }
        : (item.deviceTopicKey && item.controlId)
          ? () => jumpToContact(item.deviceTopicKey, item.controlId)
          : null;
      if (go) {
        if (!item.scene && item.deviceTopicKey) {
          li.dataset.contact = contactKey(item.deviceTopicKey, item.controlId);
        }
        li.tabIndex = 0;
        li.addEventListener("click", go);
        li.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            go();
          }
        });
      }
      const cap = document.createElement("div");
      cap.className = "ch-cap";
      const top = document.createElement("div");
      top.className = "vtop";
      const left = document.createElement("div");
      const ttl = document.createElement("div");
      ttl.className = "ttl";
      const ttlText = markTitle(item, room);
      ttl.textContent = ttlText;
      if (item.scene) {
        const missing = !item.btnLine;
        const btn = missing ? document.createElement("button") : document.createElement("span");
        btn.className = "hint" + (missing ? " orphan" : "");
        btn.textContent = missing ? missingButtonText(item) : btnHint(item.btnLine, room);
        if (missing) {
          btn.type = "button";
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const load = sceneParts(item.contacts).loads[0];
            if (!load) return;
            openButtonOnLoad(load.deviceTopicKey, load.controlId);
          });
        }
        left.append(ttl, btn);
      } else {
        const hint = document.createElement("span");
        hint.className = "hint";
        const cid = prettyControlId(item.controlId);
        const skuBit = (cid && ttlText && ttlText.includes(cid)) ? (item.sku || "") : item.sub;
        const bits = [skuBit];
        if (item.pouredName && item.title && prettyContactName(item.pouredName) !== prettyContactName(item.title)) {
          bits.push("на контроллере " + prettyContactName(item.pouredName));
        }
        if (item.status === "blocked") hint.classList.add("orphan");
        hint.textContent = bits.filter(Boolean).join(" · ");
        left.append(ttl, hint);
        if (item.btnLine) {
          const b = document.createElement("span");
          b.className = "hint";
          b.textContent = btnHint(item.btnLine, room);
          left.appendChild(b);
        } else if (loadNeedsButton(item)) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "hint orphan";
          b.textContent = missingButtonText(item);
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            openButtonOnLoad(item.deviceTopicKey, item.controlId);
          });
          left.appendChild(b);
        }
      }
      const st = document.createElement("span");
      const lane = pourLane(item);
      st.className = "st" + (item.status === "blocked" ? "" : lane === "send" ? " send" : " ok");
      st.textContent = laneRu(item);
      top.append(left, st);
      cap.appendChild(top);
      li.appendChild(cap);
      if (lane === "send") {
        const drop = document.createElement("button");
        drop.type = "button";
        drop.className = "ghost";
        drop.textContent = item.scene ? "Снять" : (item.pouredName ? "Как на щите" : "Снять");
        drop.title = item.scene
          ? "Убрать сценарий со стола"
          : (item.pouredName ? "Вернуть имя с контроллера" : "Убрать имя со стола");
        drop.addEventListener("click", (e) => {
          e.stopPropagation();
          drop.disabled = true;
          clearDeskItem(item).catch(() => { drop.disabled = false; });
        });
        li.appendChild(drop);
      }
      if (item.scene && item.cardsOn && item.cardsOn.length) {
        const chips = document.createElement("div");
        chips.className = "chips";
        CARDS.forEach((card) => {
          const span = document.createElement("span");
          span.className = "chip";
          span.textContent = card.ru;
          span.setAttribute("aria-pressed", item.cardsOn.includes(card.id) ? "true" : "false");
          chips.appendChild(span);
        });
        li.appendChild(chips);
      }
      return li;
    }
    function renderPouredTabs() {
      const bar = $("pouredTabs");
      if (!bar) return;
      const all = collectReadyItems();
      const sendN = all.filter((i) => pourLane(i) === "send").length;
      const diskN = all.filter((i) => pourLane(i) === "disk").length;
      // Как Vercel: новое → залить; сценарии на щите; журнал откатов. Без лишней «Разметки».
      const tabs = [
        { id: "send", ru: "Новое" + (sendN ? " · " + sendN : "") },
        { id: "rules", ru: "Сценарии" },
        { id: "hist", ru: "Журнал" + (lastReleases.length ? " · " + lastReleases.length : "") },
      ];
      if (!tabs.some((t) => t.id === pouredPane)) pouredPane = "send";
      bar.hidden = pouredOpen();
      bar.replaceChildren();
      tabs.forEach((t) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = t.ru;
        b.setAttribute("aria-pressed", pouredPane === t.id ? "true" : "false");
        b.addEventListener("click", () => {
          if (t.id !== "rules") openSceneId = "";
          openContact = "";
          openPourMod = "";
          pouredPane = t.id;
          renderReady();
        });
        bar.appendChild(b);
      });
      paintPourButtons();
      $("n-poured").textContent = sendN || "";
    }
    function paintPourButtons() {
      const wrap = $("pourWrap");
      const hint = $("pourHint");
      const sum = $("pourSummary");
      if (!wrap) return;
      const show = (pouredPane === "send" || pouredPane === "hist") && !pouredOpen();
      wrap.hidden = !show;
      const sendN = collectReadyItems().filter((i) => pourLane(i) === "send").length;
      const solN = deskSolutions.length;
      if (sum) {
        if (show && pouredPane === "send") {
          sum.hidden = false;
          const parts = [];
          if (canPourNamesDesk) parts.push("имена");
          if (canPourRulesDesk) parts.push("сценарии" + (solN ? " · " + solN : ""));
          if (sendN) parts.push(sendN + " новое");
          sum.textContent = parts.length ? parts.join(" · ") : "Нечего лить — стол как на щите";
        } else if (show && pouredPane === "hist") {
          sum.hidden = false;
          sum.textContent = "Откат — «Вернуть». История не стирается.";
        } else {
          sum.hidden = true;
          sum.textContent = "";
        }
      }
      if (hint) {
        hint.hidden = true;
        hint.textContent = "";
      }
      const namesBtn = $("pourNames");
      const rulesBtn = $("pourRules");
      const repairBtn = $("pour");
      if (namesBtn) {
        namesBtn.hidden = pouredPane === "hist" && !canPourNamesDesk;
        namesBtn.disabled = !canPourNamesDesk;
        namesBtn.textContent = "1 · Имена";
        namesBtn.title = canPourNamesDesk
          ? "Имена каналов на щит"
          : "Нет новых имён";
      }
      if (rulesBtn) {
        rulesBtn.hidden = pouredPane === "hist" && !canPourRulesDesk;
        rulesBtn.disabled = !canPourRulesDesk;
        rulesBtn.textContent = "2 · Сценарии";
        rulesBtn.title = !canPourRulesDesk
          ? "Нет сценариев на столе"
          : canPourNamesDesk
            ? "Можно сейчас. Лучше сначала имена."
            : "Типовые со стола на щит";
      }
      if (repairBtn) {
        const showRepair = pouredPane === "hist" && canRepairDesk && !canPourNamesDesk;
        repairBtn.hidden = !showRepair;
        repairBtn.disabled = !showRepair;
        repairBtn.textContent = "Убрать дубли";
        repairBtn.title = showRepair ? "Спрятать лишние строки в дашборде" : "";
      }
    }
    function mergeContactRows(base, extra) {
      const rows = (base || []).slice();
      const seen = new Set(rows.map((r) => contactKey(r.deviceTopicKey, r.controlId)));
      (extra || []).forEach((c) => {
        const cid = isDeskLoad(c.controlId) ? pairOpenId(c.controlId) : c.controlId;
        const k = contactKey(c.deviceTopicKey, cid);
        if (seen.has(k)) return;
        const row = {
          deviceTopicKey: c.deviceTopicKey,
          controlId: cid,
          label: solContactLabel({ deviceTopicKey: c.deviceTopicKey, controlId: cid }),
          room: roomFromContacts([{ deviceTopicKey: c.deviceTopicKey, controlId: cid }]),
        };
        rows.unshift(row);
        seen.add(k);
      });
      return rows;
    }
    function sceneLoadRows(item) {
      const p = sceneParts(item.contacts);
      const want = contactSet(p.loads);
      const skipDrive = !/curtain/.test(item.solutionId || sceneCardId(item.title, item.card));
      const home = item.room || "";
      const rows = mergeContactRows(namedLoads(), p.loads).filter((r) => {
        if (skipDrive && isDeskDrive(r.controlId)) return false;
        return true;
      });
      rows.sort((a, b) => {
        const ar = a.room || "";
        const br = b.room || "";
        const aHome = home && ar === home ? 0 : 1;
        const bHome = home && br === home ? 0 : 1;
        if (aHome !== bHome) return aHome - bHome;
        const rr = ar.localeCompare(br, "ru");
        if (rr) return rr;
        const ak = contactKey(a.deviceTopicKey, a.controlId);
        const bk = contactKey(b.deviceTopicKey, b.controlId);
        const ac = want.has(ak) ? 0 : 1;
        const bc = want.has(bk) ? 0 : 1;
        if (ac !== bc) return ac - bc;
        return (a.label || "").localeCompare(b.label || "", "ru");
      });
      return { rows: rows, want: want };
    }
    function setPouredChrome(drill) {
      const tabs = $("pouredTabs");
      if (tabs) tabs.hidden = !!(drill && !openPourMod);
      const head = $("previewHead");
      if (head && drill) head.hidden = true;
      const dock = $("pourDock");
      if (dock) dock.hidden = !!(openSceneId || openContact);
    }
    function renderSceneDrill(box, item) {
      const p = sceneParts(item.contacts);
      const buttons = sceneButtons(item.contacts);
      const back = document.createElement("button");
      back.type = "button";
      back.className = "back";
      back.setAttribute("aria-label", "К сценариям");
      back.innerHTML = "<svg viewBox='0 0 24 24'><path d='M15 18l-6-6 6-6'/></svg><span>К сценариям</span>";
      back.addEventListener("click", closeScene);
      const head = document.createElement("div");
      head.className = "vcard on";
      const cap = document.createElement("div");
      cap.className = "vtop";
      const ttl = document.createElement("span");
      ttl.className = "vt";
      ttl.textContent = item.lightLine || item.room || "Сценарий";
      const st = document.createElement("span");
      st.className = "cat" + (pourLane(item) === "send" ? "" : " on");
      st.textContent = laneRu(item);
      cap.append(ttl, st);
      const vs = document.createElement("span");
      vs.className = "vs";
      vs.textContent = item.room || "Кнопка и свет с этой шины";
      head.append(cap, vs);
      const card = document.createElement("div");
      card.className = "scene-card";
      const trigLab = document.createElement("div");
      trigLab.className = "fldrow";
      const trigName = document.createElement("span");
      trigName.className = "fldlab";
      trigName.textContent = "Кнопка";
      const trig = document.createElement("select");
      trig.className = "fldsel";
      trig.setAttribute("aria-label", "Кнопка");
      fillSelect(trig, mergeContactRows(namedTriggers(), buttons), "Выбрать");
      if (buttons[0]) trig.value = contactKey(buttons[0].deviceTopicKey, buttons[0].controlId);
      if (!trig.value) trig.classList.add("empty");
      trig.addEventListener("change", () => trig.classList.toggle("empty", !trig.value));
      trigLab.append(trigName, trig);
      card.appendChild(trigLab);
      const selected = new Set(item.cardsOn && item.cardsOn.length
        ? item.cardsOn
        : [item.solutionId || sceneCardId(item.title, item.card)].filter(Boolean));
      const gest = document.createElement("div");
      gest.className = "chips";
      CARDS.forEach((c) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "chip";
        b.dataset.card = c.id;
        b.textContent = c.ru;
        b.setAttribute("aria-pressed", selected.has(c.id) ? "true" : "false");
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleDeskCard(selected, c.id);
          paintChips(gest, selected);
        });
        gest.appendChild(b);
      });
      const gestH = document.createElement("p");
      gestH.className = "sech";
      gestH.textContent = "Жест";
      card.append(gestH, gest);
      if (buttons.length > 1) {
        const extra = document.createElement("p");
        extra.className = "meta scene-extra";
        extra.textContent = "ещё · " + buttons.slice(1).map(solContactLabel).join(" · ");
        card.appendChild(extra);
      }
      const { rows: loads, want } = sceneLoadRows(item);
      const nOn = loads.filter((r) => want.has(contactKey(r.deviceTopicKey, r.controlId))).length;
      const lightH = document.createElement("p");
      lightH.className = "sech";
      lightH.textContent = nOn ? "Свет · " + nOn : "Свет";
      const picks = document.createElement("div");
      picks.className = "picks";
      if (!loads.length) {
        const empty = document.createElement("p");
        empty.className = "meta";
        empty.textContent = "Сначала имя линии в «Разметить».";
        picks.appendChild(empty);
      }
      let lastRoom = "\0";
      loads.forEach((load) => {
        const room = load.room || "Без комнаты";
        if (room !== lastRoom) {
          lastRoom = room;
          const rh = document.createElement("p");
          rh.className = "roomh";
          rh.textContent = room;
          picks.appendChild(rh);
        }
        const lab = document.createElement("label");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.value = contactKey(load.deviceTopicKey, load.controlId);
        cb.checked = want.has(cb.value);
        if (cb.checked) lab.classList.add("on");
        cb.addEventListener("change", () => lab.classList.toggle("on", cb.checked));
        lab.append(cb, document.createTextNode(titleUnderRoom(load.label, room) || load.label));
        picks.appendChild(lab);
      });
      card.append(lightH, picks);
      const err = document.createElement("p");
      err.className = "meta orphan scene-err";
      const save = document.createElement("button");
      save.type = "button";
      save.className = "ghost";
      save.textContent = "На стол";
      save.addEventListener("click", () => {
        const targets = [...picks.querySelectorAll("input:checked")].map((o) => parseBindValue(o.value)).filter(Boolean);
        const trigger = parseBindValue(trig.value);
        err.textContent = "";
        if (!trigger) { err.textContent = "Нужна кнопка"; return; }
        if (!targets.length) { err.textContent = "Нужен свет"; return; }
        const ids = exclusiveCards([...selected]);
        if (!ids.length) { err.textContent = "Нужен жест"; return; }
        const put = (solutionId) => fetch("/runtime/desk-solutions", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: (item.deskByCard && item.deskByCard[solutionId]) || "",
            solutionId: solutionId,
            trigger: trigger,
            targets: targets,
          }),
        }).then((r) => r.json());
        Promise.all(ids.map(put)).then((rows) => {
          const bad = rows.find((j) => !j.ok);
          if (bad) {
            err.textContent = bad.error === "need_trigger" ? "Нужна кнопка с шины"
              : bad.error === "need_target" || bad.error === "need_load" ? "Нужна линия из разметки"
              : (bad.error || "Не сохранил");
            return;
          }
          openSceneId = "";
          loadSolutions().then(() => {
            pouredPane = "send";
            setTab("poured");
            const headEl = $("previewHead");
            if (headEl) {
              headEl.style.color = "";
              headEl.textContent = "На столе. Дальше: «Залить сценарии».";
            }
            loadPreview();
            paintPourButtons();
            renderReady();
          });
        }).catch(() => { err.textContent = "Нет связи с агентом"; });
      });
      const actions = document.createElement("div");
      actions.className = "scene-foot";
      actions.append(save);
      box.append(back, head, card, err, actions);
    }
    function renderContactDrill(box) {
      const i = String(openContact).indexOf("::");
      const key = i < 0 ? openContact : openContact.slice(0, i);
      const cid = pairOpenId(i < 0 ? "" : openContact.slice(i + 2));
      const back = document.createElement("button");
      back.type = "button";
      back.className = "back";
      const backRu = pouredPane === "send" ? "К новому" : "К разметке";
      back.setAttribute("aria-label", backRu);
      back.innerHTML = "<svg viewBox='0 0 24 24'><path d='M15 18l-6-6 6-6'/></svg><span></span>";
      back.querySelector("span").textContent = backRu;
      back.addEventListener("click", closeContact);
      const s = lastShelvesRows.find((r) => r.deviceTopicKey === key);
      const ch = s && (s.channels || []).find((c) => c.controlId === cid);
      if (!s || !ch) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = "Контакт не на шине.";
        box.append(back, empty);
        return;
      }
      const head = document.createElement("div");
      head.className = "vcard on";
      paintModuleFace(head, s);
      const ul = document.createElement("ul");
      ul.className = "channels";
      ul.appendChild(channelRow(s, ch, nameRoom(pairName(s, ch))));
      box.append(back, head, ul);
      if (wantButtonFocus) {
        wantButtonFocus = false;
        requestAnimationFrame(() => {
          const sel = box.querySelector('select[aria-label="Кнопка"]');
          if (sel) sel.focus();
        });
      }
    }
    function renderReady() {
      const box = $("ready");
      if (!box) return;
      renderPouredTabs();
      box.replaceChildren();
      const all = collectReadyItems();
      if (openContact) {
        renderPouredTabs();
        setPouredChrome(true);
        renderContactDrill(box);
        return;
      }
      if (openSceneId) {
        const hit = all.find((i) => i.scene && sceneKey(i) === openSceneId);
        if (hit) {
          pouredPane = "rules";
          renderPouredTabs();
          setPouredChrome(true);
          renderSceneDrill(box, hit);
          return;
        }
        openSceneId = "";
        renderPouredTabs();
      }
      setPouredChrome(false);
      if (pouredPane === "hist") {
        openPourMod = "";
        renderHistory(box);
        const head = $("previewHead");
        if (head) {
          head.hidden = true;
          head.textContent = "";
        }
        return;
      }
      const items = paneItems(all);
      if (pouredPane === "send") {
        paintSendByModule(box, items);
      } else {
        openPourMod = "";
        box.className = "";
        const ul = document.createElement("ul");
        ul.className = "channels";
        const onCtl = items.filter((i) => !isNewItem(i));
        const neu = items.filter(isNewItem);
        onCtl.slice().sort(byContact).forEach((i) => ul.appendChild(readyCard(i, i.room)));
        if (neu.length && onCtl.length) {
          const h = document.createElement("li");
          h.className = "roomh";
          h.textContent = "Новое со стола";
          ul.appendChild(h);
        }
        neu.slice().sort(byContact).forEach((i) => ul.appendChild(readyCard(i, i.room)));
        if (ul.childNodes.length) box.appendChild(ul);
      }
      if (!items.length) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = pouredPane === "send"
          ? "Нового нет — стол совпадает с контроллером."
          : "Сценариев на контроллере пока нет.";
        box.appendChild(empty);
      }
      const head = $("previewHead");
      if (head) {
        head.style.color = "";
        head.hidden = true;
        head.textContent = "";
      }
    }
    function renderPoured() {
      const wrap = $("pouredMarksWrap");
      if (wrap) wrap.hidden = true;
      renderReady();
      stampDiskScenes();
    }
    function contactPretty(c) {
      return solContactLabel(c);
    }
    function solContactLabel(c) {
      if (!c) return "по расписанию";
      const s = lastShelvesRows.find((r) => r.deviceTopicKey === c.deviceTopicKey);
      const ch = s && (s.channels || []).find((x) => x.controlId === c.controlId);
      const name = ch && String(ch.name || "").trim();
      if (name && isDeskLoad(c.controlId)) return shortLoadName(name, c.controlId);
      if (name) return prettyContactName(name);
      return ((s && s.label) || c.deviceTopicKey) + " · " + prettyControlId(c.controlId);
    }
    /** Первая строка для человека; техника — в title. */
    function solContactHuman(c) {
      if (!c) return "по расписанию";
      const full = solContactLabel(c);
      if (!/WB-|GPIO|Channel|Input |EXT/i.test(full)) return full;
      const s = lastShelvesRows.find((r) => r.deviceTopicKey === c.deviceTopicKey);
      const ch = s && (s.channels || []).find((x) => x.controlId === c.controlId);
      const name = ch && String(ch.name || "").trim();
      if (name) return prettyContactName(name);
      return prettyControlId(c.controlId);
    }
    function paintCardsRoomBanner() {
      const el = $("cardsRoom");
      if (!el) return;
      if (roomFilter) {
        el.hidden = false;
        el.textContent = "Комната «" + roomFilter + "» — в списках сначала её кнопки и линии.";
      } else {
        el.hidden = true;
        el.textContent = "";
      }
    }
    function preferRoomRows(rows) {
      if (!roomFilter) return rows;
      const home = [];
      const other = [];
      rows.forEach((r) => {
        const room = nameRoom(r.label) || roomFromContacts([r]);
        if (room === roomFilter) home.push(r);
        else other.push(r);
      });
      return home.concat(other);
    }
    function namedTriggers() {
      const named = [];
      const rest = [];
      (lastShelvesRows || []).forEach((s) => {
        (s.channels || []).forEach((ch) => {
          if (isDeskLoad(ch.controlId)) return;
          const name = String(ch.name || "").trim();
          const row = {
            deviceTopicKey: s.deviceTopicKey,
            controlId: ch.controlId,
            label: name ? prettyContactName(name) : (s.label || "вход") + " · " + ch.controlId,
          };
          if (name) named.push(row);
          else rest.push(row);
        });
      });
      return preferRoomRows(named.concat(rest));
    }
    function fillSelect(sel, rows, placeholder) {
      sel.replaceChildren();
      if (placeholder) {
      const z = document.createElement("option");
      z.value = "";
      z.textContent = placeholder;
      sel.appendChild(z);
      }
      rows.forEach((r) => {
        const o = document.createElement("option");
        o.value = contactKey(r.deviceTopicKey, r.controlId);
        o.textContent = r.label;
        sel.appendChild(o);
      });
    }
    function parseBindValue(v) {
      const i = String(v).indexOf("::");
      if (i < 0) return null;
      return { deviceTopicKey: v.slice(0, i), controlId: v.slice(i + 2) };
    }
    function catOfSol(sol) {
      const card = deskCatalog.find((c) => c.id === sol.solutionId);
      return (card && card.cat) || "";
    }
    function renderDeskSolutions() {
      const ul = $("deskSols");
      ul.innerHTML = "";
      paintCardsRoomBanner();
      deskSolutions.filter((sol) => catOfSol(sol) === cardFilter).forEach((sol) => {
        const li = document.createElement("li");
        const tHuman = (sol.targets || []).map(solContactHuman).join(" · ");
        const tFull = (sol.targets || []).map(solContactLabel).join(" · ");
        const trigH = solContactHuman(sol.trigger);
        const trigF = solContactLabel(sol.trigger);
        const left = document.createElement("div");
        left.innerHTML = "<strong></strong><div class=\"meta\"></div>";
        const cardRow = deskCatalog.find((c) => c.id === sol.solutionId);
        left.querySelector("strong").textContent = (cardRow && cardRow.title) || sol.title || sol.solutionId;
        const paramH = solParamsHuman(sol, cardRow);
        left.querySelector(".meta").textContent =
          trigH + (tHuman ? " → " + tHuman : "") + (paramH ? " · " + paramH : "");
        left.title = trigF + (tFull ? " → " + tFull : "") + (paramH ? " · " + paramH : "");
        const del = document.createElement("button");
        del.type = "button";
        del.className = "ghost";
        del.textContent = "Снять";
        del.addEventListener("click", () => {
          fetch("/runtime/desk-solutions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ delete: sol.id }),
          }).then(() => loadSolutions());
        });
        left.style.cursor = "pointer";
        left.addEventListener("click", () => {
          const card = deskCatalog.find((c) => c.id === sol.solutionId);
          if (card) openCardSheet(card, sol);
        });
        li.appendChild(left);
        li.appendChild(del);
        ul.appendChild(li);
      });
      $("n-cards").textContent = deskSolutions.length || "";
    }
    function stampDiskScenes() {
      const n = (pouredRules || []).filter((r) => r.kind === "user").length;
      $("diskScenes").textContent = n
        ? n + " на щите — правьте здесь или в «Залить · Сценарии»."
        : "Соберите карточку ниже → «На стол» → «Залить».";
    }
    function closeCardSheet() {
      $("cardSheet").hidden = true;
      $("cardMask").hidden = true;
    }
    function sheetNeedSensor(card) {
      return /humidity|co2|temp|thermostat|warm_floor|weather|vent_|ac_|humidifier|motion|reed|leak|двер|движен|протеч|окн/i
        .test(card.id + " " + card.title);
    }
    function sheetTrigLab(card) {
      return sheetNeedSensor(card) ? "Датчик" : "Кнопка";
    }
    function sheetTgtLab(card) {
      if (card.cat === "Шторы") return card.multi ? "Шторы / приводы" : "Штора";
      if (card.cat === "Климат") return card.multi ? "Нагрузки" : "Нагрузка";
      if (card.cat === "Охрана") {
        if (/leak/.test(card.id)) return card.multi ? "Краны" : "Кран";
        if (/lock/.test(card.id)) return "Замок";
        if (/siren/.test(card.id)) return "Сирена";
        return "Нагрузка";
      }
      if (card.cat === "Розетки") return "Розетка";
      if (card.cat === "Сцены") return "Линии";
      if (card.cat === "Общее") return card.multi ? "Нагрузки" : "Нагрузка";
      return card.multi ? "Свет / линии" : "Свет";
    }
    /** onlyHits: если есть подходящие — не подмешивать чужие линии (свет в шторах и т.п.). */
    function preferRows(rows, hitFn, onlyHits) {
      const hit = rows.filter(hitFn);
      if (!hit.length) return rows;
      return onlyHits ? hit : hit.concat(rows.filter((r) => !hitFn(r)));
    }
    function isSensorLabel(label) {
      return /датчик|темпер|влажн|co[₂2]|геркон|движен|протеч|двер|окн|pir/i.test(String(label || ""));
    }
    function isCurtainLoad(r) {
      return isDeskDrive(r.controlId) || /штор|роллет|жалюз|тюль|экран|привод/i.test(r.label || "");
    }
    function triggersForCard(card) {
      const all = namedTriggers().filter((r) => String(r.label || "").trim());
      if (!sheetNeedSensor(card)) return all;
      return preferRows(all, (r) => isSensorLabel(r.label), true);
    }
    function loadsForCard(card, room) {
      const all = loadsForRoom(room);
      if (card.cat === "Шторы") return preferRows(all, isCurtainLoad, true);
      if (card.cat === "Климат") {
        return preferRows(all, (r) => /кондей|кондиц|тепл|пол|вытяж|вентил|насос|увлажн|калорифер|серво/i.test(r.label || ""), true);
      }
      if (card.cat === "Розетки") return preferRows(all, (r) => /розетк/i.test(r.label || ""), true);
      if (/leak/.test(card.id)) return preferRows(all, (r) => /кран|клапан|перекрыт/i.test(r.label || ""), true);
      if (/siren/.test(card.id)) return preferRows(all, (r) => /сирен|тревог/i.test(r.label || ""), true);
      if (/lock/.test(card.id)) return preferRows(all, (r) => /замок/i.test(r.label || ""), true);
      return all;
    }
    function openCardSheet(card, draft) {
      const box = $("cardSheet");
      const mask = $("cardMask");
      box.hidden = false;
      mask.hidden = false;
      box.replaceChildren();
      const h = document.createElement("h3");
      h.textContent = card.title;
      const p = document.createElement("p");
      p.className = "meta";
      p.textContent = card.summary;
      const needTrig = card.needTrig !== false;
      let trig = null;
      const trigLab = document.createElement("span");
      trigLab.className = "fld";
      if (needTrig) {
        trigLab.textContent = sheetTrigLab(card);
        trig = document.createElement("select");
        trig.className = "bind";
        trig.setAttribute("aria-label", trigLab.textContent);
        const trigs = triggersForCard(card);
        fillSelect(trig, trigs, roomFilter ? ("Из «" + roomFilter + "» или шины") : "С этой шины");
        if (draft && draft.trigger) {
          trig.value = contactKey(draft.trigger.deviceTopicKey, draft.trigger.controlId);
        } else if (sheetNeedSensor(card)) {
          const sens = trigs.find((r) => (!roomFilter || nameRoom(r.label) === roomFilter) && isSensorLabel(r.label))
            || trigs.find((r) => isSensorLabel(r.label));
          if (sens) trig.value = contactKey(sens.deviceTopicKey, sens.controlId);
        } else if (roomFilter && trigs[0] && nameRoom(trigs[0].label) === roomFilter) {
          trig.value = contactKey(trigs[0].deviceTopicKey, trigs[0].controlId);
        }
      } else {
        trigLab.textContent = "Расписание";
        const note = document.createElement("p");
        note.className = "meta";
        note.textContent = "По времени на контроллере. Сейчас выберите " + sheetTgtLab(card).toLowerCase() + ".";
        trig = note;
      }
      const tgtLab = document.createElement("span");
      tgtLab.className = "fld";
      tgtLab.textContent = sheetTgtLab(card);
      const loads = loadsForCard(card, roomFilter);
      const err = document.createElement("p");
      err.className = "meta orphan";
      let collectTargets;
      let tgtNode;
      if (card.multi) {
        const picks = document.createElement("div");
        picks.className = "picks";
        if (!loads.length) {
          const empty = document.createElement("p");
          empty.className = "meta";
          empty.textContent = "Сначала имя в «Разметить».";
          picks.appendChild(empty);
        }
        loads.forEach((load) => {
          const lab = document.createElement("label");
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.value = contactKey(load.deviceTopicKey, load.controlId);
          lab.append(cb, document.createTextNode(load.label));
          if (draft && (draft.targets || []).some((t) => contactKey(t.deviceTopicKey, t.controlId) === cb.value)) cb.checked = true;
          picks.appendChild(lab);
        });
        tgtNode = picks;
        collectTargets = () => [...picks.querySelectorAll("input:checked")].map((o) => parseBindValue(o.value)).filter(Boolean);
      } else {
        const tgt = document.createElement("select");
        tgt.className = "bind";
        tgt.setAttribute("aria-label", tgtLab.textContent);
        fillSelect(tgt, loads, "Из этой разметки");
        if (draft && draft.targets && draft.targets[0]) {
          tgt.value = contactKey(draft.targets[0].deviceTopicKey, draft.targets[0].controlId);
        } else if (roomFilter && loads[0] && loads[0].room === roomFilter) {
          tgt.value = contactKey(loads[0].deviceTopicKey, loads[0].controlId);
        }
        tgtNode = tgt;
        collectTargets = () => [parseBindValue(tgt.value)].filter(Boolean);
      }
      const fields = Array.isArray(card.fields) ? card.fields : [];
      const paramBox = document.createElement("div");
      paramBox.className = "sheet-params";
      const paramInputs = {};
      fields.forEach((f) => {
        const lab = document.createElement("span");
        const long = String(f.label || "").length > 22;
        lab.className = "fld" + (long ? " wide" : "");
        lab.textContent = f.label + (f.unit ? " · " + f.unit : "");
        const inp = document.createElement("input");
        inp.type = "number";
        inp.className = "bind" + (long ? " wide" : "");
        inp.step = "any";
        // null/undefined → дефолт (Number(null) === 0 — ловушка).
        const draftVal = draft && draft.params ? draft.params[f.key] : undefined;
        inp.value = draftVal != null && Number.isFinite(Number(draftVal))
          ? Number(draftVal)
          : Number(f.def);
        inp.setAttribute("aria-label", lab.textContent);
        paramInputs[f.key] = inp;
        paramBox.append(lab, inp);
      });
      const collectParams = () => {
        const out = {};
        fields.forEach((f) => {
          const n = Number(paramInputs[f.key].value);
          out[f.key] = Number.isFinite(n) ? n : Number(f.def);
        });
        return out;
      };
      const actions = document.createElement("div");
      actions.className = "actions";
      const save = document.createElement("button");
      save.type = "button";
      save.className = "ghost";
      save.textContent = "На стол";
      save.addEventListener("click", () => {
        fetch("/runtime/desk-solutions", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: draft && draft.id,
            solutionId: card.id,
            trigger: needTrig ? parseBindValue(trig.value) : null,
            targets: collectTargets(),
            params: fields.length ? collectParams() : undefined,
          }),
        }).then((r) => r.json()).then((j) => {
          if (!j.ok) {
            err.textContent = j.error === "need_trigger"
              ? ("Нужен " + sheetTrigLab(card).toLowerCase() + " с шины")
              : j.error === "need_target" || j.error === "need_load"
                ? ("Нужна " + sheetTgtLab(card).toLowerCase() + " из разметки")
              : (j.error || "Не сохранил");
            return;
          }
          closeCardSheet();
          loadSolutions().then(() => {
            pouredPane = "send";
            setTab("poured");
            const head = $("previewHead");
            if (head) {
              head.style.color = "";
              head.textContent = canPourNamesDesk
                ? "На столе. Сначала «1 · Залить имена», потом сценарии."
                : "На столе. Можно «2 · Залить сценарии».";
            }
            paintPourButtons();
            renderReady();
          });
        }).catch(() => { err.textContent = "Нет связи с агентом"; });
      });
      const clearErr = () => { err.textContent = ""; };
      if (needTrig && trig.tagName === "SELECT") trig.addEventListener("change", clearErr);
      tgtNode.addEventListener("change", clearErr);
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "ghost";
      cancel.textContent = "Закрыть";
      cancel.addEventListener("click", closeCardSheet);
      actions.append(save, cancel);
      const head = document.createElement("div");
      head.className = "sheet-head";
      head.append(h, p);
      const body = document.createElement("div");
      body.className = "sheet-body";
      body.append(trigLab, trig, tgtLab, tgtNode);
      if (fields.length) body.appendChild(paramBox);
      body.appendChild(err);
      box.append(head, body, actions);
    }
    function solParamsHuman(sol, card) {
      const fields = (card && card.fields) || (deskCatalog.find((c) => c.id === sol.solutionId) || {}).fields || [];
      if (!fields.length || !sol.params) return "";
      return fields.map((f) => {
        const v = sol.params[f.key];
        return f.label + " " + (Number.isFinite(Number(v)) ? Number(v) : f.def) + (f.unit || "");
      }).join(" · ");
    }
    const CARD_ICO = {
      light_button_toggle: "<svg viewBox='0 0 24 24'><rect x='2' y='7' width='20' height='10' rx='5'/><circle cx='16' cy='12' r='3'/></svg>",
      light_dim_hold_mcm: "<svg viewBox='0 0 24 24'><circle cx='12' cy='12' r='4'/><path d='M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41'/></svg>",
      light_all_off: "<svg viewBox='0 0 24 24'><path d='M12 2v10'/><path d='M8.5 4.2a8 8 0 1 0 7 0'/></svg>",
      light_motion: "<svg viewBox='0 0 24 24'><circle cx='12' cy='5' r='2'/><path d='M8 22l2-8 2 3 2-3 2 8M9 10h6'/></svg>",
      light_night_path: "<svg viewBox='0 0 24 24'><path d='M21 14a8 8 0 1 1-9-11 7 7 0 0 0 9 11z'/></svg>",
      light_reed_on: "<svg viewBox='0 0 24 24'><path d='M14 3h5v18H5V3h5'/><path d='M12 3v18'/></svg>",
      socket_button_toggle: "<svg viewBox='0 0 24 24'><path d='M9 7v4M15 7v4M8 15h8'/><rect x='5' y='4' width='14' height='16' rx='3'/></svg>",
      scene_away: "<svg viewBox='0 0 24 24'><path d='M3 11l9-8 9 8'/><path d='M5 10v10h14V10'/></svg>",
      scene_vacation: "<svg viewBox='0 0 24 24'><path d='M4 20l7-16 3 7 6 2z'/></svg>",
      scene_home: "<svg viewBox='0 0 24 24'><path d='M3 11l9-8 9 8'/><path d='M9 21V12h6v9'/></svg>",
      "Свет": "<svg viewBox='0 0 24 24'><circle cx='12' cy='12' r='4'/><path d='M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2'/></svg>",
      "Шторы": "<svg viewBox='0 0 24 24'><path d='M4 4h16v16H4z'/><path d='M4 8h16M12 8v12'/></svg>",
      "Климат": "<svg viewBox='0 0 24 24'><path d='M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4 4 0 1 0 5 0z'/></svg>",
      "Охрана": "<svg viewBox='0 0 24 24'><path d='M12 3l8 4v5c0 5-3.5 8.5-8 9.5C7.5 20.5 4 17 4 12V7z'/></svg>",
      "Розетки": "<svg viewBox='0 0 24 24'><path d='M9 7v4M15 7v4M8 15h8'/><rect x='5' y='4' width='14' height='16' rx='3'/></svg>",
      "Общее": "<svg viewBox='0 0 24 24'><path d='M12 3l1.8 5.5H19l-4.4 3.2L16.4 18 12 14.8 7.6 18l1.8-6.3L5 8.5h5.2z'/></svg>",
      "Сцены": "<svg viewBox='0 0 24 24'><path d='M3 11l9-8 9 8'/><path d='M5 10v10h14V10'/></svg>",
    };
    const CAT_ORDER = ["Свет", "Шторы", "Климат", "Охрана", "Розетки", "Общее", "Сцены"];
    function paintCardTile(grid, card) {
      const onDesk = deskSolutions.filter((s) => s.solutionId === card.id);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "vcard" + (onDesk.length ? " on" : "");
      btn.innerHTML = "<span class=\"vtop\"><span class=\"ico\"></span><span class=\"cat\"></span></span><span class=\"vt\"></span><span class=\"vs\"></span>";
      btn.querySelector(".ico").innerHTML = CARD_ICO[card.id] || CARD_ICO[card.cat] || CARD_ICO["Свет"];
      const catEl = btn.querySelector(".cat");
      catEl.textContent = onDesk.length ? "на столе" + (onDesk.length > 1 ? " · " + onDesk.length : "") : card.cat;
      if (onDesk.length) catEl.classList.add("on");
      btn.querySelector(".vt").textContent = card.title;
        btn.querySelector(".vs").textContent = onDesk[0]
          ? (onDesk.length > 1
              ? onDesk.length + " на столе · нажмите — ещё"
              : solContactHuman(onDesk[0].trigger) + " → " + onDesk[0].targets.map(solContactHuman).join(" · "))
          : card.summary;
        if (onDesk[0]) {
          btn.title = solContactLabel(onDesk[0].trigger) + " → " +
            onDesk[0].targets.map(solContactLabel).join(" · ");
        }
      btn.addEventListener("click", () => openCardSheet(card, null));
      grid.appendChild(btn);
    }
    function cardsForFilter() {
      const rows = deskCatalog.filter((c) => c.cat === cardFilter);
      if (cardFilter !== "Свет") return rows;
      const rank = (id) => {
        const i = L1_LIGHT.indexOf(id);
        return i < 0 ? 1000 : i;
      };
      const primary = rows.filter((c) => L1_LIGHT.includes(c.id)).sort((a, b) => rank(a.id) - rank(b.id));
      const rest = rows.filter((c) => !L1_LIGHT.includes(c.id));
      return { primary: primary, rest: rest };
    }
    function renderVitrine() {
      const filters = $("cardFilters");
      const have = new Set(deskCatalog.map((c) => c.cat));
      const cats = CAT_ORDER.filter((c) => have.has(c));
      if (!cats.includes(cardFilter)) cardFilter = cats[0] || "Свет";
      filters.replaceChildren();
      cats.forEach((cat) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = cat;
        b.setAttribute("aria-pressed", cardFilter === cat ? "true" : "false");
        b.addEventListener("click", () => {
          cardFilter = cat;
          if (cat !== "Свет") showMoreLight = false;
          renderVitrine();
          renderDeskSolutions();
        });
        filters.appendChild(b);
      });
      const grid = $("vitrine");
      grid.replaceChildren();
      if (cardFilter === "Свет") {
        const pack = cardsForFilter();
        pack.primary.forEach((card) => paintCardTile(grid, card));
        if (pack.rest.length) {
          if (showMoreLight) {
            pack.rest.forEach((card) => paintCardTile(grid, card));
            const less = document.createElement("button");
            less.type = "button";
            less.className = "ghost more-cards";
            less.textContent = "Свернуть";
            less.addEventListener("click", () => { showMoreLight = false; renderVitrine(); });
            grid.appendChild(less);
          } else {
            const more = document.createElement("button");
            more.type = "button";
            more.className = "ghost more-cards";
            more.textContent = "Ещё " + pack.rest.length;
            more.addEventListener("click", () => { showMoreLight = true; renderVitrine(); });
            grid.appendChild(more);
          }
        }
        return;
      }
      cardsForFilter().forEach((card) => paintCardTile(grid, card));
    }
    async function loadSolutions() {
      try {
        const r = await fetch("/runtime/desk-solutions");
        const j = await r.json();
        if (!j.ok) return;
        deskCatalog = j.catalog || [];
        deskSolutions = j.solutions || [];
        renderVitrine();
        renderDeskSolutions();
        stampDiskScenes();
        if (activeTab === "poured") renderReady();
      } catch (_) { /* агент ниже */ }
    }
    async function loadHealth() {
      const box = $("health");
      const main = $("healthMain") || box.querySelector("p");
      const sub = $("healthSub");
      try {
        const r = await fetch("/runtime/health");
        const j = await r.json();
        const mirror = j.mqttMirror || {};
        const topics = Number(mirror.topicCount) || 0;
        const busOk = mirror.connected === true && topics > 0;
        const cloudState = j.enrollment && j.enrollment.state;
        const cloudOk = /^(restored|online|enrolled_awaiting_heartbeat)$/.test(String(cloudState || ""));
        const ver = String(j.agentVersion || "").replace(/^.*\./, "") || "—";
        if (!j.ok) {
          box.className = "glass status bad";
          main.textContent = "Агент не ответил";
          if (sub) { sub.hidden = true; sub.textContent = ""; }
          return;
        }
        box.className = "glass status " + (busOk ? "ok" : cloudOk ? "warn" : "bad");
        main.textContent = busRu(mirror) + " · " + cloudRu(cloudState) + " · " + ver;
        if (sub) {
          const bits = [];
          if (!busOk) bits.push("Проверьте mosquitto на щите");
          if (!cloudOk) bits.push("Облако не обязательно для локальной заливки");
          sub.textContent = bits.join(" · ");
          sub.hidden = !bits.length;
        }
      } catch (e) {
        box.className = "glass status bad";
        main.textContent = "Нет /runtime/health — откройте стол с сети щита.";
        if (sub) { sub.hidden = true; sub.textContent = ""; }
      }
    }
    async function openFieldCert() {
      const box = $("cardSheet");
      const mask = $("cardMask");
      box.hidden = false;
      mask.hidden = false;
      box.replaceChildren();
      const h = document.createElement("h3");
      h.textContent = "Полевой сертификат";
      const p = document.createElement("p");
      p.className = "meta";
      p.textContent = "Спрашиваю щит…";
      const head = document.createElement("div");
      head.className = "sheet-head";
      head.append(h, p);
      const body = document.createElement("div");
      body.className = "sheet-body";
      const actions = document.createElement("div");
      actions.className = "actions";
      const close = document.createElement("button");
      close.type = "button";
      close.className = "ghost";
      close.textContent = "Закрыть";
      close.addEventListener("click", closeCardSheet);
      actions.appendChild(close);
      box.append(head, body, actions);
      try {
        const r = await fetch("/runtime/field-cert");
        const j = await r.json();
        if (!j.ok) {
          p.textContent = "Не собрал сертификат";
          return;
        }
        p.textContent = j.ready
          ? "Готово · " + j.passed + "/" + j.total
          : "Ещё " + (j.total - j.passed) + " пункта · " + j.passed + "/" + j.total;
        const ul = document.createElement("ul");
        ul.className = "cert-list";
        (j.checks || []).forEach((c) => {
          const li = document.createElement("li");
          li.className = c.ok ? "ok" : "bad";
          li.innerHTML = "<strong></strong><div class=\"meta\"></div>";
          li.querySelector("strong").textContent = (c.ok ? "✓ " : "· ") + c.title;
          li.querySelector(".meta").textContent = c.detail || "";
          ul.appendChild(li);
        });
        body.appendChild(ul);
        if (j.passport) {
          const det = document.createElement("details");
          det.className = "cert-more";
          const sum = document.createElement("summary");
          sum.textContent = "Техпаспорт (для сдачи)";
          const pre = document.createElement("pre");
          pre.className = "cert-passport";
          pre.textContent = JSON.stringify(j.passport, null, 2);
          det.append(sum, pre);
          body.appendChild(det);
        }
      } catch (_) {
        p.textContent = "Нет связи с /runtime/field-cert";
      }
    }
    async function saveMark(body) {
      await fetch("/runtime/desk-marking", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      loadPreview();
    }
    async function saveName(key, controlId, name) {
      await saveMark({ deviceTopicKey: key, controlId: controlId, name: name });
    }
    async function saveCards(key, controlId, cards) {
      await saveMark({ deviceTopicKey: key, controlId: controlId, cards: cards });
    }
    function shortLoadName(name, controlId) {
      const pretty = prettyContactName(name);
      const parts = pretty.split(/\s*·\s*/).filter(Boolean);
      if (!parts.length) return String(controlId || "").replace(/^Channel\s+/i, "Ch");
      const room = parts[0];
      const esc = room.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const type = parts.slice(1)
        .map((p) => p.replace(new RegExp("\\s*" + esc + "\\s*$", "i"), "").trim())
        .filter(Boolean)
        .join(" · ");
      return type ? room + " · " + type : room;
    }
    function namedLoads() {
      const raw = [];
      (lastShelvesRows || []).forEach((s) => {
        (s.channels || []).forEach((ch) => {
          if (!isDeskLoad(ch.controlId)) return;
          if (isDriveClose(ch.controlId)) return;
          const name = pairName(s, ch);
          if (!name) return;
          raw.push({
            deviceTopicKey: s.deviceTopicKey,
            controlId: ch.controlId,
            name: shortLoadName(name, ch.controlId),
            room: nameRoom(name),
            slave: Number((/_(\d+)$/.exec(s.deviceTopicKey) || [])[1] || 0),
            ch: Number((/(\d+)/.exec(ch.controlId) || [])[1] || 0),
          });
        });
      });
      const counts = {};
      raw.forEach((r) => { counts[r.name] = (counts[r.name] || 0) + 1; });
      raw.sort((a, b) => {
        const d = a.slave - b.slave;
        if (d) return d;
        const rr = (a.room || a.name).localeCompare(b.room || b.name, "ru");
        if (rr) return rr;
        return a.ch - b.ch;
      });
      const all = raw.map((r) => ({
        deviceTopicKey: r.deviceTopicKey,
        controlId: r.controlId,
        room: r.room,
        label: counts[r.name] > 1 && r.ch
          ? r.name + " · " + r.ch
          : r.name,
      }));
      return preferRoomRows(all);
    }
    function loadsForRoom(room) {
      const all = namedLoads();
      if (!room) return all;
      const hit = all.filter((r) => r.room === room);
      return hit.length ? hit.concat(all.filter((r) => r.room !== room)) : all;
    }
    function makeField(label, items, value, placeholder, onPick, addText, onAdd, need, allowEmpty) {
      const row = document.createElement("div");
      row.className = "fldrow" + (need ? " need" : "");
      const lab = document.createElement("span");
      lab.className = "fldlab";
      lab.textContent = label;
      const sel = document.createElement("select");
      sel.className = "fldsel" + (value ? "" : " empty");
      sel.setAttribute("aria-label", label);
      const z = document.createElement("option");
      z.value = "";
      z.textContent = placeholder;
      if (value && !allowEmpty) z.disabled = true;
      sel.appendChild(z);
      items.forEach((item) => {
        const o = document.createElement("option");
        if (typeof item === "string") {
          o.value = item;
          o.textContent = item;
        } else {
          o.value = item.value;
          o.textContent = item.label;
        }
        sel.appendChild(o);
      });
      if (addText) {
        const add = document.createElement("option");
        add.value = "__add__";
        add.textContent = addText;
        sel.appendChild(add);
      }
      sel.value = value || "";
      sel.addEventListener("change", () => {
        if (sel.value === "__add__") {
          sel.value = value || "";
          if (onAdd) onAdd();
          return;
        }
        onPick(sel.value);
      });
      row.append(lab, sel);
      return row;
    }
    function contactKey(key, cid) {
      return String(key) + "::" + String(cid);
    }
    function pouredTriggersForLoad(loadKey, loadCid) {
      const want = contactKey(loadKey, pairOpenId(loadCid));
      const seen = new Set();
      const out = [];
      pouredRules.filter((r) => r.kind === "user").forEach((r) => {
        const p = sceneParts(r.contacts);
        if (!p.loads.some((c) => contactKey(c.deviceTopicKey, pairOpenId(c.controlId)) === want)) return;
        p.buttons.forEach((b) => {
          const k = contactKey(b.deviceTopicKey, b.controlId);
          if (seen.has(k)) return;
          seen.add(k);
          out.push(b);
        });
      });
      return out;
    }
    function openButtonOnLoad(key, cid) {
      openSceneId = "";
      pouredPane = "mark";
      wantButtonFocus = true;
      jumpToContact(key, cid);
    }
    function jumpToContact(key, cid) {
      cid = pairOpenId(cid);
      if (activeTab === "poured") {
        openSceneId = "";
        openContact = contactKey(key, cid);
        renderReady();
        return;
      }
      const shelf = lastShelvesRows.find((s) => s.deviceTopicKey === key);
      const ch = shelf && (shelf.channels || []).find((c) => pairOpenId(c.controlId) === cid);
      const room = ch ? nameRoom(pairName(shelf, ch)) : "";
      if (room) roomFilter = room;
      else markPath = "modules";
      openMod = key;
      modFamily = familyOf({ deviceTopicKey: key }) || "light";
      setTab("mark", true);
      renderMark();
      const want = contactKey(key, cid);
      const go = () => {
        const el = [...document.querySelectorAll("[data-contact]")].find((n) => n.dataset.contact === want);
        if (!el) return;
        const det = el.closest("details");
        if (det) det.open = true;
        el.scrollIntoView({ block: "center" });
        el.classList.add("jump");
        const inp = el.querySelector("select.fldsel") || el.querySelector("button.chip");
        if (inp) inp.focus();
        setTimeout(() => el.classList.remove("jump"), 1400);
      };
      requestAnimationFrame(() => requestAnimationFrame(go));
    }
    function pickMark(s, ch, patch) {
      const k = contactKey(s.deviceTopicKey, ch.controlId);
      const saved = splitMark(pairName(s, ch));
      const prev = markPending[k] || {};
      const d = {
        room: patch.room != null ? patch.room : (prev.room || saved.room || roomFilter || ""),
        type: patch.type != null ? patch.type : (prev.type || saved.type),
      };
      markPending[k] = d;
      const next = composeMark(d.room, d.type);
      if (!next) {
        // Оба пусто — снять имя со стола (вернётся залитое с щита, если было).
        if (!d.room && !d.type && (saved.room || saved.type || pairName(s, ch))) {
          delete markPending[k];
          const jobs = [saveName(s.deviceTopicKey, ch.controlId, "")];
          const twin = isDeskDrive(ch.controlId) ? driveTwin(ch.controlId) : "";
          if (twin) jobs.push(saveName(s.deviceTopicKey, twin, ""));
          Promise.all(jobs).then(() => loadLast()).catch(() => {});
          return;
        }
        renderShelves(lastShelvesRows);
        if (activeTab === "poured") renderReady();
        return;
      }
      if (next === String(pairName(s, ch) || "").trim()) {
        delete markPending[k];
        renderShelves(lastShelvesRows);
        if (activeTab === "poured") renderReady();
        return;
      }
      const jobs = [saveName(s.deviceTopicKey, ch.controlId, next)];
      const twin = isDeskDrive(ch.controlId) ? driveTwin(ch.controlId) : "";
      if (twin) jobs.push(saveName(s.deviceTopicKey, twin, next));
      delete markPending[k];
          Promise.all(jobs).then(() => {
        loadLast().then(() => {
          const head = $("previewHead");
          if (head && (canPourNamesDesk || canPourDesk)) {
            head.textContent = "Имя на столе → шаг 3 «Залить» → «Залить имена».";
          }
        });
      }).catch(() => {});
    }
    function promptRoom() {
      const typed = window.prompt("Комната");
      if (!typed || !typed.trim()) return Promise.resolve("");
      return fetch("/runtime/desk-marking", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ room: typed.trim() }),
      }).then((r) => r.json()).then((j) => {
        if (!j.ok) return "";
        deskRooms = j.rooms || deskRooms;
        return prettyRoom(typed);
      });
    }
    function typeSteph(s, ch, isLoad) {
      if (isDeskDrive(ch.controlId)) return "Подпись";
      return "Тип";
    }
    function channelHint(s, ch, isLoad, original, poured) {
      const selected = new Set(exclusiveCards(Array.isArray(ch.cards) ? ch.cards : []));
      const diskIds = exclusiveCards(CARDS.filter((c) => (ch.hints || []).includes(c.ru)).map((c) => c.id));
      const deskDiverged = poured && [...selected].sort().join(",") !== diskIds.slice().sort().join(",");
      if (deskDiverged) return { text: "на контроллере · " + (ch.hints || []).join(" · ") };
      return null;
    }
    function channelRow(s, ch, room) {
      const row = document.createElement("li");
      row.dataset.contact = contactKey(s.deviceTopicKey, ch.controlId);
      const isLoad = isDeskLoad(ch.controlId);
      const original = pairName(s, ch);
      const saved = splitMark(original);
      const pending = markPending[contactKey(s.deviceTopicKey, ch.controlId)] || {};
      const current = {
        room: pending.room || saved.room || roomFilter || "",
        type: pending.type || saved.type,
      };
      const poured = Array.isArray(ch.hints) && ch.hints.length > 0;
      const cap = document.createElement("div");
      cap.className = "ch-cap";
      const knob = document.createElement("span");
      knob.className = "knob";
      knob.textContent = prettyControlId(ch.controlId);
      const ttl = document.createElement("div");
      ttl.className = "ttl" + (original ? "" : " mute");
      ttl.textContent = original ? prettyContactName(original) : "Без имени";
      cap.append(knob, ttl);
      const hint = channelHint(s, ch, isLoad, original, poured);
      if (hint) {
        const h = hint.go ? document.createElement("button") : document.createElement("span");
        h.className = "hint" + (hint.bad ? " orphan" : "");
        h.textContent = hint.text;
        if (hint.go) {
          h.type = "button";
          h.addEventListener("click", () => jumpToContact(hint.go.deviceTopicKey, hint.go.controlId));
        }
        cap.appendChild(h);
      }
      const fields = document.createElement("div");
      fields.className = "rows";
      const types = [...markTypes(s, ch, isLoad)];
      if (current.type && !types.includes(current.type)) types.push(current.type);
      fields.appendChild(makeField(
        "Комната",
        roomsFromBus(),
        current.room,
        "Выбрать",
        (v) => {
          if (!v) pickMark(s, ch, { room: "", type: "" });
          else pickMark(s, ch, { room: v });
        },
        "Новая комната…",
        () => promptRoom().then((name) => { if (name) pickMark(s, ch, { room: name }); }),
        !!(current.type && !current.room),
        true,
      ));
      fields.appendChild(makeField(
        typeSteph(s, ch, isLoad),
        types,
        current.type,
        "Выбрать",
        (v) => {
          if (!v) pickMark(s, ch, { room: "", type: "" });
          else pickMark(s, ch, { type: v });
        },
        "",
        null,
        !!(current.room && !current.type),
        true,
      ));
      // Жесты / типовые — только во вкладке Типовые (канон D1).
      if (original) {
        const drop = document.createElement("button");
        drop.type = "button";
        drop.className = "ghost";
        drop.textContent = "Снять имя";
        drop.title = "Убрать имя со стола";
        drop.addEventListener("click", () => {
          pickMark(s, ch, { room: "", type: "" });
        });
        row.append(cap, fields, drop);
        return row;
      }
      row.append(cap, fields);
      return row;
    }
    function prettyRoom(s) {
      const t = String(s || "").trim();
      if (!t) return "";
      return t.charAt(0).toLocaleUpperCase("ru") + t.slice(1);
    }
    function nameRoom(name) {
      const parts = String(name || "").split(/\s*·\s*/).filter(Boolean);
      if (parts.length < 2) return "";
      return prettyRoom(parts[0]);
    }
    function splitMark(name) {
      const parts = String(name || "").split(/\s*·\s*/).filter(Boolean);
      if (!parts.length) return { room: "", type: "" };
      if (parts.length === 1) return { room: "", type: parts[0] };
      return { room: prettyRoom(parts[0]), type: parts.slice(1).join(" · ") };
    }
    function composeMark(room, type) {
      const r = prettyRoom(room);
      const t = String(type || "").trim();
      if (!r || !t) return "";
      return r + " · " + t;
    }
    function roomsFromBus() {
      const set = new Set(deskRooms.map((r) => prettyRoom(r)).filter(Boolean));
      (lastShelvesRows || []).forEach((s) => {
        (s.channels || []).forEach((ch) => {
          const r = nameRoom(ch.name);
          if (r) set.add(r);
        });
      });
      return [...set].sort((a, b) => a.localeCompare(b, "ru"));
    }
    function makeChipBar(values, selected, onPick) {
      const bar = document.createElement("div");
      bar.className = "chips";
      values.forEach((v) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "chip";
        b.textContent = v;
        b.setAttribute("aria-pressed", v === selected ? "true" : "false");
        b.addEventListener("click", () => onPick(v));
        bar.appendChild(b);
      });
      return bar;
    }
    function fillRooms(bar) {
      if (!bar) return;
      const rooms = roomsFromBus();
      bar.replaceChildren();
      const all = document.createElement("button");
      all.type = "button";
      all.className = "chip";
      all.textContent = "Все модули";
      all.setAttribute("aria-pressed", roomFilter ? "false" : "true");
      all.addEventListener("click", () => {
        roomFilter = "";
        markPending = {};
        renderMark();
      });
      bar.appendChild(all);
      rooms.forEach((r) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "chip";
        const prog = countRoomMark(r);
        b.textContent = prog.named ? r + " · " + prog.named : r;
        b.setAttribute("aria-pressed", r === roomFilter ? "true" : "false");
        b.title = "Фильтр: модули с «" + r + "»";
        b.addEventListener("click", () => {
          roomFilter = r;
          markPending = {};
          renderMark();
        });
        bar.appendChild(b);
      });
      const add = document.createElement("button");
      add.type = "button";
      add.className = "chip add";
      add.textContent = "+ комната";
      add.addEventListener("click", () => {
        promptRoom().then((roomName) => {
          if (!roomName) return;
          roomFilter = roomName;
          markPending = {};
          renderMark();
        });
      });
      bar.appendChild(add);
    }
    function renderRoomBars() {
      fillRooms($("rooms-mark"));
    }
    async function loadRooms() {
      try {
        const r = await fetch("/runtime/desk-marking");
        const j = await r.json();
        if (j.ok && Array.isArray(j.rooms)) deskRooms = j.rooms;
      } catch (_) { /* стол ниже */ }
      renderMark();
    }
    function prettyContactName(name) {
      const t = String(name || "").trim();
      if (!t) return "";
      const parts = t.split(/\s*·\s*/).filter(Boolean);
      if (!parts.length) return "";
      parts[0] = prettyRoom(parts[0]);
      const room = parts[0];
      const esc = room.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      for (let i = 1; i < parts.length; i += 1) {
        parts[i] = parts[i].replace(new RegExp("\\s*" + esc + "\\s*$", "i"), "").trim();
      }
      return parts.filter(Boolean).join(" · ");
    }
    function channelRoom(ch) {
      return nameRoom(ch.name);
    }
    function knobNum(ch) {
      const c = String(ch.controlId || "");
      const d = /^(?:Curtain|Actuator)\s+(\d+)\s+(Open|Close)$/i.exec(c);
      if (d) return Number(d[1]) * 2 - (d[2].toLowerCase() === "open" ? 1.5 : 1.4);
      return Number((/(\d+)\s*$/.exec(c) || [])[1] || 0);
    }
    function appendChannelBlock(ul, s, channels) {
      const minCh = {};
      channels.forEach((ch) => {
        const room = channelRoom(ch);
        const n = knobNum(ch);
        if (room && (minCh[room] == null || n < minCh[room])) minCh[room] = n;
      });
      const rows = channels.slice().sort((a, b) => {
        const ra = channelRoom(a);
        const rb = channelRoom(b);
        const d = (minCh[ra] ?? 99) - (minCh[rb] ?? 99);
        if (d) return d;
        const rr = ra.localeCompare(rb, "ru");
        if (rr) return rr;
        return knobNum(a) - knobNum(b);
      });
      let last = "";
      rows.forEach((ch) => {
        const room = channelRoom(ch);
        if (room && room !== last) {
          const h = document.createElement("li");
          h.className = "roomh";
          h.textContent = room;
          ul.appendChild(h);
          last = room;
        }
        ul.appendChild(channelRow(s, ch, room));
      });
    }
    const MOD_ICO = {
      led: "<svg viewBox='0 0 24 24'><circle cx='12' cy='12' r='4'/><path d='M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41'/></svg>",
      dali: "<svg viewBox='0 0 24 24'><circle cx='12' cy='12' r='3'/><path d='M5 12h2M17 12h2M8.5 6.5l1.2 1.2M14.3 16.3l1.2 1.2M8.5 17.5l1.2-1.2M14.3 7.7l1.2-1.2'/></svg>",
      gpio: "<svg viewBox='0 0 24 24'><rect x='2' y='6' width='20' height='12' rx='3'/><circle cx='8' cy='12' r='2'/><path d='M14 10h4M14 14h2'/></svg>",
      mcm: "<svg viewBox='0 0 24 24'><rect x='2' y='5' width='20' height='14' rx='3'/><circle cx='7' cy='12' r='1.6'/><circle cx='12' cy='12' r='1.6'/><circle cx='17' cy='12' r='1.6'/></svg>",
      mr: "<svg viewBox='0 0 24 24'><path d='M12 3v3M8 8H5a2 2 0 0 0-2 2v7h18v-7a2 2 0 0 0-2-2h-3'/><rect x='8' y='3' width='8' height='5' rx='1'/><path d='M8 21h8'/></svg>",
      drive: "<svg viewBox='0 0 24 24'><path d='M4 4h16v16H4z'/><path d='M4 8h16M12 8v12'/></svg>",
    };
    function moduleKind(s) {
      const k = String(s.deviceTopicKey || "");
      if ((s.channels || []).some((ch) => isDeskDrive(ch.controlId))) return "drive";
      if (/gpio/i.test(k)) return "gpio";
      if (/mcm/i.test(k)) return "mcm";
      if (/dali|mdm/i.test(k)) return "dali";
      if (/led|ampled/i.test(k)) return "led";
      if (/mr6|mr12|mrm|mrps/i.test(k)) return "mr";
      return "led";
    }
    function moduleKindRu(kind) {
      if (kind === "gpio") return "GPIO";
      if (kind === "mcm") return "MCM";
      if (kind === "dali") return "DALI";
      if (kind === "drive") return "Привод";
      if (kind === "mr") return "Реле";
      return "LED";
    }
    function namedCount(s) {
      return visibleChannels(s).filter((c) => String(pairName(s, c) || "").trim()).length;
    }
    function moduleRoomsOf(s) {
      return [...new Set(visibleChannels(s).map((ch) => nameRoom(pairName(s, ch))).filter(Boolean))];
    }
    function sortModules(rows) {
      return rows.slice().sort((a, b) => {
        const na = Number((/№(\d+)/.exec(a.label || "") || [])[1] || 0);
        const nb = Number((/№(\d+)/.exec(b.label || "") || [])[1] || 0);
        return na - nb || String(a.label || "").localeCompare(String(b.label || ""), "ru");
      });
    }
    function moduleSlaveOf(s) {
      const fromRow = Number(s && s.slave);
      if (Number.isFinite(fromRow) && fromRow > 0) return fromRow;
      const fromLabel = Number((/№(\d+)/.exec((s && s.label) || "") || [])[1] || 0);
      if (fromLabel) return fromLabel;
      return Number((/_(\d+)$/.exec(String((s && s.deviceTopicKey) || "")) || [])[1] || 0);
    }
    function channelIsOn(ch) {
      const v = ch && ch.lastValue;
      if (v === 1 || v === true || v === "1" || v === "on") return true;
      if (typeof v === "number" && Number.isFinite(v) && v > 0) return true;
      if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(String(v).trim())) {
        return Number(v) > 0;
      }
      return false;
    }
    function litCount(s) {
      return visibleChannels(s).filter(channelIsOn).length;
    }
    function paintModuleFace(el, s, opts) {
      const drill = opts && opts.drill;
      const n = visibleChannels(s).length || s.channelCount || 0;
      const named = namedCount(s);
      const free = Math.max(0, n - named);
      const lit = litCount(s);
      const kind = moduleKind(s);
      el.classList.add("mod-card", "sky");
      if (lit) el.classList.add("amber", "lit");
      if (named) el.classList.add("on");
      el.replaceChildren();
      const top = document.createElement("div");
      top.className = "vtop";
      const ico = document.createElement("span");
      ico.className = "ico";
      ico.innerHTML = MOD_ICO[kind] || MOD_ICO.led;
      const cat = document.createElement("span");
      cat.className = "cat" + (named ? " on" : "");
      cat.textContent = named + "/" + n + " занято";
      top.append(ico, cat);
      const vt = document.createElement("span");
      vt.className = "vt";
      vt.textContent = s.label || s.deviceTopicKey;
      const vs = document.createElement("span");
      vs.className = "vs";
      vs.textContent = drill
        ? "Дальше: комната → тип нагрузки"
        : "Клеммы модуля · комната → тип";
      const bars = document.createElement("div");
      bars.className = "ch-bars";
      bars.setAttribute("aria-hidden", "true");
      visibleChannels(s).forEach((ch) => {
        const b = document.createElement("span");
        const on = channelIsOn(ch);
        const namedCh = Boolean(pairName(s, ch));
        b.className = "ch-bar" + (on ? " lit" : namedCh ? " named" : "");
        bars.appendChild(b);
      });
      if (!n) {
        const b = document.createElement("span");
        b.className = "ch-bar";
        bars.appendChild(b);
      }
      el.append(top, vt, vs, bars);
      if (!drill) {
        const foot = document.createElement("div");
        foot.className = "mod-foot";
        const open = document.createElement("span");
        open.className = "mod-open";
        open.textContent = "Открыть";
        const freeEl = document.createElement("span");
        freeEl.className = "mod-free";
        freeEl.textContent = free ? "свободно " + free : "все заняты";
        const badge = document.createElement("span");
        badge.className = "mod-badge" + (lit ? " lit" : "");
        badge.textContent = lit ? ("Горит " + lit) : "На шине";
        foot.append(open, freeEl, badge);
        el.appendChild(foot);
      } else {
        const pills = document.createElement("div");
        pills.className = "mod-pills";
        const occ = document.createElement("span");
        occ.className = "mod-pill";
        occ.textContent = named + "/" + n + " занято";
        const bus = document.createElement("span");
        bus.className = "mod-pill" + (lit ? " lit" : " on");
        bus.textContent = lit ? ("Горит " + lit) : "На шине";
        pills.append(occ, bus);
        el.appendChild(pills);
      }
    }
    function moduleTile(s) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "vcard";
      paintModuleFace(btn, s);
      btn.addEventListener("click", () => {
        openMod = s.deviceTopicKey;
        openAssign = "";
        renderMark();
      });
      return btn;
    }
    function drillChannelRow(s, ch) {
      const row = document.createElement("li");
      row.className = "drill-ch";
      const key = contactKey(s.deviceTopicKey, ch.controlId);
      row.dataset.contact = key;
      const original = pairName(s, ch);
      const bound = Boolean(original);
      const saved = splitMark(original);
      const pending = markPending[key] || {};
      const current = {
        room: pending.room || saved.room || "",
        type: pending.type || saved.type,
      };
      const assigning = openAssign === key;
      const input = isDeskInput(ch.controlId, s.deviceTopicKey);
      const load = !input && isDeskLoad(ch.controlId);
      const on = channelIsOn(ch);
      if (on) row.classList.add("lit");
      if (bound) row.classList.add("bound");
      if (assigning) row.classList.add("assign");
      if (input) row.classList.add("input");
      const main = document.createElement("div");
      main.className = "drill-main probe";
      const led = document.createElement("span");
      led.className = "ch-led " + (on ? "lit" : bound ? "ok" : "free");
      led.title = input
        ? (on ? "замкнуто" : "разомкнуто")
        : on ? "горит" : bound ? "привязан и выкл" : "на шине, свободен";
      const knob = document.createElement("span");
      knob.className = "knob";
      knob.textContent = prettyControlId(ch.controlId);
      const mid = document.createElement("button");
      mid.type = "button";
      mid.className = "drill-mid";
      const ttl = document.createElement("span");
      ttl.className = "ttl" + (bound ? "" : " mute");
      ttl.textContent = bound ? prettyContactName(original) : "Свободен";
      const sub = document.createElement("span");
      sub.className = "hint";
      if (input) {
        const listening = Date.now() < listenUntil;
        sub.textContent = on
          ? "Замкнуто"
          : listening
            ? "Слушаю замыкание…"
            : (bound ? (current.room || "комната") : "Нажмите выключатель");
        if (on) sub.classList.add("closed");
      } else {
        sub.textContent = bound
          ? (current.room || "комната")
          : "Комната не выбрана";
      }
      mid.append(ttl, sub);
      mid.addEventListener("click", () => {
        openAssign = assigning ? "" : key;
        renderMark();
      });
      const act = document.createElement("div");
      act.className = "drill-act";
      if (load) {
        act.appendChild(makeAppleSwitch({
          on: on,
          busy: Boolean(probeBusy[key]),
          title: on ? "Выключить канал" : "Включить канал",
          onToggle: (wantOn) => {
            void actuateChannel(s.deviceTopicKey, ch.controlId, wantOn ? "on" : "off");
          },
        }));
      } else if (input) {
        act.appendChild(makeAppleSwitch({
          on: on,
          live: true,
          disabled: true,
          title: on ? "Замкнуто" : "Разомкнуто — нажмите выключатель",
        }));
        const listen = document.createElement("button");
        listen.type = "button";
        listen.className = "ghost listen" + (Date.now() < listenUntil ? " active" : "");
        listen.textContent = Date.now() < listenUntil ? "…" : "Слушать";
        listen.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          startInputListen(14000);
        });
        act.appendChild(listen);
      }
      const bind = document.createElement("button");
      bind.type = "button";
      bind.className = "ghost bind";
      bind.textContent = assigning ? "Свернуть" : (bound ? "Изменить" : "Привязать");
      bind.addEventListener("click", () => {
        openAssign = assigning ? "" : key;
        renderMark();
      });
      act.appendChild(bind);
      if (bound) {
        const drop = document.createElement("button");
        drop.type = "button";
        drop.className = "ghost";
        drop.textContent = "Снять";
        drop.addEventListener("click", () => {
          openAssign = "";
          pickMark(s, ch, { room: "", type: "" });
        });
        act.appendChild(drop);
      }
      main.append(led, knob, mid, act);
      row.appendChild(main);
      if (assigning) {
        const fields = document.createElement("div");
        fields.className = "rows drill-fields";
        const isLoad = isDeskLoad(ch.controlId);
        const types = [...markTypes(s, ch, isLoad)];
        if (current.type && !types.includes(current.type)) types.push(current.type);
        fields.appendChild(makeField(
          "Комната",
          roomsFromBus(),
          current.room,
          "Выбрать",
          (v) => {
            if (!v) pickMark(s, ch, { room: "", type: "" });
            else pickMark(s, ch, { room: v });
          },
          "Новая комната…",
          () => promptRoom().then((name) => { if (name) pickMark(s, ch, { room: name }); }),
          !!(current.type && !current.room),
          true,
        ));
        fields.appendChild(makeField(
          typeSteph(s, ch, isLoad),
          types,
          current.type,
          "Выбрать",
          (v) => {
            if (!v) pickMark(s, ch, { room: "", type: "" });
            else pickMark(s, ch, { type: v });
          },
          "",
          null,
          !!(current.room && !current.type),
          true,
        ));
        row.appendChild(fields);
      }
      return row;
    }
    function renderModuleDrill(box, s) {
      const back = document.createElement("button");
      back.type = "button";
      back.className = "back ghost-back";
      back.setAttribute("aria-label", "Все модули");
      back.innerHTML = "<svg viewBox='0 0 24 24'><path d='M15 18l-6-6 6-6'/></svg><span>Все модули</span>";
      back.addEventListener("click", () => {
        openAssign = "";
        listenAutoMod = "";
        if (listenTimer) {
          clearInterval(listenTimer);
          listenTimer = 0;
          listenUntil = 0;
        }
        closeModule();
      });
      const head = document.createElement("div");
      head.className = "vcard";
      paintModuleFace(head, s, { drill: true });
      const chs = document.createElement("ul");
      chs.className = "channels drill-list";
      const inputs = visibleChannels(s).filter((ch) => isDeskInput(ch.controlId, s.deviceTopicKey));
      if (inputs.length && listenAutoMod !== s.deviceTopicKey) {
        listenAutoMod = s.deviceTopicKey;
        setTimeout(() => startInputListen(14000), 0);
      }
      visibleChannels(s).forEach((ch) => chs.appendChild(drillChannelRow(s, ch)));
      box.append(back, head, chs);
    }
    function fillRoomChannelList(box, rows, emptyText) {
      box.className = "modopen";
      const head = document.createElement("p");
      head.className = "meta";
      head.textContent = roomFilter + " — каналы комнаты и ещё без имени. Тип ниже.";
      const ul = document.createElement("ul");
      ul.className = "channels";
      let any = false;
      sortModules(rows).forEach((s) => {
        const chs = visibleChannels(s).filter((ch) => {
          const r = nameRoom(pairName(s, ch));
          return !r || r === roomFilter;
        });
        if (!chs.length) return;
        any = true;
        const mod = document.createElement("li");
        mod.className = "roomh";
        mod.textContent = s.label || s.deviceTopicKey;
        ul.appendChild(mod);
        chs.forEach((ch) => ul.appendChild(channelRow(s, ch, nameRoom(pairName(s, ch)) || roomFilter)));
      });
      if (!any) {
        box.className = "vitrine";
        const p = document.createElement("p");
        p.className = "empty";
        p.textContent = "В «" + roomFilter + "» пока пусто — или выберите другую комнату.";
        box.appendChild(p);
        return;
      }
      box.append(head, ul);
    }
    function modulesForFilter(rows) {
      const list = sortModules(rows || []);
      if (!roomFilter) return list;
      return list.filter((s) => {
        if (moduleRoomsOf(s).includes(roomFilter)) return true;
        return visibleChannels(s).some((ch) => !nameRoom(pairName(s, ch)));
      });
    }
    function fillModuleVitrine(box, rows, emptyText) {
      if (!box) return;
      box.replaceChildren();
      const filtered = modulesForFilter(rows);
      if (!filtered.length) {
        box.className = "vitrine";
        const p = document.createElement("p");
        p.className = "empty";
        p.textContent = emptyText;
        box.appendChild(p);
        return;
      }
      const open = filtered.find((s) => s.deviceTopicKey === openMod)
        || (rows || []).find((s) => s.deviceTopicKey === openMod);
      if (open) {
        box.className = "modopen";
        renderModuleDrill(box, open);
        return;
      }
      box.className = "vitrine";
      filtered.forEach((s) => box.appendChild(moduleTile(s)));
    }
    function appendRoomSection(box, title, rows) {
      const wrap = document.createElement("div");
      wrap.className = "mark-sec";
      const h = document.createElement("h3");
      h.textContent = title;
      wrap.appendChild(h);
      const ul = document.createElement("ul");
      ul.className = "channels compact";
      let any = false;
      sortModules(rows).forEach((s) => {
        // Только уже в этой комнате — без имени не дублируем в каждую комнату.
        const chs = visibleChannels(s).filter((ch) => nameRoom(pairName(s, ch)) === roomFilter);
        if (!chs.length) return;
        any = true;
        const mod = document.createElement("li");
        mod.className = "roomh";
        mod.textContent = s.label || s.deviceTopicKey;
        ul.appendChild(mod);
        chs.forEach((ch) => ul.appendChild(channelRow(s, ch, roomFilter)));
      });
      if (!any) {
        const p = document.createElement("p");
        p.className = "meta";
        p.textContent = "В комнате пока пусто — добавьте канал ниже.";
        wrap.appendChild(p);
      } else {
        wrap.appendChild(ul);
      }
      box.appendChild(wrap);
    }
    function collectUnbound(rows) {
      const out = [];
      sortModules(rows).forEach((s) => {
        visibleChannels(s).forEach((ch) => {
          if (!nameRoom(pairName(s, ch))) out.push({ s: s, ch: ch });
        });
      });
      return out;
    }
    function appendUnboundPicker(box, title, rows) {
      const free = collectUnbound(rows);
      if (!free.length) return;
      const det = document.createElement("details");
      det.className = "mark-free";
      const sum = document.createElement("summary");
      sum.textContent = "Добавить · " + title.toLowerCase() + " · " + free.length + " без имени";
      det.appendChild(sum);
      const ul = document.createElement("ul");
      ul.className = "channels compact";
      const lim = 8;
      free.slice(0, lim).forEach((row) => {
        ul.appendChild(channelRow(row.s, row.ch, roomFilter));
      });
      det.appendChild(ul);
      if (free.length > lim) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "ghost more-cards";
        more.textContent = "Ещё " + (free.length - lim);
        more.addEventListener("click", () => {
          free.slice(lim).forEach((row) => ul.appendChild(channelRow(row.s, row.ch, roomFilter)));
          more.remove();
        });
        det.appendChild(more);
      }
      box.appendChild(det);
    }
    function countRoomMark(room) {
      let named = 0;
      let free = 0;
      (lastShelvesRows || []).forEach((s) => {
        visibleChannels(s).forEach((ch) => {
          const r = nameRoom(pairName(s, ch));
          if (r === room) named += 1;
          else if (!r) free += 1;
        });
      });
      return { named: named, free: free };
    }
    function renderRoomsPath(box) {
      box.replaceChildren();
      if (!roomFilter) {
        box.className = "vitrine";
        const p = document.createElement("p");
        p.className = "empty";
        p.textContent = "Выберите комнату — в ней только её каналы. Без имени — блок «Добавить».";
        box.appendChild(p);
        return;
      }
      box.className = "mark-rooms";
      const head = document.createElement("header");
      head.className = "mark-room-head";
      const h = document.createElement("h2");
      h.textContent = roomFilter;
      const sub = document.createElement("p");
      sub.className = "meta";
      const prog = countRoomMark(roomFilter);
      const solN = deskSolutions.filter((sol) => {
        const room = roomFromContacts([sol.trigger].concat(sol.targets || []).filter(Boolean));
        return room === roomFilter;
      }).length;
      sub.textContent = "В комнате " + prog.named +
        (solN ? " · типовых " + solN : "") +
        (prog.free ? " · на шине без имени " + prog.free : "");
      head.append(h, sub);
      if (prog.named > 0) {
        const bar = document.createElement("div");
        bar.className = "pnr";
        const fill = document.createElement("div");
        fill.style.width = Math.min(100, 12 + prog.named * 8) + "%";
        bar.appendChild(fill);
        head.appendChild(bar);
      }
      const actions = document.createElement("div");
      actions.className = "mark-room-actions";
      if (prog.named > 0) {
        const go = document.createElement("button");
        go.type = "button";
        go.className = "ghost more-cards";
        go.textContent = "Типовые →";
        go.addEventListener("click", () => setTab("cards"));
        actions.appendChild(go);
      }
      const toMod = document.createElement("button");
      toMod.type = "button";
      toMod.className = "ghost more-cards";
      toMod.textContent = "К модулям";
      toMod.addEventListener("click", () => {
        roomFilter = "";
        openMod = "";
        markPath = "modules";
        renderMark();
      });
      actions.appendChild(toMod);
      if (actions.childNodes.length) head.appendChild(actions);
      box.appendChild(head);
      const split = splitShelves(lastShelvesRows);
      appendRoomSection(box, "Свет", split.light);
      appendRoomSection(box, "Кнопки", split.buttons);
      appendRoomSection(box, "Реле", split.relays);
      const freeWrap = document.createElement("div");
      freeWrap.className = "mark-free-wrap";
      const freeH = document.createElement("h3");
      freeH.className = "mark-free-title";
      freeH.textContent = "Добавить с шины";
      freeWrap.appendChild(freeH);
      appendUnboundPicker(freeWrap, "Свет", split.light);
      appendUnboundPicker(freeWrap, "Кнопки", split.buttons);
      appendUnboundPicker(freeWrap, "Реле", split.relays);
      if (freeWrap.querySelector("details")) box.appendChild(freeWrap);
    }
    function paintMarkPath() {
      document.querySelectorAll("#modFamily [data-fam]").forEach((btn) => {
        btn.setAttribute("aria-pressed", btn.dataset.fam === modFamily ? "true" : "false");
      });
    }
    function countUnboundAll() {
      let n = 0;
      (lastShelvesRows || []).forEach((s) => {
        visibleChannels(s).forEach((ch) => {
          if (!nameRoom(pairName(s, ch))) n += 1;
        });
      });
      return n;
    }
    function renderMark() {
      lastShelvesRows = lastShelvesRows || [];
      const split = splitShelves(lastShelvesRows);
      markPath = "modules";
      const namedRooms = roomsFromBus().length;
      const unbound = countUnboundAll();
      const nMark = $("n-mark");
      if (nMark) {
        nMark.textContent = unbound ? String(unbound) : (namedRooms || "");
      }
      const roomsBar = $("rooms-mark");
      if (roomsBar) roomsBar.hidden = true;
      paintMarkPath();
      const body = $("mark-body");
      if (!body) return;
      body.hidden = false;
      const famRows = modFamily === "all"
        ? sortModules([].concat(split.light || [], split.buttons || [], split.relays || []))
        : (split[modFamily] || []);
      const empty = modFamily === "buttons"
        ? "Кнопок на шине нет."
        : modFamily === "relays"
          ? "Реле на шине нет."
          : modFamily === "light"
            ? "Света на шине нет. Нажмите «Обновить»."
            : "Модулей на шине нет. Нажмите «Обновить».";
      fillModuleVitrine(body, famRows, empty);
    }
    function renderShelves(rows) {
      lastShelvesRows = rows || [];
      renderMark();
    }
    async function scanNow() {
      $("scan").disabled = true;
      try {
        const r = await fetch("/runtime/mqtt-scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ instant: true }),
        });
        const j = await r.json();
        if (!j.ok) {
          if (!lastShelvesRows.length) {
            $("bus").className = "meta bad";
            $("bus").style.color = "rgb(var(--bad))";
            delete $("bus").dataset.base;
          $("bus").textContent = j.error || "Скан не вышел";
          }
          return;
        }
        if (j.shelves && j.shelves.length) showShelves(j);
      } catch (e) {
        if (!lastShelvesRows.length) {
          $("bus").className = "meta";
          $("bus").style.color = "rgb(var(--bad))";
          delete $("bus").dataset.base;
          $("bus").textContent = String(e.message || e);
        }
      } finally {
        $("scan").disabled = false;
      }
    }
    $("scan").onclick = () => { void scanNow(); };
    if ($("fieldCert")) $("fieldCert").onclick = () => { void openFieldCert(); };
    $("cardMask").addEventListener("click", closeCardSheet);
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!$("cardSheet").hidden) {
        closeCardSheet();
        return;
      }
      if (openSceneId) {
        closeScene();
        return;
      }
      if (openContact) {
        closeContact();
        return;
      }
      if (openMod) closeModule();
    });
    function showShelves(j) {
      const shelves = j.shelves || [];
      $("bus").className = "meta";
      $("bus").style.color = "";
      const named = shelves.reduce(function (n, s) {
        return n + (s.channels || []).filter(function (c) { return c.source === "rules" && c.name; }).length;
      }, 0);
      const line = shelves.length + " модулей" +
        (named ? " · " + named + " имён из разметки" : "");
      $("bus").dataset.base = line;
      $("bus").textContent = line;
      $("bus").title = j.brokerLabel ? ("Шина " + j.brokerLabel) : "";
      renderShelves(shelves);
      stampBusGaps();
      liveKeys = { ready: true };
      shelves.forEach((s) => { liveKeys[s.deviceTopicKey] = true; });
      renderPoured();
      loadPreview();
      if (shelves.length) $("scan").textContent = "Обновить";
    }
    async function loadPoured() {
      try {
        const r = await fetch("/runtime/desk-poured");
        const j = await r.json();
        if (!j.ok) {
          $("pouredHead").style.color = "rgb(var(--bad))";
          $("pouredHead").textContent = j.error || "Не прочитал залитое";
          return;
        }
        pouredRules = j.rules || [];
        const headEl = $("pouredHead");
        if (headEl) {
          headEl.hidden = false;
          headEl.style.color = "";
          const headShort = j.revisionId
            ? String(j.revisionId).replace(/^fnv1a32:/i, "").slice(0, 8)
            : "";
          const files = (j.files || []).map((f) => f.filename).filter(Boolean);
          headEl.textContent = (j.ruleCount || pouredRules.length) + " правил"
            + (headShort ? " · " + headShort : "")
            + (files.length ? " · " + releaseWhatRu({ files: files, fileCount: files.length }) : "");
          if (j.revisionId) headEl.title = String(j.revisionId);
        }
        await loadReleases();
        renderPoured();
        loadPreview();
      } catch (e) {
        $("pouredHead").style.color = "rgb(var(--bad))";
        $("pouredHead").textContent = String(e.message || e);
      }
    }
    async function loadReleases() {
      try {
        const r = await fetch("/runtime/releases");
        const j = await r.json();
        if (j.ok) {
          lastReleases = j.pushes || j.releases || [];
          canPourDesk = j.canPour === true;
          canPourNamesDesk = j.canPourNames === true;
          canPourRulesDesk = j.canPourRules === true;
          canRepairDesk = j.canRepair === true;
          paintPourButtons();
        }
      } catch (_) {
        lastReleases = lastReleases || [];
      }
    }
    async function loadLast() {
      try {
        const r = await fetch("/runtime/mqtt-scan");
        const j = await r.json();
        if (j.ok && j.shelves && j.shelves.length) showShelves(j);
      } catch (_) { /* зеркало ниже */ }
      await scanNow();
    }
    function runDeskPour(scope, btn) {
      if (!btn || btn.disabled) return;
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = scope === "names" ? "Имена…" : scope === "rules" ? "Сценарии…" : "Убираю…";
      fetch("/runtime/desk-pour", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: scope === "repair" ? "names" : scope }),
      })
        .then((r) => r.json())
        .then((j) => {
          btn.textContent = label;
          if (!j.ok) {
            paintPourButtons();
            const head = $("previewHead");
            if (head) {
              head.hidden = false;
              head.style.color = "rgb(var(--bad))";
              head.textContent = humanPourError(j.error || j.reason || "Не залил");
            }
            return;
          }
          const head = $("previewHead");
          if (head) {
            head.hidden = false;
            head.style.color = "";
            const scopeRu = j.scope === "rules" ? "Сценарии" : j.scope === "names" ? "Имена" : "Щит";
            const bits = [
              j.mqttOnly ? "Дубли спрятаны" : scopeRu,
              j.restarted ? "перезапуск wb-rules" : "",
              j.namedCount ? ("имён " + j.namedCount) : "",
              j.emittedSolutions ? ("сценариев " + j.emittedSolutions) : "",
              j.hiddenGhosts ? ("скрыто " + j.hiddenGhosts) : "",
              j.appliedRevisionId
                ? String(j.appliedRevisionId).replace(/^fnv1a32:/i, "").slice(0, 8)
                : "",
            ].filter(Boolean);
            head.textContent = bits.join(" · ") || "Готово";
          }
          pouredPane = "hist";
          openPourMod = "";
          loadPoured();
          loadPreview();
        })
        .catch((e) => {
          btn.textContent = label;
          paintPourButtons();
          const head = $("previewHead");
          if (head) {
            head.hidden = false;
            head.style.color = "rgb(var(--bad))";
            head.textContent = humanPourError(e && e.message);
          }
        });
    }
    document.querySelectorAll(".tab").forEach((btn) => {
      btn.addEventListener("click", () => setTab(btn.dataset.tab));
    });
    document.querySelectorAll("#modFamily [data-fam]").forEach((btn) => {
      btn.addEventListener("click", () => {
        modFamily = /^(all|light|buttons|relays)$/.test(btn.dataset.fam) ? btn.dataset.fam : "all";
        openMod = "";
        openAssign = "";
        markPending = {};
        markPath = "modules";
        renderMark();
      });
    });
    if ($("clearMarks")) {
      $("clearMarks").addEventListener("click", () => {
        if (
          !window.confirm(
            "Снять всю разметку со стола?\nИмена и карточки исчезнут. Типовые и журнал останутся. Щит не трогаем.",
          )
        ) {
          return;
        }
        const btn = $("clearMarks");
        btn.disabled = true;
        fetch("/runtime/desk-marking", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ clear: true }),
        })
          .then((r) => r.json())
          .then((j) => {
            btn.disabled = false;
            markPending = {};
            const head = $("previewHead");
            if (head) {
              head.style.color = "";
              head.textContent = j && j.ok
                ? "Разметка снята" + (j.cleared ? " · " + j.cleared : "") + ". Можно размечать заново."
                : "Не снял разметку";
            }
            return loadLast().then(() => loadPreview());
          })
          .catch(() => {
            btn.disabled = false;
          });
      });
    }
    if ($("pourNames")) {
      $("pourNames").addEventListener("click", () => {
        if (!canPourNamesDesk) return;
        runDeskPour("names", $("pourNames"));
      });
    }
    if ($("pourRules")) {
      $("pourRules").addEventListener("click", () => {
        if (!canPourRulesDesk) return;
        runDeskPour("rules", $("pourRules"));
      });
    }
    if ($("pour")) {
      $("pour").addEventListener("click", () => {
        if (!canRepairDesk || $("pour").disabled) return;
        runDeskPour("repair", $("pour"));
      });
    }
    const fromHash = location.hash.replace("#", "");
    if (/^(mark|cards|poured|light|buttons|relays)$/.test(fromHash)) setTab(fromHash);
    else setTab("mark");
    loadHealth();
    loadPoured();
    loadRooms();
    loadLast();
    loadSolutions();
 
