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
    let activeTab = "light";
    let deskCatalog = [];
    let deskSolutions = [];
    let cardFilter = "Свет";
    let deskRooms = [];
    let markPending = {};
    let roomFilter = "";
    let openMod = "";
    let pouredPane = "mark";
    let lastReleases = [];
    let canPourDesk = false;
    let canRepairDesk = false;
    let openSceneId = "";
    let openContact = "";
    let wantButtonFocus = false;
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
    function enrollRu(s) {
      if (s === "restored" || s === "online" || s === "enrolled_awaiting_heartbeat") return "на связи";
      if (s === "enrolling") return "подключаюсь";
      if (s === "enroll_failed" || s === "enroll_transient") return "нет связи";
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
      markPending = {};
      renderShelves(lastShelvesRows);
      renderRoomBars();
    }
    function setTab(tab, keepMod) {
      if (!/^(light|buttons|relays|cards|poured)$/.test(tab)) return;
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
      canRepairDesk = j.canRepair === true || canPourDesk;
      $("pour").disabled = !(canPourDesk || canRepairDesk);
      $("pour").title = canPourDesk
        ? "Записать на щит: имена и типовые (переключение / все выкл)"
        : canRepairDesk
          ? "Убрать дубли FORM LOGIC OS"
          : (j.reason || "");
      $("previewHead").style.color = "";
      const ready = j.ready || {};
      const readyBits = [
        (ready.solutions || 0) + " типовых на столе",
        (ready.blocked || 0) + " без имени",
        (ready.gaps || 0) + " без карточки",
      ].join(" · ");
      lastPreview = { rows: rows, gaps: gaps, ready: ready, reason: j.reason || "" };
      $("previewHead").textContent = (j.reason || "Диск не трогаем.") + " · " + readyBits +
        (rows.length ? " · " + rows.length + " отличий" : "");
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
          $("previewHead").style.color = "rgb(var(--bad))";
          $("previewHead").textContent = j.error || "Нет превью";
          return;
        }
        renderPreview(j);
      } catch (e) {
        $("previewHead").style.color = "rgb(var(--bad))";
        $("previewHead").textContent = String(e.message || e);
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
      if (s === "new_name" || s === "name" || s === "blocked") return "send";
      return "disk";
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
        pouredPane = "mark";
        renderReady();
      });
      box.appendChild(back);
      if (!lastReleases.length) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = "Пока нет заливок. Первая появится после «Залить на щит».";
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
        const n = rel.fileCount || (rel.files || []).length;
        const parent = lastReleases.find((p) => p.revisionId === rel.parentId);
        const parentShort = rel.parentShortId || (parent && (parent.shortId || parent.label)) || "";
        const caret = rel.current && (parentShort || rel.parentId) ? "^ " + (parentShort || rel.parentId) : "";
        const when = relWhen(rel.savedAt);
        const timeOnly = when.includes(" ") ? when.split(" ").slice(1).join(" ") : when;
        const sameWhen = rel.current && parent && relWhen(rel.savedAt) === relWhen(parent.savedAt);
        hint.textContent = [sameWhen ? "" : timeOnly, caret, n ? fileRu(n) : ""].filter(Boolean).join(" · ");
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
          go.className = "ghost";
          go.textContent = "Вернуть";
          go.title = "Вернуть эту заливку на щит и спрятать лишнее в FORM LOGIC OS";
          go.addEventListener("click", () => {
            go.disabled = true;
            fetch("/runtime/rollback?revisionId=" + encodeURIComponent(rel.revisionId), { method: "POST" })
              .then((r) => r.json())
              .then((j) => {
                if (!j || (j.status !== "applied" && !j.ok)) {
                  go.disabled = false;
                  go.title = (j && (j.error || (j.reasons || []).join(" · "))) || "Не вернул";
                  return;
                }
                loadPoured();
                loadReleases().then(() => renderReady());
              })
              .catch(() => { go.disabled = false; });
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
      return !!(openSceneId || openContact);
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
      const tabs = [
        { id: "mark", ru: "Разметка" },
        { id: "rules", ru: "Сценарии" },
        { id: "send", ru: "Новое" + (sendN ? " · " + sendN : "") },
        { id: "hist", ru: "Журнал" + (lastReleases.length ? " · " + lastReleases.length : "") },
      ];
      if (!tabs.some((t) => t.id === pouredPane)) pouredPane = "mark";
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
          pouredPane = t.id;
          renderReady();
        });
        bar.appendChild(b);
      });
      const wrap = $("pourWrap");
      if (wrap) {
        // «Залить» виден на «Новое» и в журнале; на разметке/сценариях — нет.
        const showPour = (pouredPane === "send" || pouredPane === "hist") && !pouredOpen();
        wrap.hidden = !showPour;
        const pourBtn = $("pour");
        const canAct = canPourDesk || canRepairDesk;
        pourBtn.disabled = !canAct;
        if (pouredPane === "hist" && canPourDesk) {
          pourBtn.textContent = "Залить на щит";
          pourBtn.title = "Записать имена и типовые со стола на щит";
        } else if (pouredPane === "hist") {
          pourBtn.textContent = "Убрать дубли";
          pourBtn.title = canRepairDesk
            ? "Спрятать лишние строки FORM LOGIC OS"
            : (lastPreview.reason || "Нечего убирать");
        } else {
          pourBtn.textContent = "Залить на щит";
          pourBtn.title = canPourDesk
            ? "Записать имена и типовые на щит"
            : (lastPreview.reason || "Пока нечего лить");
        }
      }
      $("n-poured").textContent = diskN || "";
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
      ["pouredTabs", "previewHead", "pouredHead"].forEach((id) => {
        const el = $(id);
        if (el) el.hidden = !!drill;
      });
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
        empty.textContent = "Сначала имя линии на вкладке Свет.";
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
          loadSolutions().then(() => { loadPreview(); renderReady(); });
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
        renderHistory(box);
        const head = $("previewHead");
        if (head) {
          head.style.color = "";
          head.textContent = canPourDesk
            ? "Сверху — что сейчас на щите. «Залить на щит» — сохранить. «Вернуть» — откатить. Стрелка — к разметке."
            : canRepairDesk
              ? "Сверху — что сейчас на щите. «Вернуть» — откатить. «Убрать дубли» — спрятать лишнее. Стрелка — к разметке."
              : "Сверху — что сейчас на щите. «Вернуть» — откатить к этой заливке. Стрелка — к разметке.";
        }
        return;
      }
      const items = paneItems(all);
      function paintItems(list) {
        const rooms = roomsFromBus().slice();
        if (list.some((i) => !i.room)) rooms.push("");
        rooms.forEach((room) => {
          const mine = list.filter((i) => (i.room || "") === room);
          if (!mine.length) return;
          const h = document.createElement("p");
          h.className = "roomh";
          h.textContent = room || "Без комнаты";
          box.appendChild(h);
          if (pouredPane === "rules") {
            const ul = document.createElement("ul");
            ul.className = "channels";
            mine.slice().sort(byContact).forEach((i) => ul.appendChild(readyCard(i, room)));
            box.appendChild(ul);
            return;
          }
          READY_BUCKETS.forEach((b) => {
            const chunk = mine.filter((i) => i.bucket === b.id);
            if (!chunk.length) return;
            const sech = document.createElement("p");
            sech.className = "sech";
            sech.textContent = b.ru;
            box.appendChild(sech);
            const ul = document.createElement("ul");
            ul.className = "channels";
            chunk.slice().sort(byContact).forEach((i) => ul.appendChild(readyCard(i, room)));
            box.appendChild(ul);
          });
        });
      }
      if (pouredPane === "send") paintItems(items);
      else {
        const onCtl = items.filter((i) => !isNewItem(i));
        const neu = items.filter(isNewItem);
        paintItems(onCtl);
        if (neu.length && onCtl.length) {
          const h = document.createElement("p");
          h.className = "roomh";
          h.textContent = "Новое";
          box.appendChild(h);
        }
        paintItems(neu);
      }
      if (!items.length) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = pouredPane === "send" ? "Нового нет — стол совпадает с контроллером."
          : pouredPane === "rules" ? "Сценариев на контроллере пока нет."
          : "Разметки пока нет.";
        box.appendChild(empty);
      }
      const head = $("previewHead");
      if (head) {
        const ready = lastPreview.ready || {};
        const bits = [
          (ready.blocked || 0) + " без имени",
          (ready.gaps || 0) + " без карточки",
        ].join(" · ");
        head.style.color = "";
        if (pouredPane === "send") {
          const noCard = items.filter((i) => !i.scene && !(i.cards || []).length && !(i.hints || []).length).length;
          head.textContent = (canPourDesk ? "Новое на столе. «Залить на щит» — записать сюда." : "Новое. " + (lastPreview.reason || "Пока нечего лить."))
            + (noCard ? " · " + noCard + " без карточки" : "");
        } else {
          head.textContent = (pouredPane === "rules"
            ? "Сценарии. Логика — типовые и сценарии."
            : "Разметка. Комната и тип.") + " · " + bits;
        }
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
      return named.concat(rest);
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
      deskSolutions.filter((sol) => catOfSol(sol) === cardFilter).forEach((sol) => {
        const li = document.createElement("li");
        const t = (sol.targets || []).map(solContactLabel).join(" · ");
        li.innerHTML = "";
        const left = document.createElement("div");
        left.innerHTML = "<strong></strong><div class=\"meta\"></div>";
        left.querySelector("strong").textContent = sol.title || sol.solutionId;
        left.querySelector(".meta").textContent = solContactLabel(sol.trigger) + (t ? " → " + t : "");
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
        ? n + " сценариев уже на контроллере — вкладка Залито. Новые карточки пока только на столе."
        : "На диске пользовательских сценариев нет.";
    }
    function closeCardSheet() {
      $("cardSheet").hidden = true;
      $("cardMask").hidden = true;
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
        trigLab.textContent = "Кнопка / датчик";
        trig = document.createElement("select");
        trig.className = "bind";
        trig.setAttribute("aria-label", "Кнопка или датчик");
        fillSelect(trig, namedTriggers(), "С этой шины");
        if (draft && draft.trigger) trig.value = contactKey(draft.trigger.deviceTopicKey, draft.trigger.controlId);
      } else {
        trigLab.textContent = "Расписание";
        const note = document.createElement("p");
        note.className = "meta";
        note.textContent = "По cron. Время настроим при заливке. Сейчас — линии с этой шины.";
        trig = note;
      }
      const tgtLab = document.createElement("span");
      tgtLab.className = "fld";
      tgtLab.textContent = card.multi ? "Линии" : "Линия";
      const loads = namedLoads();
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
          empty.textContent = "Сначала имя линии на вкладке Свет.";
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
        tgt.setAttribute("aria-label", "Линия");
        fillSelect(tgt, loads, "Из этой разметки");
        if (draft && draft.targets && draft.targets[0]) {
          tgt.value = contactKey(draft.targets[0].deviceTopicKey, draft.targets[0].controlId);
        }
        tgtNode = tgt;
        collectTargets = () => [parseBindValue(tgt.value)].filter(Boolean);
      }
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
          }),
        }).then((r) => r.json()).then((j) => {
          if (!j.ok) {
            err.textContent = j.error === "need_trigger" ? "Нужна кнопка с шины"
              : j.error === "need_target" || j.error === "need_load" ? "Нужна линия из разметки"
              : (j.error || "Не сохранил");
            return;
          }
          closeCardSheet();
          loadSolutions();
          const hit = (j.solution && j.solution.targets && j.solution.targets[0]) || collectTargets()[0];
          loadLast().then(() => {
            if (hit) jumpToContact(hit.deviceTopicKey, hit.controlId);
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
      body.append(trigLab, trig, tgtLab, tgtNode, err);
      box.append(head, body, actions);
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
        b.addEventListener("click", () => { cardFilter = cat; renderVitrine(); renderDeskSolutions(); });
        filters.appendChild(b);
      });
      const grid = $("vitrine");
      grid.replaceChildren();
      deskCatalog.filter((c) => c.cat === cardFilter).forEach((card) => {
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
              ? onDesk.length + " на столе · нажмите — ещё одно"
              : solContactLabel(onDesk[0].trigger) + " → " + onDesk[0].targets.map(solContactLabel).join(" · "))
          : card.summary;
        // Всегда новое: иначе клик правит onDesk[0] и нельзя добавить второй вкл/дим.
        btn.addEventListener("click", () => openCardSheet(card, null));
        grid.appendChild(btn);
      });
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
      const line = box.querySelector("p");
      try {
        const r = await fetch("/runtime/health");
        const j = await r.json();
        const en = enrollRu(j.enrollment && j.enrollment.state);
        const topics = j.mqttMirror && j.mqttMirror.topicCount;
        const ver = String(j.agentVersion || "").replace(/^.*\./, "");
        box.className = "glass status " + (j.ok ? "ok" : "bad");
        line.textContent = j.ok
          ? "Агент · " + en + (ver ? " · " + ver : "") + (topics != null ? " · " + topics + " топиков" : "")
          : "Агент не ответил";
      } catch (e) {
        box.className = "glass status bad";
        line.textContent = "Нет /runtime/health — откройте этот адрес с машины в сети щита.";
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
      return all;
    }
    function loadsForRoom(room) {
      const all = namedLoads();
      if (!room) return all;
      const hit = all.filter((r) => r.room === room);
      return hit.length ? hit : all;
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
      openMod = key;
      setTab(familyOf({ deviceTopicKey: key }), true);
      renderShelves(lastShelvesRows);
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
        room: patch.room != null ? patch.room : (prev.room || saved.room),
        type: patch.type != null ? patch.type : (prev.type || saved.type),
      };
      markPending[k] = d;
      const next = composeMark(d.room, d.type);
      if (!next) {
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
      Promise.all(jobs).then(() => loadLast()).catch(() => {});
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
        room: pending.room || saved.room,
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
        (v) => { if (v) pickMark(s, ch, { room: v }); },
        "Новая комната…",
        () => promptRoom().then((name) => { if (name) pickMark(s, ch, { room: name }); }),
        !!(current.type && !current.room),
      ));
      fields.appendChild(makeField(
        typeSteph(s, ch, isLoad),
        types,
        current.type,
        "Выбрать",
        (v) => { if (v) pickMark(s, ch, { type: v }); },
        "",
        null,
        !!(current.room && !current.type),
      ));
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
      const rooms = roomsFromBus();
      bar.replaceChildren();
      rooms.forEach((r) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "chip";
        b.textContent = r;
        b.setAttribute("aria-pressed", r === roomFilter ? "true" : "false");
        b.addEventListener("click", () => {
          roomFilter = roomFilter === r ? "" : r;
          renderRoomBars();
          renderShelves(lastShelvesRows);
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
          renderRoomBars();
          renderShelves(lastShelvesRows);
        });
      });
      bar.appendChild(add);
    }
    function renderRoomBars() {
      const fam = openMod ? familyOf({ deviceTopicKey: openMod }) : "";
      ["rooms-light", "rooms-buttons", "rooms-relays"].forEach((id) => {
        const bar = $(id);
        if (!bar) return;
        bar.hidden = !!fam && id === "rooms-" + fam;
        if (!bar.hidden) fillRooms(bar);
      });
    }
    async function loadRooms() {
      try {
        const r = await fetch("/runtime/desk-marking");
        const j = await r.json();
        if (j.ok && Array.isArray(j.rooms)) deskRooms = j.rooms;
      } catch (_) { /* стол ниже */ }
      renderRoomBars();
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
    function paintModuleFace(el, s) {
      const n = visibleChannels(s).length || s.channelCount || 0;
      const named = namedCount(s);
      const rooms = moduleRoomsOf(s);
      const kind = moduleKind(s);
      el.innerHTML = "<span class=\"vtop\"><span class=\"ico\"></span><span class=\"cat\"></span></span><span class=\"vt\"></span><span class=\"vs\"></span>";
      el.querySelector(".ico").innerHTML = MOD_ICO[kind] || MOD_ICO.led;
      const cat = el.querySelector(".cat");
      cat.textContent = named ? named + " из " + n : (n ? n + " кан." : moduleKindRu(kind));
      if (named) cat.classList.add("on");
      el.querySelector(".vt").textContent = s.label || s.deviceTopicKey;
      el.querySelector(".vs").textContent = rooms.length ? rooms.join(" · ") : "без имён";
    }
    function moduleTile(s) {
      const named = namedCount(s);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "vcard" + (named ? " on" : "");
      if (roomFilter && moduleRoomsOf(s).includes(roomFilter)) btn.classList.add("on");
      paintModuleFace(btn, s);
      btn.addEventListener("click", () => {
        openMod = s.deviceTopicKey;
        renderShelves(lastShelvesRows);
        renderRoomBars();
      });
      return btn;
    }
    function renderModuleDrill(box, s) {
      const back = document.createElement("button");
      back.type = "button";
      back.className = "back";
      back.setAttribute("aria-label", "К модулям");
      back.innerHTML = "<svg viewBox='0 0 24 24'><path d='M15 18l-6-6 6-6'/></svg><span>К модулям</span>";
      back.addEventListener("click", closeModule);
      const head = document.createElement("div");
      head.className = "vcard" + (namedCount(s) ? " on" : "");
      paintModuleFace(head, s);
      const chs = document.createElement("ul");
      chs.className = "channels";
      appendChannelBlock(chs, s, visibleChannels(s));
      box.append(back, head, chs);
    }
    function fillList(id, rows, emptyText) {
      const box = $(id);
      box.replaceChildren();
      if (!rows.length) {
        box.className = "vitrine";
        const p = document.createElement("p");
        p.className = "empty";
        p.textContent = emptyText;
        box.appendChild(p);
        return;
      }
      const open = rows.find((s) => s.deviceTopicKey === openMod);
      if (open) {
        box.className = "modopen";
        renderModuleDrill(box, open);
        return;
      }
      box.className = "vitrine";
      sortModules(rows).forEach((s) => box.appendChild(moduleTile(s)));
    }
    function renderShelves(rows) {
      lastShelvesRows = rows || [];
      const split = splitShelves(lastShelvesRows);
      fillList("shelves-light", split.light, "Света на шине нет.");
      fillList("shelves-buttons", split.buttons, "Кнопок на шине нет.");
      fillList("shelves-relays", split.relays, "Реле на шине нет.");
      const openRelay = split.relays.some((s) => s.deviceTopicKey === openMod);
      $("relaysHead").textContent = openRelay
        ? "На канале — комната, тип и кнопка. Сценарии — на Залито."
        : "Реле — свет 220 В и силовые. Ткни модуль.";
      $("n-light").textContent = split.light.length || "";
      $("n-buttons").textContent = split.buttons.length || "";
      $("n-relays").textContent = split.relays.length || "";
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
        (j.brokerLabel ? " · " + j.brokerLabel : "") +
        (named ? " · " + named + " имён из разметки" : "");
      $("bus").dataset.base = line;
      $("bus").textContent = line;
      renderShelves(shelves);
      renderRoomBars();
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
        const files = (j.files || []).map((f) => f.filename).join(", ");
        $("pouredHead").style.color = "";
        const headShort = j.revisionId
          ? String(j.revisionId).replace(/^fnv1a32:/i, "").slice(0, 8)
          : "";
        $("pouredHead").textContent = (j.ruleCount || pouredRules.length) + " правил" +
          (headShort ? " · " + headShort : "") +
          (files ? " · " + files : "");
        if (j.revisionId) $("pouredHead").title = String(j.revisionId);
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
          canRepairDesk = j.canRepair === true || canPourDesk;
          if ($("pour")) $("pour").disabled = !(canPourDesk || canRepairDesk);
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
    document.querySelectorAll(".tab").forEach((btn) => {
      btn.addEventListener("click", () => setTab(btn.dataset.tab));
    });
    $("pour").addEventListener("click", () => {
      if ((!canPourDesk && !canRepairDesk) || $("pour").disabled) return;
      const onHist = pouredPane === "hist";
      $("pour").disabled = true;
      $("pour").textContent = onHist && !canPourDesk ? "Убираю…" : "Заливаю…";
      fetch("/runtime/desk-pour", { method: "POST" })
        .then((r) => r.json())
        .then((j) => {
          $("pour").textContent = onHist && !canPourDesk ? "Убрать дубли" : "Залить на щит";
          if (!j.ok) {
            $("pour").disabled = !(canPourDesk || canRepairDesk);
            $("previewHead").style.color = "rgb(var(--bad))";
            $("previewHead").textContent = j.error || j.reason || "Не залил";
            return;
          }
          $("previewHead").style.color = "";
          const bits = [
            j.mqttOnly ? "Дубли спрятаны" : ("Залито · " + (j.appliedRevisionId || "").replace(/^fnv1a32:/i, "").slice(0, 8)),
            j.restarted ? "правила перезапущены" : "",
            j.hiddenGhosts ? ("скрыто " + j.hiddenGhosts) : "",
          ].filter(Boolean);
          $("previewHead").textContent = bits.join(" · ") || "Готово";
          pouredPane = "hist";
          loadPoured();
          loadPreview();
        })
        .catch((e) => {
          $("pour").textContent = onHist && !canPourDesk ? "Убрать дубли" : "Залить на щит";
          $("pour").disabled = !(canPourDesk || canRepairDesk);
          $("previewHead").style.color = "rgb(var(--bad))";
          $("previewHead").textContent = String(e.message || e);
        });
    });
    const fromHash = location.hash.replace("#", "");
    if (/^(light|buttons|relays|cards|poured)$/.test(fromHash)) setTab(fromHash);
    loadHealth();
    loadPoured();
    loadRooms();
    loadLast();
    loadSolutions();
  
