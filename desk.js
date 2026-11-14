(function installDeskWriteAuth() {
  const meta = document.querySelector('meta[name="flos-desk-token"]');
  const token = meta && meta.getAttribute("content");
  if (!token) return;
  const orig = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const method = String((init && init.method) || (typeof input !== "string" && input && input.method) || "GET").toUpperCase();
    if (url.indexOf("/runtime/") === 0 && method !== "GET" && method !== "HEAD") {
      const headers = new Headers((init && init.headers) || (typeof input !== "string" && input && input.headers) || {});
      if (!headers.has("authorization")) headers.set("authorization", "Bearer " + token);
      init = Object.assign({}, init || {}, { headers: headers });
    }
    return orig(input, init);
  };
})();
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
    let activeTab = "intro";
    let markPath = "modules";
    let modFamily = "all";
    let keyPlan = [];
    let walkSite = { kind: "", floors: 1 };
    let walkRooms = [];
    let walkCatalog = [];
    let walkPurposes = [];
    let walkLightPurposes = { led: [], relay: [] };
    let walkRoomOpen = false;
    let keyScan = null; /* { id, need, count, hitKey, baseline, prevClosed } */
    let keyCatch = null; /* топик пойман, ждёт комнату и подпись */
    let keyScanTimer = 0;
    let keyScanBusy = false;
    let keyPlanNote = "";
    let lastBusScan = null;
    let markingUnreadable = false;
    let shieldClockOk = true;
    let shieldClockUnverified = false;
    let shieldClockLabel = "";
    let shieldClockSource = "";
    let shieldClockZone = "";
    let clockZones = [];
    let keyRoomFilter = "";
    let keyPlanFocus = false; /* после «+» вернуть фокус в поле подписей */
    let linePlan = [];
    let lineRoomFilter = "";
    let linePlanFocus = false;
    let linePlanNote = "";
    let pairBusy = false;
    let lineBeacon = null; /* { current, busy } — горит один канал */
    let lineBeaconFamily = "dim"; /* dim | led | dali | mdm | mr */
    let lineBeaconCandidates = [];
    let lineBeaconLoading = false;
    let lineBeaconFamilyLoaded = "";
    let beaconPick = 0;
    let pairListen = null; /* { timer, baseline, prevClosed, last } */
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
    ];
    let deskRooms = [];
    let markPending = {};
    let roomFilter = "";
    let modQuery = "";
    let openMod = "";
    let pouredPane = "send";
    let rulesFileText = "";
    let haLights = null;
    let haDrafts = new Map();
    function haRowKey(row) {
      return row.deviceTopicKey + "\0" + row.controlId;
    }
    let activeNav = "guide";
    let deskNavLive = false;
    const NAV = {
      guide: { tab: "intro", title: "Туториал" },
      remote: { tab: "mark", fam: "all", title: "Удалённая ПНР" },
      site: { tab: "mark", fam: "site", title: "ПНР по месту" },
      climate: { tab: "cards", filter: "Климат", title: "Климат" },
      scenes: { tab: "cards", title: "Сценарии" },
      history: { tab: "poured", pane: "hist", title: "История" },
      board: { tab: "poured", pane: "send", title: "На контроллере" },
    };
    let siteBeaconOn = false;
    let siteLoadsKey = "";
    let siteLoads = [];
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
    function channelLiveSig(rows, deviceTopicKey) {
      const s = (rows || []).find((r) => r && r.deviceTopicKey === deviceTopicKey);
      if (!s) return "";
      return (s.channels || [])
        .map((c) => String(c.controlId) + "=" + String(c.lastValue))
        .join("|");
    }
    function stopLiveWatch() {
      if (listenTimer) clearInterval(listenTimer);
      listenTimer = 0;
      listenUntil = 0;
    }
    /** Пока открыт модуль — чаще читаем зеркало MQTT (мгновенно, без scanMs 8с). */
    function startLiveWatch(ms) {
      listenUntil = Date.now() + (ms || 120000);
      if (listenTimer) clearInterval(listenTimer);
      let lastSig = channelLiveSig(lastShelvesRows, openMod);
      let inFlight = false;
      const tick = () => {
        if (!openMod || Date.now() > listenUntil) {
          stopLiveWatch();
          renderMark();
          return;
        }
        if (inFlight) return;
        inFlight = true;
        fetch("/runtime/mqtt-scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ instant: true, deviceTopicKey: openMod }),
        })
          .then((r) => r.json())
          .then((j) => {
            if (!j || !j.ok || !Array.isArray(j.shelves) || !j.shelves.length) return;
            const prev = lastShelvesRows || [];
            const byKey = new Map(j.shelves.map((s) => [s.deviceTopicKey, s]));
            lastShelvesRows = prev.map((s) => {
              const n = byKey.get(s.deviceTopicKey);
              if (!n) return s;
              const vals = new Map(
                (n.channels || []).map((c) => [c.controlId, c.lastValue]),
              );
              return {
                ...s,
                channels: (s.channels || []).map((c) =>
                  vals.has(c.controlId)
                    ? { ...c, lastValue: vals.get(c.controlId) }
                    : c,
                ),
              };
            });
            for (const n of j.shelves) {
              if (n?.deviceTopicKey === openMod && !prev.some((s) => s.deviceTopicKey === n.deviceTopicKey)) {
                lastShelvesRows.push(n);
              }
            }
            const nextSig = channelLiveSig(lastShelvesRows, openMod);
            if (nextSig !== lastSig) {
              lastSig = nextSig;
              renderMark();
            }
          })
          .catch(() => {})
          .finally(() => {
            inFlight = false;
          });
      };
      tick();
      listenTimer = setInterval(tick, 350);
    }
    function startInputListen(ms) {
      startLiveWatch(ms || 14000);
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
      return (s.channels || []).filter((ch) =>
        !isDriveClose(ch.controlId) && !/(?:Single|Short|Long|Shortlong|Double) Press Counter$/i.test(String(ch.controlId || "")),
      );
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
      if (mirror.connected) return "Щит ещё просыпается";
      return "Щит молчит";
    }
    function cloudRu(state) {
      const s = String(state || "");
      if (/^(restored|online|enrolled_awaiting_heartbeat)$/.test(s)) return "Облако на связи";
      if (s === "enrolling") return "Облако: подключаюсь";
      if (!s || s === "starting") return "Облако: ещё нет";
      return "Облако: нет связи";
    }
    function humanPourError(raw) {
      const s = String(raw || "").trim();
      if (!s) return "Не записалось";
      if (/AUTH:|invalid or missing bearer/i.test(s)) return "Щит не пустил запись. Обновите страницу и повторите.";
      if (/Failed to fetch|NetworkError|ECONNREFUSED|fetch failed/i.test(s)) return "Нет связи со щитом.";
      if (/need_trigger/i.test(s)) return "Нужна кнопка.";
      if (/need_target|need_load/i.test(s)) return "Нужен свет.";
      if (/disk_mismatch/i.test(s)) return "Запись не совпала. Повторите.";
      if (/engine_syntax|engine_not_active|not_restarted|wb.?rules|restart|pending_restart/i.test(s)) {
        return "Запись легла, щит её ещё не включил.";
      }
      if (/marking_unreadable/i.test(s)) return "Имена не читаются. Они на месте, на экране их нет.";
      if (/solution_ids_over_cap/i.test(s)) return "Слишком много сцен за один раз.";
      if (/output_schedule/i.test(s)) return "Расписание и постоянный свет спорят на одной линии.";
      if (/output_busy/i.test(s)) return "Две сцены держат одну линию.";
      if (/body_too_large|bad_json/i.test(s)) return "Запись не разобрана. Щит не трогал.";
      if (/EACCES|EROFS|EPERM|permission denied/i.test(s)) return "Щит не дал записать.";
      if (/debounce|boot grace|self.update/i.test(s)) return "Щит ещё просыпается. Подождите минуту.";
      if (/tip|cloud pull|GitHub/i.test(s)) return "Щит не скачал обновление. Проверьте интернет.";
      if (s.length > 140 || /mqtt|wb-|token|errno/i.test(s)) return "Не записалось. Повторите.";
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
      if (/mcm|gpio|mdi|mwac|wd14|mio/i.test(k)) return "buttons";
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
      if (tab === "light" || tab === "buttons" || tab === "relays" || tab === "all" || tab === "keys" || tab === "lines" || tab === "pair") {
        markPath = "modules";
        modFamily = tab === "buttons"
          ? "buttons"
          : tab === "relays"
            ? "relays"
            : tab === "all"
              ? "all"
              : tab === "keys"
                ? "keys"
                : tab === "lines"
                  ? "lines"
                  : tab === "pair"
                    ? "pair"
                    : "light";
        return "mark";
      }
      return tab;
    }
    function setTab(tab, keepMod) {
      tab = normalizeTab(tab);
      if (!/^(intro|mark|cards|poured)$/.test(tab)) return;
      if (tab !== "mark") {
        stopKeyScan();
        stopLineBeacon();
        stopPairListen();
        siteBeaconOn = false;
      }
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
      document.querySelectorAll(".tab[data-nav]").forEach((btn) => {
        btn.setAttribute("aria-selected", btn.dataset.nav === activeNav ? "true" : "false");
      });
      document.querySelectorAll(".panel").forEach((p) => {
        p.hidden = p.dataset.tab !== tab;
      });
      const ritual = $("ritual");
      const busLine = $("bus");
      const pageTitle = $("pageTitle");
      const kicker = document.querySelector(".kicker");
      if (pageTitle) {
        const named = NAV[activeNav];
        pageTitle.textContent = named ? named.title : "Туториал";
      }
      if (kicker) kicker.hidden = tab !== "intro";
      if (busLine) busLine.hidden = tab === "intro" || tab === "poured";
      if (ritual) {
        ritual.hidden = activeNav !== "site";
        ritual.textContent = activeNav === "site" ? "При сканировании следуйте подсказкам." : "";
      }
      if (tab === "mark") renderMark();
      if (tab === "cards") {
        paintCardsRoomBanner();
        renderDeskSolutions();
        renderVitrine();
      }
      if (tab === "poured") {
        renderPoured();
        loadPreview();
        // Тихая диагностика при входе на «Залить» — без блокировки UI.
        void runDeskHealthQuiet();
      }
      const hash = activeNav || tab;
      if (location.hash.replace("#", "") !== hash) history.replaceState(null, "", "#" + hash);
    }
    function openNav(id) {
      if (id === "keys" || id === "light" || id === "lines") id = "site";
      const spec = NAV[id] || NAV.guide;
      activeNav = NAV[id] ? id : "guide";
      if (spec.fam) {
        modFamily = spec.fam;
        openMod = "";
        markPath = "modules";
        if (spec.fam !== "site") {
          stopKeyScan();
          siteBeaconOn = false;
          stopLineBeacon();
        }
      }
      if (spec.filter) cardFilter = spec.filter;
      if (id === "scenes" && cardFilter === "Климат") cardFilter = "Свет";
      if (spec.pane) pouredPane = spec.pane;
      const famBar = $("modFamily");
      const modSearch = $("modSearch");
      if (modSearch) modSearch.hidden = activeNav !== "remote";
      if (famBar) {
        const remote = activeNav === "remote";
        famBar.hidden = !remote;
        famBar.querySelectorAll("[data-fam]").forEach((btn) => {
          const id = btn.dataset.fam;
          btn.hidden = remote && (id === "keys" || id === "lines" || id === "pair");
        });
      }
      setTab(spec.tab, true);
      const cardBar = $("cardFilters");
      if (cardBar) cardBar.hidden = activeNav === "climate";
      const tree = document.querySelector(".rail-tree");
      if (tree && (activeNav === "history" || activeNav === "board")) tree.dataset.open = "1";
      if (spec.fam === "site" || spec.fam === "remote") {
        Promise.all([loadKeyPlan(), loadLinePlan(), loadSolutions()]).then(() => renderMark());
      }
      if (id === "remote" && deskNavLive) {
        const scanBtn = $("scan");
        if (!scanBtn || !scanBtn.disabled) void scanNow();
      }
    }
    function previewStatusRu(s) {
      if (s === "blocked") return "без имени";
      if (s === "name") return "имя";
      if (s === "new_name") return "новое имя";
      if (s === "card") return "сценарий";
      if (s === "no_card") return "без сценария";
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
      if (!base || !/модул/.test(base)) return;
      bus.replaceChildren(base);
      if (!lastGapCount) return;
      const go = document.createElement("button");
      go.type = "button";
      go.className = "gapjump";
      go.textContent = lastGapCount + " без сценария";
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
      return isNewItem(item) ? "" : "на щите";
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
      back.setAttribute("aria-label", "К записи");
      back.innerHTML = "<svg viewBox='0 0 24 24'><path d='M15 18l-6-6 6-6'/></svg><span>К записи</span>";
      back.addEventListener("click", () => {
        pouredPane = "send";
        openPourMod = "";
        renderReady();
      });
      back.hidden = true;
      box.appendChild(back);
      if (!lastReleases.length) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = "Пока пусто. Запись появится после «Записать на щит».";
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
        ttl.textContent = relWhen(rel.savedAt) || "Запись";
        ttl.title = String(rel.revisionId || "");
        const hint = document.createElement("span");
        hint.className = "hint";
        hint.textContent = releaseWhatRu(rel);
        left.append(ttl, hint);
        const st = document.createElement("span");
        st.className = "st" + (rel.current ? " ok" : "");
        st.textContent = rel.current ? "эта" : "";
        if (!st.textContent) st.hidden = true;
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
            ? "Возвращаю…"
            : "Вернуть дом к этой записи.";
          go.addEventListener("click", () => {
            if (rollingBack) return;
            const label = short || rel.revisionId || "эту заливку";
            if (!window.confirm("Вернуть дом к этой записи? То, что на щите сейчас, сменится.")) {
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
                  head.textContent = "Вернули как было";
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
      cat.hidden = true;
      top.append(ico, cat);
      const vt = document.createElement("span");
      vt.className = "vt";
      const rooms = [...new Set(chunk.map((i) => i.room).filter(Boolean))];
      const names = chunk.map((i) => i.title).filter(Boolean);
      vt.textContent = rooms.length ? rooms.join(" · ") : (names[0] || "Свет");
      vt.title = sku || key;
      const vs = document.createElement("span");
      vs.className = "vs";
      vs.textContent = names.slice(0, 4).join(" · ");
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
      open.hidden = true;
      const badge = document.createElement("span");
      badge.className = "mod-badge" + (lit ? " lit" : "");
      badge.textContent = lit ? ("горит " + lit) : "";
      if (!badge.textContent) badge.hidden = true;
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
      if (String(openPourMod || "").startsWith("room:")) {
        const room = openPourMod.slice(5);
        const chunk = loads.filter((i) => (i.room || "Без имени") === room);
        box.className = "";
        const back = document.createElement("button");
        back.type = "button";
        back.className = "back ghost-back";
        back.innerHTML = "<svg viewBox='0 0 24 24'><path d='M15 18l-6-6 6-6'/></svg><span>Назад</span>";
        back.addEventListener("click", closePourMod);
        const h = document.createElement("h2");
        h.className = "vt";
        h.textContent = room;
        const ul = document.createElement("ul");
        ul.className = "channels";
        chunk.slice().sort(byContact).forEach((i) => ul.appendChild(readyCard(i, "")));
        box.append(back, h, ul);
        return;
      }
      if (openPourMod) {
        const chunk = loads.filter((i) => i.deviceTopicKey === openPourMod);
        const shelf = lastShelvesRows.find((s) => s.deviceTopicKey === openPourMod);
        const sku = (chunk[0] && chunk[0].sku) || (shelf && shelf.label) || openPourMod;
        box.className = "modopen";
        const back = document.createElement("button");
        back.type = "button";
        back.className = "back ghost-back";
        back.innerHTML = "<svg viewBox='0 0 24 24'><path d='M15 18l-6-6 6-6'/></svg><span>Назад</span>";
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
        cat.textContent = chunk.length + (chunk.length === 1 ? " линия" : " линии");
        top.append(ico, cat);
        const vt = document.createElement("span");
        vt.className = "vt";
        vt.textContent = sku;
        const vs = document.createElement("span");
        vs.className = "vs";
        vs.textContent = "На щит · кнопка «Записать на щит»";
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
        occ.hidden = true;
        const bus = document.createElement("span");
        bus.className = "mod-pill" + (lit ? " lit" : " on");
        bus.textContent = lit ? ("горит " + lit) : "";
        if (!bus.textContent) bus.hidden = true;
        pills.append(occ, bus);
        head.append(top, vt, vs, bars, pills);
        const tip = document.createElement("p");
        tip.className = "meta";
        const blocked = chunk.filter((i) => i.status === "blocked").length;
        tip.textContent = blocked
          ? (blocked + " без имени. Назовите в «Комнаты».")
          : "";
        const ul = document.createElement("ul");
        ul.className = "channels drill-list";
        chunk.slice().sort(byContact).forEach((i) => ul.appendChild(readyCard(i, i.room)));
        box.append(back, head, tip, ul);
        return;
      }
      box.className = "vitrine";
      loads.slice().sort(byContact).forEach((item) => box.appendChild(pourLineTile(item)));
      if (scenes.length) {
        const note = document.createElement("p");
        note.className = "meta";
        note.textContent = "Сцены запишутся вместе с именами.";
        box.appendChild(note);
      }
    }
    function pourLineTile(item) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "vcard on";
      const lit = channelIsOn(pourLiveCh(item.deviceTopicKey, item.controlId));
      if (lit) btn.classList.add("amber", "lit");
      const vt = document.createElement("span");
      vt.className = "vt";
      vt.textContent = item.title || item.room || "Линия";
      const vs = document.createElement("span");
      vs.className = "vs";
      vs.textContent = item.sub || item.room || "";
      btn.append(vt, vs);
      btn.addEventListener("click", () => {
        openPourMod = "room:" + (item.room || "Без имени");
        openContact = "";
        openSceneId = "";
        renderReady();
      });
      return btn;
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
          bits.push("на щите " + prettyContactName(item.pouredName));
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
          : (item.pouredName ? "Вернуть имя со щита" : "Убрать имя");
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
      const tabs = [
        { id: "send", ru: "Сейчас" },
        { id: "hist", ru: "Раньше" },
      ];
      if (!tabs.some((t) => t.id === pouredPane) && pouredPane !== "rules" && pouredPane !== "file" && pouredPane !== "ha") pouredPane = "send";
      bar.className = "footlink";
      bar.hidden = pouredOpen();
      bar.replaceChildren();
        const b = document.createElement("button");
        b.type = "button";
      b.className = "textlink";
      if (pouredPane === "hist" || pouredPane === "file" || pouredPane === "ha") {
        b.textContent = "К записи";
        b.addEventListener("click", () => {
          pouredPane = "send";
          openPourMod = "";
          renderReady();
        });
      } else {
        b.textContent = "Раньше";
        b.addEventListener("click", () => {
          openSceneId = "";
          openContact = "";
          openPourMod = "";
          pouredPane = "hist";
          renderReady();
        });
      }
        bar.appendChild(b);
      const fileBtn = document.createElement("button");
      fileBtn.type = "button";
      fileBtn.className = "textlink" + (pouredPane === "file" ? " on" : "");
      fileBtn.textContent = "rules.js";
      fileBtn.addEventListener("click", () => {
        openSceneId = "";
        openContact = "";
        openPourMod = "";
        pouredPane = "file";
        renderReady();
        void loadRulesFile();
      });
      bar.appendChild(fileBtn);
      const haBtn = document.createElement("button");
      haBtn.type = "button";
      haBtn.className = "textlink" + (pouredPane === "ha" ? " on" : "");
      haBtn.textContent = "Home Assistant";
      haBtn.addEventListener("click", () => {
        openSceneId = "";
        openContact = "";
        openPourMod = "";
        pouredPane = "ha";
        renderReady();
        void loadHaLights();
      });
      bar.appendChild(haBtn);
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
      const canWrite = canPourNamesDesk || canPourRulesDesk;
      if (sum) {
        if (show && pouredPane === "send") {
          sum.hidden = false;
          sum.hidden = !canWrite && !sendN;
          sum.textContent = !canWrite && !sendN
            ? ""
            : (sendN ? ("Ещё не на щите: " + sendN + ".") : "Можно записать.");
        } else if (show && pouredPane === "hist") {
          sum.hidden = false;
          sum.textContent = "Прошлые записи. Текущая не сотрётся из списка.";
        } else {
          sum.hidden = true;
          sum.textContent = "";
        }
      }
      if (hint) {
        hint.hidden = true;
        hint.textContent = "";
      }
      const allBtn = $("pourAll");
      const namesBtn = $("pourNames");
      const rulesBtn = $("pourRules");
      const repairBtn = $("pour");
      if (allBtn) {
        allBtn.hidden = pouredPane === "hist";
        allBtn.disabled = !canWrite;
        allBtn.textContent = "Записать на щит";
        allBtn.title = canWrite ? "Имена и сценарии одним разом" : "На щите уже то же, что на столе";
      }
      if (namesBtn) {
        namesBtn.hidden = true;
        namesBtn.textContent = "Залить имена";
      }
      if (rulesBtn) {
        rulesBtn.hidden = true;
        rulesBtn.textContent = "Залить сценарии";
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
        empty.textContent = "Сначала назовите линию в «Комнатах».";
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
              : bad.error === "output_taken" ? "Этот выход уже держит такая же карточка"
              : bad.error === "output_busy" ? "Этот выход уже держит постоянное правило"
              : bad.error === "output_schedule" ? "На этом выходе расписание спорит с постоянным правилом"
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
              headEl.textContent = "На столе. Когда закончите обход — «На щит».";
            }
            loadPreview();
            paintPourButtons();
            renderReady();
          });
        }).catch(() => { err.textContent = "Нет связи со щитом"; });
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
      const backRu = "Назад";
      back.setAttribute("aria-label", backRu);
      back.innerHTML = "<svg viewBox='0 0 24 24'><path d='M15 18l-6-6 6-6'/></svg><span></span>";
      back.querySelector("span").textContent = backRu;
      back.addEventListener("click", closeContact);
      const s = lastShelvesRows.find((r) => r.deviceTopicKey === key);
      const ch = s && (s.channels || []).find((c) => c.controlId === cid);
      if (!s || !ch) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = "Этой кнопки сейчас нет.";
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
      if (pouredPane === "file") {
        openPourMod = "";
        box.className = "";
        const pre = document.createElement("pre");
        pre.className = "rules-file";
        pre.textContent = String(rulesFileText || "").trim()
          ? rulesFileText
          : "На щите ещё нет rules.js.";
        box.appendChild(pre);
        const head = $("previewHead");
        if (head) {
          head.hidden = true;
          head.textContent = "";
        }
        return;
      }
      if (pouredPane === "ha") {
        openPourMod = "";
        paintHaPane(box);
        return;
      }
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
          h.textContent = "Ещё не записано";
          ul.appendChild(h);
        }
        neu.slice().sort(byContact).forEach((i) => ul.appendChild(readyCard(i, i.room)));
        if (ul.childNodes.length) box.appendChild(ul);
      }
      if (!items.length) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = pouredPane === "send" ? "" : "Сценариев на щите пока нет.";
        if (!empty.textContent) empty.hidden = true;
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
          // Счётчики — только для скана, в типовые не тащим.
          if (/(?:Single|Short|Long|Shortlong|Double) Press Counter$/i.test(String(ch.controlId || ""))) return;
          if (!isDeskInput(ch.controlId, s.deviceTopicKey)
            && !/геркон|движен|reed|motion|pir|co2|влажн|темпер/i.test(String(ch.name || ""))) {
            return;
          }
          const name = String(ch.name || "").trim();
          const row = {
            deviceTopicKey: s.deviceTopicKey,
            controlId: ch.controlId,
            label: name ? prettyContactName(name) : (s.label || "вход") + " · " + ch.controlId,
            named: Boolean(name),
          };
          if (name) named.push(row);
          else rest.push(row);
        });
      });
      return preferRoomRows(named.concat(rest));
    }
    function fillSelect(sel, rows, placeholder) {
      sel.replaceChildren();
      const list = rows || [];
      const z = document.createElement("option");
      z.value = "";
      z.textContent = list.length
        ? (placeholder || "Выбрать")
        : "Нет подходящих имён — разметьте в «Разметить»";
      sel.appendChild(z);
      list.forEach((r) => {
        const o = document.createElement("option");
        o.value = contactKey(r.deviceTopicKey, r.controlId);
        o.textContent = r.label;
        sel.appendChild(o);
      });
      if (!list.length) sel.disabled = true;
      else sel.disabled = false;
    }
    function parseBindValue(v) {
      const i = String(v).indexOf("::");
      if (i < 0) return null;
      return { deviceTopicKey: v.slice(0, i), controlId: v.slice(i + 2) };
    }
    /**
     * Dropdown + chips: поиск, «вся комната», поштучно; для сцен — % / Вкл·Выкл на теге.
     * Без галки в списке = не в сцене (ignore).
     */
    function makeTagPicker(opts) {
      let rows = Array.isArray(opts.rows) ? opts.rows : [];
      const multi = opts.multi !== false;
      const withLevel = Boolean(opts.withLevel);
      const defLevel = Number.isFinite(Number(opts.defLevel)) ? Number(opts.defLevel) : 100;
      const placeholder = opts.placeholder || "Выберите…";
      const emptyText = opts.emptyText || "Нет подходящих имён — разметьте в «Разметить».";
      const onChange = typeof opts.onChange === "function" ? opts.onChange : () => {};
      const byKey = new Map();
      function indexRows() {
        byKey.clear();
        rows.forEach((r) => byKey.set(contactKey(r.deviceTopicKey, r.controlId), r));
      }
      indexRows();
      /** @type {Map<string, number>} */
      const selected = new Map();
      (opts.draftKeys || []).forEach((k) => {
        if (!byKey.has(k)) return;
        const lv = opts.draftLevels && opts.draftLevels[k];
        selected.set(k, Number.isFinite(Number(lv)) ? Number(lv) : defLevel);
      });

      const root = document.createElement("div");
      root.className = "tag-pick" + (withLevel ? " tag-pick-lvl" : "");
      const field = document.createElement("div");
      field.className = "tag-field";
      const chips = document.createElement("div");
      chips.className = "tag-chips";
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "tag-add";
      addBtn.textContent = placeholder;
      addBtn.disabled = !rows.length;
      field.append(chips, addBtn);
      if (!rows.length) {
        field.classList.add("is-empty");
        addBtn.hidden = true;
        const emptyMsg = document.createElement("span");
        emptyMsg.className = "tag-empty-msg";
        emptyMsg.textContent = emptyText;
        field.appendChild(emptyMsg);
      }
      const panel = document.createElement("div");
      panel.className = "tag-dd";
      panel.hidden = true;
      const search = document.createElement("input");
      search.type = "search";
      search.className = "tag-search";
      search.placeholder = opts.searchPlaceholder || "Поиск: кух, бра, канал…";
      search.autocomplete = "off";
      const list = document.createElement("div");
      list.className = "tag-dd-list";
      panel.append(search, list);
      root.append(field, panel);

      function roomOf(r) {
        if (r && r.room) return r.room;
        return nameRoom(r && r.label) || "Общие (без комнаты в имени)";
      }
      function shortLabel(r) {
        const room = roomOf(r);
        const raw = String(r.label || "").trim();
        if (room && raw.indexOf(room) === 0) {
          const rest = raw.slice(room.length).replace(/^[\s·\-–—:]+/, "").trim();
          if (rest) return rest;
        }
        return raw || r.controlId || "линия";
      }
      function keysInRoom(room) {
        return rows.filter((r) => roomOf(r) === room).map((r) => contactKey(r.deviceTopicKey, r.controlId));
      }
      function collect() {
        return [...selected.keys()].map((k) => {
          const base = parseBindValue(k);
          if (!base) return null;
          if (!withLevel) return base;
          const n = Number(selected.get(k));
          return { ...base, level: Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : defLevel };
        }).filter(Boolean);
      }
      function paintChips() {
        chips.replaceChildren();
        if (!rows.length) return;
        if (!selected.size) {
          addBtn.hidden = false;
          addBtn.textContent = placeholder;
          return;
        }
        addBtn.hidden = false;
        addBtn.textContent = multi ? "+ ещё" : "сменить";
        const rooms = groupLoadsByRoom(rows);
        const painted = new Set();
        rooms.forEach(([room, roomRows]) => {
          const keys = roomRows.map((r) => contactKey(r.deviceTopicKey, r.controlId));
          const selKeys = keys.filter((k) => selected.has(k));
          if (!selKeys.length) return;
          const allRoom = multi && keys.length > 1 && selKeys.length === keys.length;
          if (allRoom) {
            selKeys.forEach((k) => painted.add(k));
            const chip = document.createElement("div");
            chip.className = "tag-chip";
            const lab = document.createElement("span");
            lab.className = "tag-chip-lab";
            lab.textContent = room + " (вся)";
            chip.appendChild(lab);
            if (withLevel) {
              const lvl = makeLevelCtrl(selKeys[0], () => {
                const v = Number(selected.get(selKeys[0]));
                selKeys.forEach((k) => selected.set(k, v));
                onChange();
              });
              chip.appendChild(lvl);
            }
            const x = document.createElement("button");
            x.type = "button";
            x.className = "tag-x";
            x.setAttribute("aria-label", "Убрать " + room);
            x.textContent = "×";
            x.addEventListener("click", (e) => {
              e.stopPropagation();
              selKeys.forEach((k) => selected.delete(k));
              paintChips();
              if (!panel.hidden) paintList();
              onChange();
            });
            chip.appendChild(x);
            chips.appendChild(chip);
            return;
          }
          selKeys.forEach((k) => {
            if (painted.has(k)) return;
            painted.add(k);
            const r = byKey.get(k);
            const chip = document.createElement("div");
            chip.className = "tag-chip";
            const lab = document.createElement("span");
            lab.className = "tag-chip-lab";
            lab.textContent = room + " · " + shortLabel(r);
            chip.appendChild(lab);
            if (withLevel) chip.appendChild(makeLevelCtrl(k, onChange));
            const x = document.createElement("button");
            x.type = "button";
            x.className = "tag-x";
            x.setAttribute("aria-label", "Убрать");
            x.textContent = "×";
            x.addEventListener("click", (e) => {
              e.stopPropagation();
              selected.delete(k);
              paintChips();
              if (!panel.hidden) paintList();
              onChange();
            });
            chip.appendChild(x);
            chips.appendChild(chip);
          });
        });
      }
      function makeLevelCtrl(key, after) {
        const r = byKey.get(key);
        const dim = r && isLikelyDimmerLoad(r);
        let ctrl;
        if (dim) {
          ctrl = document.createElement("input");
          ctrl.type = "number";
          ctrl.className = "tag-lvl";
          ctrl.min = "0";
          ctrl.max = "100";
          ctrl.step = "1";
          ctrl.value = String(selected.get(key) ?? defLevel);
          ctrl.title = "% · 0 = гасить";
          ctrl.addEventListener("click", (e) => e.stopPropagation());
          ctrl.addEventListener("change", () => {
            const n = Number(ctrl.value);
            selected.set(key, Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : defLevel);
            after();
          });
        } else {
          ctrl = document.createElement("select");
          ctrl.className = "tag-lvl tag-lvl-sw";
          [["0", "Выкл"], ["100", "Вкл"]].forEach(([v, t]) => {
            const o = document.createElement("option");
            o.value = v;
            o.textContent = t;
            ctrl.appendChild(o);
          });
          ctrl.value = (selected.get(key) ?? defLevel) >= 50 ? "100" : "0";
          ctrl.addEventListener("click", (e) => e.stopPropagation());
          ctrl.addEventListener("change", () => {
            selected.set(key, Number(ctrl.value) || 0);
            after();
          });
        }
        return ctrl;
      }
      function paintList() {
        list.replaceChildren();
        if (!rows.length) {
          const empty = document.createElement("p");
          empty.className = "meta orphan";
          empty.textContent = emptyText;
          list.appendChild(empty);
          return;
        }
        const q = String(search.value || "").trim().toLowerCase();
        const match = (r) => !q || String(r.label || "").toLowerCase().includes(q)
          || String(r.controlId || "").toLowerCase().includes(q)
          || String(r.deviceTopicKey || "").toLowerCase().includes(q);
        if (multi && rows.length && rows.length <= 48) {
          const allBtn = document.createElement("button");
          allBtn.type = "button";
          allBtn.className = "tag-dd-row tag-dd-all";
          const allOn = rows.length && rows.every((r) => selected.has(contactKey(r.deviceTopicKey, r.controlId)));
          allBtn.textContent = allOn ? "✓ Снять всё" : "Выбрать всё";
          allBtn.addEventListener("click", () => {
            if (allOn) selected.clear();
            else rows.forEach((r) => {
              const k = contactKey(r.deviceTopicKey, r.controlId);
              if (!selected.has(k)) selected.set(k, defLevel);
            });
            paintChips();
            paintList();
            onChange();
          });
          list.appendChild(allBtn);
        }
        groupLoadsByRoom(rows).forEach(([room, roomRows]) => {
          const visible = roomRows.filter(match);
          if (!visible.length) return;
          const keys = keysInRoom(room);
          const roomWrap = document.createElement("div");
          roomWrap.className = "tag-dd-room";
          if (multi && keys.length > 1) {
            const roomBtn = document.createElement("button");
            roomBtn.type = "button";
            roomBtn.className = "tag-dd-row tag-dd-roomh";
            const on = keys.every((k) => selected.has(k));
            roomBtn.textContent = (on ? "✓ " : "") + "Вся · " + room + " · " + keys.length;
            roomBtn.addEventListener("click", () => {
              if (on) keys.forEach((k) => selected.delete(k));
              else keys.forEach((k) => { if (!selected.has(k)) selected.set(k, defLevel); });
              paintChips();
              paintList();
              onChange();
            });
            roomWrap.appendChild(roomBtn);
          } else {
            const h = document.createElement("div");
            h.className = "tag-dd-roomh mute";
            h.textContent = room;
            roomWrap.appendChild(h);
          }
          visible.forEach((r) => {
            const k = contactKey(r.deviceTopicKey, r.controlId);
            const rowBtn = document.createElement("button");
            rowBtn.type = "button";
            rowBtn.className = "tag-dd-row" + (selected.has(k) ? " on" : "");
            rowBtn.textContent = (selected.has(k) ? "✓ " : "") + shortLabel(r);
            rowBtn.addEventListener("click", () => {
              if (!multi) {
                selected.clear();
                selected.set(k, defLevel);
                closePanel();
              } else if (selected.has(k)) selected.delete(k);
              else selected.set(k, defLevel);
              paintChips();
              paintList();
              onChange();
            });
            roomWrap.appendChild(rowBtn);
          });
          list.appendChild(roomWrap);
        });
        if (!list.children.length) {
          const empty = document.createElement("p");
          empty.className = "meta";
          empty.textContent = "Ничего не найдено";
          list.appendChild(empty);
        }
      }
      function openPanel() {
        if (!rows.length) return;
        panel.hidden = false;
        root.classList.add("open");
        paintList();
        search.focus();
      }
      function closePanel() {
        panel.hidden = true;
        root.classList.remove("open");
        search.value = "";
      }
      function setRows(next, hint, empty) {
        rows = Array.isArray(next) ? next : [];
        indexRows();
        for (const key of [...selected.keys()]) {
          if (!byKey.has(key)) selected.delete(key);
        }
        addBtn.disabled = !rows.length;
        let emptyMsg = field.querySelector(".tag-empty-msg");
        if (!rows.length) {
          field.classList.add("is-empty");
          addBtn.hidden = true;
          if (!emptyMsg) {
            emptyMsg = document.createElement("span");
            emptyMsg.className = "tag-empty-msg";
            field.appendChild(emptyMsg);
          }
          emptyMsg.textContent = empty || emptyText;
        } else {
          field.classList.remove("is-empty");
          if (emptyMsg) emptyMsg.remove();
          addBtn.hidden = false;
        }
        if (hint) search.placeholder = hint;
        paintChips();
        if (!panel.hidden) paintList();
      }
      addBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (panel.hidden) openPanel();
        else closePanel();
      });
      field.addEventListener("click", (e) => {
        if (e.target === addBtn || e.target.closest(".tag-chip")) return;
        if (panel.hidden) openPanel();
      });
      search.addEventListener("input", paintList);
      search.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closePanel();
      });
      const onDoc = (e) => {
        if (!root.contains(e.target)) closePanel();
      };
      document.addEventListener("click", onDoc);
      root._tagPickDispose = () => document.removeEventListener("click", onDoc);
      paintChips();
      return {
        node: root,
        collect,
        setRows,
        isEmpty: () => selected.size === 0,
        dispose: () => {
          if (root._tagPickDispose) root._tagPickDispose();
        },
      };
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
        const onDisk = (pouredRules || []).some((r) => String(r.id || "").indexOf("desk_sol_" + sol.id) === 0);
        const pourOne = document.createElement("button");
        pourOne.type = "button";
        pourOne.className = "ghost";
        pourOne.textContent = onDisk ? "Обновить" : "Долить";
        pourOne.addEventListener("click", () => runDeskPour("rules", pourOne, [sol.id]));
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
        li.appendChild(pourOne);
        li.appendChild(del);
        ul.appendChild(li);
      });
      $("n-cards").textContent = deskSolutions.length || "";
    }
    function stampDiskScenes() {
      const n = (pouredRules || []).filter((r) => r.kind === "user").length;
      $("diskScenes").textContent = n
        ? (n === 1 ? "Один сценарий уже на щите." : (n + " сценария уже на щите."))
        : "";
    }
    let cardSheetDispose = null;
    function closeCardSheet() {
      if (typeof cardSheetDispose === "function") {
        try { cardSheetDispose(); } catch (_e) {}
        cardSheetDispose = null;
      }
      $("cardSheet").hidden = true;
      $("cardMask").hidden = true;
    }
    function sheetNeedSensor(card) {
      return /humidity|co2|temp|thermostat|warm_floor|weather|vent_|ac_|humidifier|motion|reed|night_path|stair_light|leak|двер|движен|протеч|окн/i
        .test(card.id + " " + card.title);
    }
    function sheetIsMotion(card) {
      return /light_motion|light_night_path|stair_light_motion/.test(card.id);
    }
    function sheetIsReed(card) {
      return card.id === "light_reed_on" || card.id === "ac_window_off";
    }
    function sheetTrigLab(card) {
      if (card.id === "vent_humidity_motion") return "Влажность";
      if (card.id === "vent_vav_zone" || card.id === "vent_co2" || card.id === "vent_diy_vav") return "CO₂";
      if (sheetIsReed(card)) return "Дверь / геркон";
      if (sheetIsMotion(card)) return "Датчик движения";
      return sheetNeedSensor(card) ? "Датчик" : "Кнопка";
    }
    function sheetAuxLab(card) {
      return card.auxLabel || "Доп. датчик";
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
      if (card.id === "vent_vav_zone") return "Заслонка 0–10 В";
      if (card.id === "vent_vav_fan") return "Вентилятор / AO";
      if (/gate_button/.test(card.id)) return "Ворота / привод";
      if (card.cat === "Общее") return card.multi ? "Нагрузки" : "Нагрузка";
      return card.multi ? "Свет / линии" : "Свет";
    }
    /** Винительный для «Выберите …» */
    function sheetPickAccusative(lab) {
      const s = String(lab || "").trim().toLowerCase();
      if (s === "кнопка") return "кнопку";
      if (s === "сирена") return "сирену";
      if (s === "розетка") return "розетку";
      if (s === "штора") return "штору";
      if (s === "нагрузка") return "нагрузку";
      if (s === "заслонка 0–10 в") return "заслонку 0–10 В";
      return s;
    }
    function sheetPickPlaceholder(lab) {
      return "Выберите " + sheetPickAccusative(lab) + "…";
    }
    /** onlyHits: если есть подходящие — не подмешивать чужие линии (свет в шторах и т.п.). */
    function preferRows(rows, hitFn, onlyHits) {
      const hit = rows.filter(hitFn);
      if (!hit.length) return onlyHits ? [] : rows;
      return onlyHits ? hit : hit.concat(rows.filter((r) => !hitFn(r)));
    }
    function isSensorLabel(label) {
      return /датчик|темпер|влажн|co[₂2]|геркон|движен|протеч|двер|окн|pir/i.test(String(label || ""));
    }
    function isCurtainLoad(r) {
      return isDeskDrive(r.controlId) || /штор|роллет|жалюз|тюль|экран|привод/i.test(r.label || "");
    }
    function isLightLoad(r) {
      if (isCurtainLoad(r)) return false;
      if (/вентиля|вытяж|приточ|заслон|насос|клапан|кран|калорифер|кондей|кондиц|тёпл|тепл\s*пол|увлажн|замок|сирен|ворот|калитк/i.test(r.label || "")) {
        return false;
      }
      return /свет|лин|подсвет|спот|бра|люстр|ламп|диод|светов|точеч|подвес|ночник|фриз|фартук|канал/i.test(r.label || "")
        || /^(Channel|CCT|RGB)/i.test(r.controlId || "");
    }
    function loadKindHit(kind, r) {
      const lab = r.label || "";
      if (kind === "light") return isLightLoad(r);
      if (kind === "curtain") return isCurtainLoad(r);
      if (kind === "socket") return /розетк/i.test(lab);
      if (kind === "exhaust") return /вытяж/i.test(lab);
      if (kind === "supply") {
        return /приточ|вытяж|вентил|канальн|клапан.*вент|реле.*вент/i.test(lab)
          && !/заслон|mao|0\s*[-–]?\s*10/i.test(lab + " " + (r.controlId || ""));
      }
      if (kind === "damper") {
        return /заслон|mao|0\s*[-–]?\s*10|аналог/i.test(lab + " " + (r.controlId || ""))
          || /mao/i.test(r.deviceTopicKey || "");
      }
      if (kind === "fan") {
        return /вентилятор|инвертор|приточ.*мотор|скорость|mao|0\s*[-–]?\s*10/i.test(lab + " " + (r.controlId || ""))
          || /mao/i.test(r.deviceTopicKey || "");
      }
      if (kind === "ac") return /кондей|кондиц/i.test(lab);
      if (kind === "floor") return /тёпл|тепл|пол|серво|коллект/i.test(lab);
      if (kind === "heat") return /терм|обогрев|радиат|котёл|котел|тёпл|тепл/i.test(lab);
      if (kind === "humid") return /увлажн/i.test(lab);
      if (kind === "valve") return /кран|клапан|перекрыт/i.test(lab);
      if (kind === "lock") return /замок/i.test(lab);
      if (kind === "siren") return /сирен|тревог/i.test(lab);
      if (kind === "gate") return isDeskDrive(r.controlId) || /ворот|калитк|шлагбаум/i.test(lab);
      if (kind === "climate") return /кондей|вытяж|приточ|вентил|насос|увлажн|калорифер|серво|заслон/i.test(lab);
      return true;
    }
    function triggersForCard(card) {
      const all = namedTriggers().filter((r) => String(r.label || "").trim());
      if (card.id === "vent_vav_zone" || /co2/i.test(card.id)) {
        return preferRows(all, (r) => /co\s*₂|co2|душно|углекисл/i.test(r.label || "") || isSensorLabel(r.label), true);
      }
      if (sheetIsMotion(card)) {
        return preferRows(all, (r) =>
          /движен|motion|pir|присут|occup/i.test(r.label || "")
          || /motion|occup|pir/i.test(r.controlId || ""), true);
      }
      if (sheetIsReed(card)) {
        return preferRows(all, (r) =>
          /двер|геркон|reed|окн/i.test(r.label || "")
          || /reed|contact|input/i.test(r.controlId || ""), true);
      }
      if (!sheetNeedSensor(card)) {
        // После скана клавиш — только подписанные входы; иначе «Выберите кнопку» путает.
        const named = all.filter((r) => r.named);
        return named.length ? named : all;
      }
      return preferRows(all, (r) => isSensorLabel(r.label), true);
    }
    function isLikelyDimmerLoad(r) {
      const blob = [r.deviceTopicKey, r.controlId, r.label].join(" ");
      if (/wb-mr|\/K\d+\b|реле/i.test(blob) && !/wb-led|Channel|CCT|димм/i.test(blob)) return false;
      return /wb-led|Channel|CCT|Brightness|димм|RGB/i.test(blob);
    }
    function loadsForCard(card, room) {
      let all = loadsForRoom(room);
      const kind = card.loadKind || "";
      if (kind) all = preferRows(all, (r) => loadKindHit(kind, r), true);
      else if (card.cat === "Шторы") all = preferRows(all, isCurtainLoad, true);
      else if (card.cat === "Свет" || card.cat === "Сцены") all = preferRows(all, isLightLoad, true);
      else if (card.cat === "Розетки") all = preferRows(all, (r) => /розетк/i.test(r.label || ""), true);
      // Диммирование — только линии с Auto-Change / Channel (не обычные реле).
      if (card.id === "light_dim_hold_mcm") {
        all = preferRows(all, isLikelyDimmerLoad, true);
      }
      return all;
    }
    function groupLoadsByRoom(loads) {
      const map = new Map();
      (loads || []).forEach((r) => {
        const room = (r && r.room) || nameRoom(r.label) || "Общие (без комнаты в имени)";
        if (!map.has(room)) map.set(room, []);
        map.get(room).push(r);
      });
      return [...map.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), "ru", { numeric: true }));
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
      const lead = document.createElement("div");
      lead.className = "sheet-lead";
      const rawBtn = document.createElement("button");
      rawBtn.type = "button";
      rawBtn.className = "raw-toggle";
      rawBtn.textContent = "Без разметки";
      const draftTrigKey = draft && draft.trigger
        ? contactKey(draft.trigger.deviceTopicKey, draft.trigger.controlId)
        : "";
      const draftTargetKeys = (draft && draft.targets || [])
        .map((t) => contactKey(t.deviceTopicKey, t.controlId));
      const namedTrigRows = triggersForCard(card);
      const namedLoadRows = loadsForCard(card, roomFilter);
      const hasKey = (list, key) => list.some((r) => contactKey(r.deviceTopicKey, r.controlId) === key);
      let rawOn = Boolean(
        (draftTrigKey && !hasKey(namedTrigRows, draftTrigKey))
        || draftTargetKeys.some((key) => !hasKey(namedLoadRows, key)),
      );
      // Диммер без имён — сразу сырые каналы WB-LED / DALI / MDM, не пустой «поправьте имена».
      if (card.id === "light_dim_hold_mcm" && !rawOn && !namedLoadRows.length) rawOn = true;
      rawBtn.setAttribute("aria-pressed", rawOn ? "true" : "false");
      const rawHint = "WB-LED №4, K1, Input 7";
      lead.append(p, rawBtn);
      const needTrig = card.needTrig !== false;
      const needAux = card.needAux === true;
      const disposers = [];
      let trigPicker = null;
      let auxPicker = null;
      let tgtPicker = null;
      let trig = null;
      let aux = null;
      const trigLab = document.createElement("span");
      trigLab.className = "fld";
      const bump = () => { err.textContent = ""; refreshSave(); };
      if (needTrig) {
        trigLab.textContent = sheetTrigLab(card);
        const trigs = rawOn ? rawTriggerRows() : namedTrigRows;
        let draftTrigKeys = [];
        if (draft && draft.trigger) {
          draftTrigKeys = [contactKey(draft.trigger.deviceTopicKey, draft.trigger.controlId)];
        } else if (!sheetNeedSensor(card) && trigs.length) {
          // Свежая привязка со скана — сразу подставить.
          const fresh = [...(keyPlan || [])]
            .filter((k) => k.deviceTopicKey && k.controlId)
            .sort((a, b) => String(b.boundAt || "").localeCompare(String(a.boundAt || "")))[0];
          if (fresh) {
            const fk = contactKey(fresh.deviceTopicKey, fresh.controlId);
            if (trigs.some((r) => contactKey(r.deviceTopicKey, r.controlId) === fk)) {
              draftTrigKeys = [fk];
            }
          }
          if (!draftTrigKeys.length && roomFilter) {
            const hit = trigs.find((r) => nameRoom(r.label) === roomFilter && r.named) || trigs.find((r) => r.named);
            if (hit) draftTrigKeys = [contactKey(hit.deviceTopicKey, hit.controlId)];
          }
        } else if (sheetNeedSensor(card) && trigs.length) {
          const preferHum = /humidity|влажн/i.test(card.id + sheetTrigLab(card));
          const sens = trigs.find((r) => preferHum && /влажн|humidity/i.test(r.label || ""))
            || trigs.find((r) => (!roomFilter || nameRoom(r.label) === roomFilter) && isSensorLabel(r.label))
            || trigs.find((r) => isSensorLabel(r.label))
            || (sheetIsMotion(card) && trigs[0])
            || (sheetIsReed(card) && trigs[0]);
          if (sens) draftTrigKeys = [contactKey(sens.deviceTopicKey, sens.controlId)];
        } else if (roomFilter && trigs[0] && nameRoom(trigs[0].label) === roomFilter) {
          draftTrigKeys = [contactKey(trigs[0].deviceTopicKey, trigs[0].controlId)];
        }
        trigPicker = makeTagPicker({
          rows: trigs,
          multi: false,
          placeholder: sheetPickPlaceholder(sheetTrigLab(card)),
          searchPlaceholder: rawOn ? rawHint : "",
          emptyText: "Нет подходящих имён — разметьте в «Разметить».",
          draftKeys: draftTrigKeys,
          onChange: bump,
        });
        disposers.push(trigPicker.dispose);
        trig = trigPicker.node;
      } else if (card.noTrigHint || card.id === "vent_vav_fan") {
        trigLab.textContent = card.noTrigHint || "Зоны VAV";
        const note = document.createElement("p");
        note.className = "meta";
        note.textContent = card.noTrigNote
          || "Датчик не нужен — спрос идёт из зон с той же системой вентиляции.";
        trig = note;
      } else {
        trigLab.textContent = "Расписание";
        const note = document.createElement("p");
        note.className = "meta";
        note.textContent = "Срабатывает по часам щита. Выберите "
          + sheetTgtLab(card).toLowerCase()
          + " и время ниже.";
        trig = note;
      }
      let auxNamed = [];
      const auxLab = document.createElement("span");
      auxLab.className = "fld";
      if (needAux) {
        auxLab.textContent = sheetAuxLab(card);
        auxNamed = preferRows(
          namedTriggers().filter((r) => String(r.label || "").trim()),
          (r) => /движен|motion|pir|присут/i.test(r.label || ""),
          true,
        );
        const auxRows = rawOn ? rawTriggerRows() : auxNamed;
        let draftAuxKeys = [];
        if (draft && draft.aux) {
          draftAuxKeys = [contactKey(draft.aux.deviceTopicKey, draft.aux.controlId)];
        } else {
          const hit = auxRows.find((r) => /движен|motion|pir/i.test(r.label || ""));
          if (hit) draftAuxKeys = [contactKey(hit.deviceTopicKey, hit.controlId)];
        }
        auxPicker = makeTagPicker({
          rows: auxRows,
          multi: false,
          placeholder: sheetPickPlaceholder(sheetAuxLab(card)),
          searchPlaceholder: rawOn ? rawHint : "",
          emptyText: "Нет датчиков движения — разметьте в «Разметить».",
          draftKeys: draftAuxKeys,
          onChange: bump,
        });
        disposers.push(auxPicker.dispose);
        aux = auxPicker.node;
      }
      const tgtLab = document.createElement("span");
      tgtLab.className = "fld";
      tgtLab.textContent = sheetTgtLab(card);
      const loads = rawOn ? rawLoadsForCard(card) : namedLoadRows;
      const err = document.createElement("p");
      err.className = "meta orphan";
      const perLoadLevel = Boolean(card.perLoadLevel);
      const levelField = (Array.isArray(card.fields) ? card.fields : []).find((f) => f.key === "level");
      const defLevel = levelField != null && Number.isFinite(Number(levelField.def))
        ? Number(levelField.def)
        : 100;
      const draftKeys = (draft && draft.targets || [])
        .map((t) => contactKey(t.deviceTopicKey, t.controlId));
      const draftLevels = {};
      (draft && draft.targets || []).forEach((t) => {
        const k = contactKey(t.deviceTopicKey, t.controlId);
        if (Number.isFinite(Number(t.level))) draftLevels[k] = Number(t.level);
        else if (draft.params && Number.isFinite(Number(draft.params.level))) draftLevels[k] = Number(draft.params.level);
      });
      tgtPicker = makeTagPicker({
        rows: loads,
        multi: card.multi !== false,
        withLevel: perLoadLevel,
        defLevel,
        placeholder: perLoadLevel
          ? "Комнаты / линии в сцену…"
          : sheetPickPlaceholder(sheetTgtLab(card)),
        searchPlaceholder: rawOn ? rawHint : "",
        emptyText: /leak|valve/.test(card.id + (card.loadKind || ""))
          ? "Нет линий с именем «кран/клапан» — разметьте краны, не свет."
          : (rawOn && card.id === "light_dim_hold_mcm"
            ? "На шине нет каналов WB-LED, DALI или MDM3."
            : "Нет подходящих нагрузок этого типа — поправьте имена в «Разметить»."),
        draftKeys,
        draftLevels,
        onChange: bump,
      });
      disposers.push(tgtPicker.dispose);
      const tgtNode = tgtPicker.node;
      const collectTargets = () => tgtPicker.collect();
      cardSheetDispose = () => disposers.forEach((fn) => { try { fn(); } catch (_e) {} });
      const fields = (Array.isArray(card.fields) ? card.fields : [])
        .filter((f) => !(perLoadLevel && f.key === "level"));
      const paramBox = document.createElement("div");
      paramBox.className = "sheet-params";
      const paramInputs = {};
      fields.forEach((f) => {
        const lab = document.createElement("span");
        const long = String(f.label || "").length > 22;
        lab.className = "fld" + (long ? " wide" : "");
        lab.textContent = f.label + (f.unit ? " · " + f.unit : "");
        let inp;
        if (f.kind === "select") {
          inp = document.createElement("select");
          inp.className = "bind" + (long ? " wide" : "");
          (f.options || []).forEach((o) => {
            const opt = document.createElement("option");
            opt.value = o.v;
            opt.textContent = o.t;
            inp.appendChild(opt);
          });
          const draftVal = draft && draft.params ? draft.params[f.key] : undefined;
          inp.value = draftVal != null ? String(draftVal) : String(f.def);
        } else {
          inp = document.createElement("input");
          inp.type = "number";
          inp.className = "bind" + (long ? " wide" : "");
          inp.step = "any";
          const draftVal = draft && draft.params ? draft.params[f.key] : undefined;
          inp.value = draftVal != null && Number.isFinite(Number(draftVal))
            ? Number(draftVal)
            : Number(f.def);
        }
        inp.setAttribute("aria-label", lab.textContent);
        paramInputs[f.key] = inp;
        paramBox.append(lab, inp);
      });
      const collectParams = () => {
        const out = {};
        fields.forEach((f) => {
          if (f.kind === "select") {
            out[f.key] = String(paramInputs[f.key].value || f.def || "");
            return;
          }
          const n = Number(paramInputs[f.key].value);
          out[f.key] = Number.isFinite(n) ? n : Number(f.def);
        });
        if (perLoadLevel) out.level = defLevel;
        return out;
      };
      const actions = document.createElement("div");
      actions.className = "actions";
      const save = document.createElement("button");
      save.type = "button";
      save.className = "ghost";
      save.textContent = "На стол";
      const refreshSave = () => {
        const okTrig = !needTrig || (trigPicker && !trigPicker.isEmpty());
        const okAux = !needAux || (auxPicker && !auxPicker.isEmpty());
        const okTgt = collectTargets().length > 0;
        const ready = Boolean(okTrig && okAux && okTgt);
        save.disabled = !ready;
        save.title = ready ? "" : "Нужны датчик/кнопка и хотя бы одна нагрузка";
      };
      save.addEventListener("click", () => {
        if (save.disabled) return;
        const trigContact = trigPicker ? (trigPicker.collect()[0] || null) : null;
        const auxContact = auxPicker ? (auxPicker.collect()[0] || null) : null;
        fetch("/runtime/desk-solutions", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: draft && draft.id,
            solutionId: card.id,
            trigger: needTrig ? trigContact : null,
            aux: needAux ? auxContact : undefined,
            targets: collectTargets(),
            params: (fields.length || perLoadLevel) ? collectParams() : undefined,
          }),
        }).then((r) => r.json()).then((j) => {
          if (!j.ok) {
            err.textContent = j.error === "need_trigger"
              ? ("Нужен " + sheetTrigLab(card).toLowerCase() + " с шины")
              : j.error === "need_aux"
                ? ("Нужен " + sheetAuxLab(card).toLowerCase() + " с шины")
              : j.error === "need_target" || j.error === "need_load"
                ? ("Нужна " + sheetTgtLab(card).toLowerCase() + " из разметки")
              : j.error === "not_pourable"
                ? "Эта карточка пока не льётся — выберите другую"
              : j.error === "output_taken"
                ? "Этот выход уже держит такая же карточка"
              : j.error === "output_busy"
                ? "Этот выход уже держит постоянное правило"
              : j.error === "output_schedule"
                ? "На этом выходе расписание спорит с постоянным правилом"
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
              head.textContent = "Сцена на столе. Запишите на щит, когда обход закончен.";
            }
            paintPourButtons();
            renderReady();
          });
        }).catch(() => { err.textContent = "Нет связи со щитом"; });
      });
      refreshSave();
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "ghost";
      cancel.textContent = "Закрыть";
      cancel.addEventListener("click", closeCardSheet);
      actions.append(save, cancel);
      const head = document.createElement("div");
      head.className = "sheet-head";
      head.append(h, lead);
      rawBtn.addEventListener("click", () => {
        rawOn = !rawOn;
        rawBtn.setAttribute("aria-pressed", rawOn ? "true" : "false");
        const hint = rawOn ? rawHint : "Поиск: кух, бра, канал…";
        const rawEmpty = card.id === "light_dim_hold_mcm"
          ? "На шине нет каналов WB-LED, DALI или MDM3."
          : "На шине нет таких каналов.";
        if (trigPicker) trigPicker.setRows(rawOn ? rawTriggerRows() : namedTrigRows, hint, rawOn ? rawEmpty : "");
        if (auxPicker) auxPicker.setRows(rawOn ? rawTriggerRows() : auxNamed, hint, rawOn ? rawEmpty : "");
        if (tgtPicker) tgtPicker.setRows(rawOn ? rawLoadsForCard(card) : namedLoadRows, hint, rawOn ? rawEmpty : "");
      });
      const body = document.createElement("div");
      body.className = "sheet-body";
      body.append(trigLab, trig);
      if (needAux && aux) body.append(auxLab, aux);
      body.append(tgtLab, tgtNode);
      if (fields.length) body.appendChild(paramBox);
      body.appendChild(err);
      box.append(head, body, actions);
    }
    function solParamsHuman(sol, card) {
      const fields = (card && card.fields) || (deskCatalog.find((c) => c.id === sol.solutionId) || {}).fields || [];
      if (!fields.length || !sol.params) return "";
      return fields.map((f) => {
        const v = sol.params[f.key];
        if (f.kind === "select") {
          const opt = (f.options || []).find((o) => String(o.v) === String(v));
          return f.label + ": " + ((opt && opt.t) || v || f.def);
        }
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
      scene_come_home: "<svg viewBox='0 0 24 24'><path d='M3 11l9-8 9 8'/><path d='M9 21V12h6v9'/></svg>",
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
      if (activeNav === "climate" && have.has("Климат")) cardFilter = "Климат";
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
      filters.hidden = activeNav === "climate";
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
        if (j && j.error === "marking_unreadable") {
          markingUnreadable = true;
          paintBenchReady();
          return;
        }
        if (!j.ok) return;
        deskCatalog = j.catalog || [];
        deskSolutions = j.solutions || [];
        renderVitrine();
        renderDeskSolutions();
        stampDiskScenes();
        if (activeTab === "poured") renderReady();
        if (activeTab === "mark") renderMark();
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
        const ver = String(j.agentVersion || "") || "—";
        if (!j.ok) {
          box.className = "status bad";
          main.textContent = "Offline";
          if (sub) { sub.hidden = true; sub.textContent = ""; }
          const gone = $("healthAddr");
          if (gone) { gone.hidden = true; gone.textContent = ""; }
          return;
        }
        const clock = j.controllerClock || {};
        shieldClockOk = clock.ok !== false;
        shieldClockUnverified = clock.unverified === true;
        shieldClockLabel = clock.label || "";
        shieldClockSource = clock.source || "";
        shieldClockZone = clock.zone || shieldClockZone;
        paintShieldClock();
        const verLine = $("settingsVer");
        if (verLine) verLine.textContent = "Сборка " + ver;
        const offline = Number(mirror.offlineDeviceCount) || 0;
        const incident = Array.isArray(j.busIncidents) && j.busIncidents[0] ? j.busIncidents[0].reason : "";
        const busCalm = busOk && shieldClockOk && !shieldClockUnverified && !offline && !incident;
        box.className = "status " + (busCalm ? "ok" : "bad");
        main.textContent = busCalm ? "Connected" : (busOk ? "Не всё" : "Offline");
        main.title = ver;
        const addr = $("healthAddr");
        const ip = String(j.controllerAddress || "").trim();
        if (addr) {
          addr.textContent = ip;
          addr.hidden = !ip;
        }
        if (sub) {
          const bits = [];
          if (shieldClockUnverified) bits.push("Время не прочитано");
          else if (!shieldClockOk) bits.push("Часы не совпадают с телефоном");
          if (offline) bits.push(offline === 1 ? "Один модуль молчит" : ("Молчит модулей: " + offline));
          if (incident) bits.push(incident);
          sub.textContent = bits.join(" · ");
          sub.hidden = bits.length === 0;
        }
      } catch (e) {
        box.className = "status bad";
        main.textContent = "Offline";
        if (sub) { sub.hidden = true; sub.textContent = ""; }
        const addr = $("healthAddr");
        if (addr) { addr.hidden = true; addr.textContent = ""; }
      }
    }
    async function openFieldCert() {
      const box = $("cardSheet");
      const mask = $("cardMask");
      box.hidden = false;
      mask.hidden = false;
      box.replaceChildren();
      const h = document.createElement("h3");
      h.textContent = "Готовность";
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
    function hardwareChannelLabel(s, ch) {
      const mod = String((s && (s.label || s.deviceTopicKey)) || "").trim() || "модуль";
      const cid = prettyControlId(ch && ch.controlId) || (ch && ch.controlId) || "канал";
      return mod + " · " + cid;
    }
    function rawTriggerRows() {
      const raw = [];
      (lastShelvesRows || []).forEach((s) => {
        (s.channels || []).forEach((ch) => {
          if (isDeskLoad(ch.controlId)) return;
          if (/(?:Single|Short|Long|Shortlong|Double) Press Counter$/i.test(String(ch.controlId || ""))) return;
          if (!isDeskInput(ch.controlId, s.deviceTopicKey)) return;
          const mod = s.label || s.deviceTopicKey;
          raw.push({
            deviceTopicKey: s.deviceTopicKey,
            controlId: ch.controlId,
            room: mod,
            label: hardwareChannelLabel(s, ch),
            named: false,
          });
        });
      });
      raw.sort((a, b) => a.label.localeCompare(b.label, "ru", { numeric: true }));
      return raw;
    }
    function rawLoadRows() {
      const raw = [];
      (lastShelvesRows || []).forEach((s) => {
        (s.channels || []).forEach((ch) => {
          if (!isDeskLoad(ch.controlId)) return;
          if (isDriveClose(ch.controlId)) return;
          const mod = s.label || s.deviceTopicKey;
          raw.push({
            deviceTopicKey: s.deviceTopicKey,
            controlId: ch.controlId,
            room: mod,
            label: hardwareChannelLabel(s, ch),
            raw: true,
          });
        });
      });
      raw.sort((a, b) => a.label.localeCompare(b.label, "ru", { numeric: true }));
      return raw;
    }
    function rawDimmerRows() {
      const raw = [];
      (lastShelvesRows || []).forEach((s) => {
        const key = String(s.deviceTopicKey || "");
        const label = String(s.label || "");
        const dimmer = /led|ampled|dali|mdm|mao/i.test(key + " " + label);
        if (!dimmer) return;
        visibleChannels(s).forEach((ch) => {
          const id = String(ch.controlId || "").trim();
          if (!/^(?:Channel|CCT|RGB)\s*\d+$/i.test(id) && !/^(?:CCT|RGB)\d+$/i.test(id)) return;
          const mod = s.label || s.deviceTopicKey;
          raw.push({
            deviceTopicKey: s.deviceTopicKey,
            controlId: id,
            room: mod,
            label: mod + " · " + id,
            raw: true,
          });
        });
      });
      raw.sort((a, b) => a.label.localeCompare(b.label, "ru", { numeric: true }));
      return raw;
    }
    function rawLoadsForCard(card) {
      const all = rawLoadRows();
      if (card.id === "light_dim_hold_mcm") {
        const dim = rawDimmerRows();
        return dim.length ? dim : all.filter(isLikelyDimmerLoad);
      }
      if ((card.loadKind || "") === "light" || card.cat === "Свет" || card.cat === "Сцены") {
        return all.filter((r) => /^(?:Channel|CCT|RGB)\s*\d+$/i.test(r.controlId)
          || /^(?:CCT|RGB)\d+$/i.test(r.controlId)
          || /^K\d+$/i.test(r.controlId)
          || isLightLoad(r));
      }
      if (card.cat === "Шторы") {
        const hit = all.filter(isCurtainLoad);
        return hit.length ? hit : all.filter((r) => isDeskDrive(r.controlId));
      }
      if (card.loadKind) {
        const hit = all.filter((r) => loadKindHit(card.loadKind, r));
        return hit.length ? hit : all;
      }
      return all;
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
            head.textContent = "Имя на столе. На щит оно уйдёт одной записью.";
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
      const heldShelf = solutionsOnLoad(s.deviceTopicKey, ch.controlId);
      if (heldShelf.length) {
        const note = document.createElement("span");
        note.className = "hint";
        note.textContent = heldShelf.join(" · ");
        cap.append(note);
      }
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
        if (j && j.error === "marking_unreadable") markingUnreadable = true;
        else if (j.ok && Array.isArray(j.rooms)) {
          markingUnreadable = false;
          deskRooms = j.rooms;
        }
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
      cat.hidden = true;
      top.append(ico, cat);
      const rooms = [];
      const lineNames = [];
      visibleChannels(s).forEach((ch) => {
        const nm = pairName(s, ch);
        const room = nameRoom(nm);
        if (room && rooms.indexOf(room) < 0) rooms.push(room);
        if (nm) lineNames.push(String(nm).trim());
      });
      const hardware = String(s.label || s.deviceTopicKey || "").trim();
      const vt = document.createElement("span");
      vt.className = "vt";
      vt.textContent = rooms.length ? rooms.join(" · ") : (hardware || "Без имени");
      vt.title = hardware;
      const vs = document.createElement("span");
      vs.className = "vs";
      if (rooms.length) {
        const lines = lineNames.slice(0, 2).join(" · ");
        vs.textContent = lines ? hardware + " · " + lines : hardware;
      } else {
        vs.textContent = lineNames.length
          ? lineNames.slice(0, 3).join(" · ")
          : "Назовите комнату и линию";
      }
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
        open.hidden = true;
        const freeEl = document.createElement("span");
        freeEl.className = "mod-free";
        freeEl.textContent = free ? (free + " без имени") : "";
        if (!freeEl.textContent) freeEl.hidden = true;
        const badge = document.createElement("span");
        badge.className = "mod-badge" + (lit ? " lit" : "");
        badge.textContent = lit ? ("горит " + lit) : "";
        if (!badge.textContent) badge.hidden = true;
        foot.append(open, freeEl, badge);
        el.appendChild(foot);
      } else {
        const pills = document.createElement("div");
        pills.className = "mod-pills";
        const occ = document.createElement("span");
        occ.className = "mod-pill";
        occ.hidden = true;
        const bus = document.createElement("span");
        bus.className = "mod-pill" + (lit ? " lit" : " on");
        bus.textContent = lit ? ("горит " + lit) : "";
        if (!bus.textContent) bus.hidden = true;
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
      const heldDrill = solutionsOnLoad(s.deviceTopicKey, ch.controlId);
      if (heldDrill.length) sub.textContent = (sub.textContent ? sub.textContent + " · " : "") + heldDrill.join(" · ");
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
        stopLiveWatch();
        closeModule();
      });
      const head = document.createElement("div");
      head.className = "vcard";
      paintModuleFace(head, s, { drill: true });
      const chs = document.createElement("ul");
      chs.className = "channels drill-list";
      if (listenAutoMod !== s.deviceTopicKey) {
        listenAutoMod = s.deviceTopicKey;
        setTimeout(() => startLiveWatch(180000), 0);
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
    function normModuleSearch(value) {
      return String(value || "").toLowerCase().replace(/[№#]/g, " ").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    }
    function moduleMatchesQuery(s, q) {
      const query = normModuleSearch(q);
      if (!query) return true;
      const names = [];
      visibleChannels(s).forEach((ch) => {
        const nm = pairName(s, ch);
        if (nm) names.push(nm);
      });
      const blob = normModuleSearch([s && s.label, s && s.deviceTopicKey].concat(moduleRoomsOf(s), names).join(" "));
      const flat = blob.replace(/\s+/g, "");
      return query.split(" ").every((token) => {
        if (/^\d+$/.test(token)) return new RegExp("(^|\\D)" + token + "(\\D|$)").test(blob);
        return flat.includes(token.replace(/\s+/g, ""));
      });
    }
    function modulesForFilter(rows) {
      const list = sortModules(rows || []).filter((s) => moduleMatchesQuery(s, modQuery));
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
        p.textContent = String(modQuery || "").trim() ? "Такого модуля нет." : emptyText;
        box.appendChild(p);
        return;
      }
      const open = filtered.find((s) => s.deviceTopicKey === openMod)
        || (String(modQuery || "").trim() ? null : (rows || []).find((s) => s.deviceTopicKey === openMod));
      if (open) {
        box.className = "modopen";
        renderModuleDrill(box, open);
        return;
      }
      box.className = "vitrine";
      const grouped = new Map();
      filtered.forEach((s) => {
        const rooms = [];
        visibleChannels(s).forEach((ch) => {
          const room = nameRoom(pairName(s, ch));
          if (room && rooms.indexOf(room) < 0) rooms.push(room);
        });
        const key = rooms.length ? rooms.join(" · ") : "Без имени";
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(s);
      });
      const order = [...grouped.keys()].sort((a, b) => {
        if (a === "Без имени") return 1;
        if (b === "Без имени") return -1;
        return a.localeCompare(b, "ru");
      });
      order.forEach((room) => {
        const h = document.createElement("p");
        h.className = "sech";
        h.textContent = room;
        box.appendChild(h);
        grouped.get(room).forEach((s) => box.appendChild(moduleTile(s)));
      });
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
        (s.channels || []).forEach((ch) => {
          if (!/^Input\s+\d+$/i.test(String(ch?.controlId || ""))) return;
          if (String(ch?.name || "").trim()) return;
          n += 1;
        });
      });
      return n;
    }
    function stopKeyScan() {
      if (keyScanTimer) clearInterval(keyScanTimer);
      keyScanTimer = 0;
      keyScan = null;
    }
    function pressSignalMap(shelves) {
      const map = new Map();
      (shelves || []).forEach((s) => {
        (s.channels || []).forEach((ch) => {
          const cid = String(ch.controlId || "");
          const m = /^(Input\s+[A-Z]?\d+)\s+(Single|Shortlong|Short|Long|Double) Press Counter$/i.exec(cid);
          if (m) {
            const gesture = /^long$/i.test(m[2]) ? "long" : /^double/i.test(m[2]) ? "double" : /^shortlong/i.test(m[2]) ? "shortlong" : "short";
            const key = s.deviceTopicKey + "::" + m[1] + (gesture === "short" ? "" : "::" + gesture);
            map.set(key, {
              kind: "counter",
              gesture,
              v: Number(ch.lastValue) || 0,
              deviceTopicKey: s.deviceTopicKey,
              controlId: m[1],
            });
            return;
          }
          if (/^Input\s+[A-Z]?\d+$/i.test(cid) || /^EXT\d+_IN/i.test(cid) || /^[A-D]\d+_IN/i.test(cid)) {
            const k = s.deviceTopicKey + "::" + cid;
            if (!map.has(k) || map.get(k).kind !== "counter") {
              map.set(k, {
                kind: "level",
                v: ch.lastValue,
                closed: ch.lastValue === 1 || ch.lastValue === true || ch.lastValue === "1" || ch.lastValue === "on",
                deviceTopicKey: s.deviceTopicKey,
                controlId: cid,
              });
            }
          }
        });
      });
      return map;
    }
    async function loadKeyPlan() {
      try {
        const r = await fetch("/runtime/desk-key-plan");
        const j = await r.json();
        if (j && j.error === "marking_unreadable") {
          markingUnreadable = true;
          keyPlan = [];
        } else {
          if (j && j.ok) markingUnreadable = false;
        keyPlan = Array.isArray(j.keyPlan) ? j.keyPlan : [];
          walkSite = j.site && typeof j.site === "object" ? j.site : { kind: "", floors: 1 };
          walkRooms = Array.isArray(j.roomBook) ? j.roomBook : [];
          walkCatalog = Array.isArray(j.roomCatalog) ? j.roomCatalog : [];
          walkPurposes = Array.isArray(j.purposes) ? j.purposes : [];
          walkLightPurposes = j.lightPurposes && typeof j.lightPurposes === "object"
            ? { led: Array.isArray(j.lightPurposes.led) ? j.lightPurposes.led : [], relay: Array.isArray(j.lightPurposes.relay) ? j.lightPurposes.relay : [] }
            : walkLightPurposes;
        }
      } catch {
        keyPlan = [];
      }
    }
    function pressRises(state, now) {
      const rises = [];
      now.forEach((sig, k) => {
        const base = state.baseline.get(k);
        if (sig.kind === "counter") {
          const prev = base && base.kind === "counter" ? base.v : sig.v;
          const d = sig.v - prev;
          state.baseline.set(k, sig);
          if (d > 3) rises.push({ k: k, d: 0, jump: true, sig: sig });
          else if (d > 0) rises.push({ k: k, d: d, sig: sig });
        } else if (sig.kind === "level") {
          const was = state.prevClosed.get(k);
          state.prevClosed.set(k, Boolean(sig.closed));
          if (sig.closed && was === false) rises.push({ k: k, d: 1, sig: sig });
        }
      });
      return rises;
    }
    function orderedKeys() {
      const rooms = [...new Set(keyPlan.map((k) => k.room))].sort((a, b) => a.localeCompare(b, "ru"));
      const ordered = [];
      rooms.forEach((room) => {
        keyPlan.filter((k) => k.room === room).forEach((k) => ordered.push(k));
      });
      return ordered;
    }
    function nextUnboundKey(afterId) {
      const ordered = orderedKeys();
      let start = 0;
      if (afterId) {
        const i = ordered.findIndex((k) => k.id === afterId);
        if (i >= 0) start = i + 1;
      }
      for (let n = 0; n < ordered.length; n += 1) {
        const k = ordered[(start + n) % ordered.length];
        if (k.id !== afterId && !k.deviceTopicKey) return k;
      }
      return null;
    }
    function keyScanStatusText() {
      if (!keyScan) return "";
      const row = keyScan.walk ? null : keyPlan.find((k) => k.id === keyScan.id);
      const left = Math.max(0, keyScan.need - keyScan.count);
      const ask = !keyScan.primed
        ? "Секунду"
        : left === 3
          ? "Нажмите 3 раза"
          : left === 2
            ? "Нажмите ещё 2 раза"
            : left === 1
              ? "Нажмите ещё раз"
              : "Кнопка нашлась";
      const where = keyScan.walk
        ? "Выключатель"
        : (row ? row.room + " · " + row.label : "Клавиша");
      return (keyPlanNote ? keyPlanNote + " " : "")
        + (keyScan.jump ? "Слишком быстро. Три раза, спокойнее. " : "")
        + (keyScan.ambiguous ? "Сработали две кнопки. Начните с одной. " : "")
        + (keyScan.reset && !keyScan.ambiguous && !keyScan.jump ? "Это другая кнопка. Начните сначала. " : "")
        + where + ". "
        + ask;
    }
    function paintKeyScanLive() {
      const status = document.querySelector("#mark-body .key-scan-status");
      if (!status || !keyScan) return false;
      status.textContent = keyScanStatusText();
      status.classList.add("live");
      const armed = document.querySelector("#mark-body .key-row.armed .meta");
      if (armed) {
        armed.textContent = keyScan.hitKey
          ? "Слушаю эту кнопку"
          : "Ещё не найдена. Три коротких нажатия";
      }
      return true;
    }
    function startKeyScan(item, opts) {
      stopKeyScan();
      const walk = !item;
      const wasBound = Boolean(item && item.deviceTopicKey);
      if (!walk && item.room) keyRoomFilter = item.room;
      if (walk) keyCatch = null;
      const scanId = walk ? "walk" : item.id;
      keyScan = {
        id: scanId,
        walk,
        need: 3,
        count: 0,
        hitKey: "",
        primed: false,
        ignoreKey: opts && opts.ignoreKey ? opts.ignoreKey : "",
        ignoreUntil: opts && opts.ignoreKey ? Date.now() + 1600 : 0,
        baseline: pressSignalMap(lastShelvesRows),
        prevClosed: new Map(),
      };
      pressSignalMap(lastShelvesRows).forEach((sig, k) => {
        if (sig.kind === "level") keyScan.prevClosed.set(k, Boolean(sig.closed));
      });
      const tick = () => {
        if (!keyScan || keyScan.id !== scanId || keyScanBusy) return;
        keyScanBusy = true;
        fetch("/runtime/mqtt-scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ instant: true, inputsOnly: true }),
        })
          .then((r) => r.json())
          .then((j) => {
            if (!keyScan || !j || !j.ok || !Array.isArray(j.shelves)) return;
            lastShelvesRows = paintLiveValues(lastShelvesRows, j.shelves);
            if (!keyScan.primed) {
              keyScan.baseline = pressSignalMap(lastShelvesRows);
              keyScan.prevClosed = new Map();
              keyScan.baseline.forEach((sig, k) => {
                if (sig.kind === "level") keyScan.prevClosed.set(k, Boolean(sig.closed));
              });
              keyScan.primed = true;
              if (!paintKeyScanLive()) renderMark();
              return;
            }
            const rises = pressRises(keyScan, pressSignalMap(lastShelvesRows)).filter((r) => {
              if (!keyScan.ignoreKey || r.k !== keyScan.ignoreKey) return true;
              return Date.now() >= keyScan.ignoreUntil;
            });
            if (!rises.length) {
              if (pressSignalMap(lastShelvesRows).size === 0 && !keyScan.blind) {
                keyScan.blind = true;
                keyPlanNote = "Кнопок пока не видно. Нажмите «Обновить» и начните снова.";
                if (!paintKeyScanLive()) renderMark();
              }
              return;
            }
            const clean = rises.filter((r) => !r.jump);
            if (clean.some((r) => r.sig && r.sig.gesture && r.sig.gesture !== "short")) {
              keyScan.hitKey = "";
              keyScan.count = 0;
              keyPlanNote = "Это было долгое или двойное нажатие. Нужны три коротких.";
              if (!paintKeyScanLive()) renderMark();
              return;
            }
            if (rises.some((r) => r.jump) || clean.length > 1) {
              keyScan.hitKey = "";
              keyScan.count = 0;
              keyScan.reset = true;
              keyScan.jump = rises.some((r) => r.jump);
              keyScan.ambiguous = clean.length > 1;
              if (!paintKeyScanLive()) renderMark();
              return;
            }
            const rose = clean[0];
            keyScan.ambiguous = false;
            keyScan.jump = false;
            if (keyScan.hitKey && keyScan.hitKey !== rose.k) {
              keyScan.hitKey = rose.k;
              keyScan.count = rose.d;
              keyScan.reset = true;
            } else {
              keyScan.reset = false;
              keyScan.hitKey = rose.k;
              keyScan.count += rose.d;
            }
            if (!paintKeyScanLive()) renderMark();
            if (keyScan.count >= keyScan.need) {
              const sig = rose.sig;
              if (keyScan.walk) {
                const caught = rose.sig;
                const ignoreKey = rose.k;
                stopKeyScan();
                fetch("/runtime/desk-key-plan", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    draft: true,
                    deviceTopicKey: caught.deviceTopicKey,
                    controlId: caught.controlId,
                  }),
                })
                  .then((r) => r.json())
                  .then((res) => {
                    if (res && res.ok && res.key) {
                      keyPlan = res.keyPlan || keyPlan;
                      keyCatch = {
                        deviceTopicKey: res.key.deviceTopicKey,
                        controlId: res.key.controlId,
                        id: res.key.id,
                        ignoreKey,
                        fresh: !res.key.label,
                      };
                      keyPlanNote = "";
                    } else keyPlanNote = "Топик не встал в таблицу.";
                    renderMark();
                  })
                  .catch(() => {
                    keyPlanNote = "Щит не ответил.";
                    renderMark();
                  });
                return;
              }
              const armedId = keyScan.id;
              stopKeyScan();
              fetch("/runtime/desk-key-plan", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  bind: true,
                  id: armedId,
                  deviceTopicKey: sig.deviceTopicKey,
                  controlId: sig.controlId,
                }),
              })
                .then((r) => r.json())
                .then((res) => {
                  if (res && res.ok) {
                    const prevKey = (keyPlan || []).find((k) => k.id === armedId);
                    keyPlan = res.keyPlan || keyPlan;
                    if (
                      prevKey &&
                      prevKey.deviceTopicKey &&
                      (prevKey.deviceTopicKey !== sig.deviceTopicKey || prevKey.controlId !== sig.controlId)
                    ) {
                      const oldName = prevKey.room + " · " + prevKey.label;
                      lastShelvesRows = (lastShelvesRows || []).map((s) => {
                        if (!s || s.deviceTopicKey !== prevKey.deviceTopicKey) return s;
                        return {
                          ...s,
                          channels: (s.channels || []).map((c) =>
                            c && c.controlId === prevKey.controlId && c.name === oldName
                              ? { ...c, name: "", source: "" }
                              : c,
                          ),
                        };
                      });
                    }
                    const bound = (keyPlan || []).find((k) => k.id === armedId);
                    const markName = bound
                      ? (bound.room + " · " + bound.label)
                      : "";
                    if (markName && sig.deviceTopicKey && sig.controlId) {
                      lastShelvesRows = (lastShelvesRows || []).map((s) => {
                        if (!s || s.deviceTopicKey !== sig.deviceTopicKey) return s;
                        return {
                          ...s,
                          channels: (s.channels || []).map((c) =>
                            c && c.controlId === sig.controlId
                              ? { ...c, name: markName, source: "desk" }
                              : c,
                          ),
                        };
                      });
                    }
                    const head = $("previewHead");
                    if (head) {
                      head.hidden = false;
                      head.style.color = "";
                      head.textContent = "Клавиша привязана · " + sig.deviceTopicKey + "/" + sig.controlId
                        + " · в типовых как кнопка";
                    }
                    keyPlanNote = "";
                    const nxt = !wasBound ? nextUnboundKey(armedId) : null;
                    if (nxt) {
                      keyRoomFilter = nxt.room;
                      startKeyScan(nxt, { ignoreKey: rose.k });
                      return;
                    }
                    renderMark();
                    return;
                  }
                  if (res && res.error === "topic_taken") {
                    keyPlanNote = "Эта кнопка уже называется «" + (res.room || "") + " · " + (res.label || "") + "».";
                  }
                  renderMark();
                })
                .catch(() => renderMark());
            }
          })
          .catch(() => {})
          .finally(() => { keyScanBusy = false; });
      };
      keyScanTimer = setInterval(tick, 280);
      tick();
      renderMark();
      const armedRow = document.querySelector("#mark-body .key-row.armed");
      if (armedRow && armedRow.scrollIntoView) armedRow.scrollIntoView({ block: "nearest" });
    }
    function paintLiveValues(prev, next) {
      const updates = new Map();
      for (const s of next || []) {
        if (!s || !s.deviceTopicKey) continue;
        updates.set(s.deviceTopicKey, new Map((s.channels || []).map((c) => [c.controlId, c.lastValue])));
      }
      return (prev || []).map((s) => {
        const row = updates.get(s.deviceTopicKey);
        if (!row) return s;
        return {
          ...s,
          channels: (s.channels || []).map((c) =>
            row.has(c.controlId) ? { ...c, lastValue: row.get(c.controlId) } : c,
          ),
        };
      });
    }
    function sameRoom(a, b) {
      return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
    }
    function roomCanon(name) {
      const s = String(name || "").trim();
      const hit = (keyPlan || []).find((k) => k && sameRoom(k.room, s));
      return hit ? hit.room : s;
    }
    function caughtNamed() {
      if (!keyCatch) return null;
      return (keyPlan || []).find((k) =>
        k && k.deviceTopicKey === keyCatch.deviceTopicKey && String(k.controlId || "") === String(keyCatch.controlId || ""),
      ) || null;
    }
    function nextKeyLabelForRoom(room) {
      const n = keyPlan.filter((k) => sameRoom(k.room, room)).length + 1;
      return "клавиша " + n;
    }
    function postKeyPlanLabels(room, labelsText, done) {
      const roomName = String(room || "").trim();
      const text = String(labelsText || "").trim();
      if (!roomName || !text) return;
      fetch("/runtime/desk-key-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ room: roomName, labelsText: text }),
      })
        .then((r) => r.json())
        .then((j) => {
          if (j && j.ok) {
            keyPlan = j.keyPlan || [];
            keyRoomFilter = roomName;
            keyPlanFocus = true;
            keyPlanNote = j.dropped
              ? ("Не влезло " + j.dropped + " из " + j.added + ". План держит " + j.cap + " клавиш.")
              : (j.duplicates ? ("Уже были в этой комнате: " + j.duplicates + ".") : "");
            if (typeof done === "function") done(j);
            renderMark();
          }
        });
    }
    function paintCaughtOnShelf(sig, markName) {
      if (!markName || !sig || !sig.deviceTopicKey || !sig.controlId) return;
      lastShelvesRows = (lastShelvesRows || []).map((s) => {
        if (!s || s.deviceTopicKey !== sig.deviceTopicKey) return s;
        return {
          ...s,
          channels: (s.channels || []).map((c) =>
            c && c.controlId === sig.controlId ? { ...c, name: markName, source: "desk" } : c,
          ),
        };
      });
    }
    function saveCaughtKey(code, purpose) {
      const place = (walkRooms || []).find((r) => r && r.code === code);
      const name = String(purpose || "").trim();
      const sig = keyCatch;
      if (!sig) return;
      if (!place || !name) {
        keyPlanNote = "Выберите комнату и назначение.";
        renderMark();
        return;
      }
      fetch("/runtime/desk-key-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          capture: true,
          room: place.name,
          code: place.code,
          floor: place.floor,
          label: name,
          deviceTopicKey: sig.deviceTopicKey,
          controlId: sig.controlId,
        }),
      })
        .then((r) => r.json())
        .then((res) => {
          if (res && res.ok) {
            keyPlan = res.keyPlan || keyPlan;
            const saved = res.key || {};
            paintCaughtOnShelf(sig, (saved.code ? saved.code + " " : "") + (saved.room || place.name) + " · " + (saved.label || name));
            keyCatch = null;
            keyPlanNote = "";
            loadKeyPlan().then(() => renderMark());
            return;
          }
          if (res && res.error === "topic_taken") {
            keyPlanNote = "Эта кнопка уже называется «" + (res.room || "") + " · " + (res.label || "") + "».";
          } else if (res && res.error === "duplicate_label") {
            keyPlanNote = "В этой комнате такое имя уже есть.";
          } else if (res && res.error === "need_room_label") {
            keyPlanNote = "Напишите комнату и имя кнопки.";
          } else {
            keyPlanNote = "Не сохранил. Попробуйте ещё раз.";
          }
          renderMark();
        })
        .catch(() => {
          keyPlanNote = "Щит не ответил. Попробуйте ещё раз.";
          renderMark();
        });
    }
    function renderKeyScanPanel(root) {
      root.replaceChildren();
      const body = document.createElement("div");
      body.className = "walk-sheet";
      root.appendChild(body);
      if (!walkSite || !walkSite.kind) {
        const phase = document.createElement("p");
        phase.className = "meta";
        phase.textContent = "Сначала объект. Комнаты и выключатели встанут в таблицу с кодом помещения.";
        const row = document.createElement("div");
        row.className = "key-plan-actions";
        const flat = document.createElement("button");
        flat.type = "button";
        flat.className = "ghost key-add-all";
        flat.textContent = "Квартира";
        flat.addEventListener("click", () => postWalk({ site: { kind: "flat", floors: 1 } }));
        const house = document.createElement("button");
        house.type = "button";
        house.className = "ghost";
        house.textContent = "Частный дом";
        const floors = document.createElement("select");
        floors.className = "bind";
        floors.setAttribute("aria-label", "Этажей");
        [1, 2, 3, 4, 5].forEach((n) => {
          const opt = document.createElement("option");
          opt.value = String(n);
          opt.textContent = n + (n === 1 ? " этаж" : n < 5 ? " этажа" : " этажей");
          floors.appendChild(opt);
        });
        floors.value = "2";
        house.addEventListener("click", () => postWalk({ site: { kind: "house", floors: Number(floors.value) || 2 } }));
        row.append(flat, house, floors);
        body.append(phase, row);
        return;
      }
      const phaseRow = document.createElement("div");
      phaseRow.className = "key-plan-actions";
      const phase = document.createElement("p");
      phase.className = "meta";
      phase.style.margin = "0";
      phase.textContent = "Три нажатия — сразу карточка этой клавиши. Следующую скан слушает после записи.";
      phaseRow.appendChild(phase);
      if (walkSite.kind === "house") {
        const usedFloor = (walkRooms || []).reduce((max, room) => Math.max(max, Number(room.floor) || 1), 1);
        const floors = document.createElement("select");
        floors.className = "bind";
        floors.setAttribute("aria-label", "Этажей");
        [1, 2, 3, 4, 5].forEach((n) => {
          const opt = document.createElement("option");
          opt.value = String(n);
          opt.textContent = n + (n === 1 ? " этаж" : n < 5 ? " этажа" : " этажей");
          if (n < usedFloor) opt.disabled = true;
          floors.appendChild(opt);
        });
        floors.value = String(Math.min(5, Math.max(usedFloor, Number(walkSite.floors) || 1)));
        floors.addEventListener("change", () => {
          postWalk({ site: { kind: "house", floors: Number(floors.value) || 1 } });
        });
        phaseRow.appendChild(floors);
      }
      body.appendChild(phaseRow);
      const roomsHead = document.createElement("div");
      roomsHead.className = "key-plan-actions";
      const add = document.createElement("button");
      add.type = "button";
      add.className = "ghost key-add-all";
      add.textContent = walkRoomOpen ? "Свернуть" : "+ Комната";
      add.addEventListener("click", () => {
        walkRoomOpen = !walkRoomOpen;
        renderMark();
      });
      roomsHead.appendChild(add);
      body.appendChild(roomsHead);
      if (walkRoomOpen) body.appendChild(roomAddCard());
      const roomList = document.createElement("div");
      roomList.className = "walk-rooms";
      const orderedRooms = (walkRooms || []).slice().sort((a, b) => String(a.code).localeCompare(String(b.code)));
      if (!orderedRooms.length) {
        const empty = document.createElement("p");
        empty.className = "meta orphan";
        empty.textContent = "Помещение появится в строке, когда впишете его в таблицу.";
        roomList.appendChild(empty);
      }
      orderedRooms.forEach((room) => {
        const chip = document.createElement("span");
        chip.className = "mod-pill on";
        chip.textContent = room.code + " · " + (walkSite.kind === "house" ? (room.floor + " эт. ") : "") + room.name;
        roomList.appendChild(chip);
      });
      body.appendChild(roomList);
      const status = document.createElement("p");
      status.className = "meta key-scan-status";
      if (keyScan) {
        status.textContent = keyScanStatusText();
        status.classList.add("live");
      } else if (keyCatch) {
        status.textContent = keyPlanNote || "Запишите эту клавишу. Следующую скан поймает после записи.";
      } else {
        status.textContent = (keyPlanNote ? keyPlanNote + " " : "") + "Нажмите «Сканировать» и следуйте подсказкам.";
      }
      body.appendChild(status);
      if (keyCatch) {
        body.appendChild(assignCard(caughtNamed()));
      } else if (!keyScan) {
        const listen = document.createElement("button");
        listen.type = "button";
        listen.className = "ghost key-add-all";
        listen.textContent = "Сканировать";
        listen.disabled = false;
        listen.title = "Нажмите выключатель три раза";
        listen.addEventListener("click", () => {
          keyPlanNote = "";
          startKeyScan(null);
        });
        body.appendChild(listen);
      } else {
        const stop = document.createElement("button");
        stop.type = "button";
        stop.className = "ghost";
        stop.textContent = "Стоп";
        stop.addEventListener("click", () => { stopKeyScan(); renderMark(); });
        body.appendChild(stop);
      }
      const file = document.createElement("button");
      file.type = "button";
      file.className = "ghost";
      file.textContent = "Скачать Excel";
      file.addEventListener("click", () => {
        const a = document.createElement("a");
          a.href = "/runtime/desk-keys.xlsx";
          a.download = "клавиши.xlsx";
        a.click();
      });
      body.appendChild(file);
      if (activeNav === "site") {
        const seen = [];
        (keyPlan || []).forEach((k) => {
          const room = String(k && k.room || "").trim();
          if (!room || seen.some((name) => sameRoom(name, room))) return;
          seen.push(room);
        });
        seen.forEach((room) => {
          const zone = document.createElement("button");
          zone.type = "button";
          zone.className = "ghost";
          zone.textContent = "Записать зону · " + room;
          zone.addEventListener("click", () => pourZone(room, zone));
          body.appendChild(zone);
        });
      }
      body.appendChild(keyTable());
    }
    function postWalk(body) {
      fetch("/runtime/desk-key-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
        .then((r) => r.json())
        .then((j) => {
          if (!j || !j.ok) {
            keyPlanNote = j && j.error === "need_room" ? "Выберите название комнаты." : "Не сохранил.";
            renderMark();
          return;
        }
          walkSite = j.site || walkSite;
          walkRooms = Array.isArray(j.roomBook) ? j.roomBook : walkRooms;
          if (j.room) walkRoomOpen = false;
          keyPlanNote = "";
          renderMark();
        })
        .catch(() => {
          keyPlanNote = "Щит не ответил. Попробуйте ещё раз.";
          renderMark();
        });
    }
    function roomAddCard() {
      const card = document.createElement("div");
      card.className = "key-plan-add glass";
      const floorSel = document.createElement("select");
      floorSel.className = "bind";
      floorSel.setAttribute("aria-label", "Этаж");
      const floors = walkSite.kind === "house" ? walkSite.floors : 1;
      for (let n = 1; n <= floors; n += 1) {
        const opt = document.createElement("option");
        opt.value = String(n);
        opt.textContent = n + " этаж";
        floorSel.appendChild(opt);
      }
      if (walkRooms.length) floorSel.value = String(walkRooms[walkRooms.length - 1].floor || 1);
      const nameSel = document.createElement("select");
      nameSel.className = "bind";
      nameSel.setAttribute("aria-label", "Комната");
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "Название";
      nameSel.appendChild(blank);
      (walkCatalog || []).forEach((group) => {
        const og = document.createElement("optgroup");
        og.label = group.group;
        (group.names || []).forEach((name) => {
          const opt = document.createElement("option");
          opt.value = name;
          opt.textContent = name;
          og.appendChild(opt);
        });
        nameSel.appendChild(og);
      });
      const other = document.createElement("option");
      other.value = "__other";
      other.textContent = "Другое";
      nameSel.appendChild(other);
      const custom = document.createElement("input");
      custom.className = "bind";
      custom.placeholder = "Своё название";
      custom.hidden = true;
      nameSel.addEventListener("change", () => { custom.hidden = nameSel.value !== "__other"; });
      const save = document.createElement("button");
      save.type = "button";
      save.className = "ghost key-add-all";
      save.textContent = "Добавить";
      save.addEventListener("click", () => {
        const name = nameSel.value === "__other" ? custom.value : nameSel.value;
        postWalk({ addRoom: { floor: Number(floorSel.value) || 1, name } });
      });
      if (walkSite.kind === "house") card.appendChild(floorSel);
      card.append(nameSel, custom, save);
      return card;
    }
    function keyField(label, value, aria) {
      const wrap = document.createElement("label");
      wrap.className = "meta";
      wrap.textContent = label;
      const input = document.createElement("input");
      input.className = "bind";
      input.value = value || "";
      input.setAttribute("aria-label", aria || label);
      wrap.appendChild(input);
      return { wrap, input };
    }
    function closeKeyCard(ignoreKey) {
      keyCatch = null;
      siteBeaconOn = false;
      stopLineBeacon();
      if (activeNav === "site") startKeyScan(null, { ignoreKey });
      else renderMark();
    }
    function solutionForKey(key) {
      if (!key || !key.deviceTopicKey || !key.controlId) return null;
      return (deskSolutions || []).find((s) =>
        s && s.solutionId === "light_button_toggle" && s.trigger
        && s.trigger.deviceTopicKey === key.deviceTopicKey
        && String(s.trigger.controlId || "") === String(key.controlId || ""),
      ) || null;
    }
    function rememberSiteLoads(key) {
      const id = key && key.id ? key.id : "";
      if (siteLoadsKey === id) return;
      siteLoadsKey = id;
      const sol = solutionForKey(key);
      siteLoads = sol && Array.isArray(sol.targets)
        ? sol.targets.map((t) => ({ deviceTopicKey: t.deviceTopicKey, controlId: t.controlId }))
        : [];
    }
    function zoneIdsForRoom(room) {
      const wantRoom = String(room || "").trim().toLowerCase();
      if (!wantRoom) return [];
      const want = new Set();
      (keyPlan || []).forEach((k) => {
        if (String(k && k.room || "").trim().toLowerCase() !== wantRoom) return;
        if (k.deviceTopicKey && k.controlId) want.add(k.deviceTopicKey + "\0" + k.controlId);
      });
      const ids = [];
      (deskSolutions || []).forEach((s) => {
        if (!s || s.solutionId !== "light_button_toggle" || !s.trigger || !s.id) return;
        const key = s.trigger.deviceTopicKey + "\0" + s.trigger.controlId;
        if (want.has(key)) ids.push(String(s.id));
      });
      return ids;
    }
    function pourZone(room, btn) {
      const ids = zoneIdsForRoom(room);
      if (!ids.length) {
        keyPlanNote = "У комнаты ещё нет типового со светом.";
        const status = document.querySelector("#mark-body .key-scan-status");
        if (status) status.textContent = keyPlanNote;
        return;
      }
      runDeskPour("rules", btn, ids, (j) => {
        if (j && j.ok && !(j.disk && j.disk.ok === false)) {
          keyPlanNote = "Зона записана. Проверьте клавишей на стене.";
        } else {
          keyPlanNote = "Зона не записалась.";
        }
        const status = document.querySelector("#mark-body .key-scan-status");
        if (status) status.textContent = keyPlanNote;
      });
    }
    function saveKeyTypical(key, loads) {
      const targets = (loads || []).filter((t) => t && t.deviceTopicKey && t.controlId);
      if (!key || !targets.length) return Promise.resolve({ ok: false, error: "need_target" });
      const prev = solutionForKey(key);
      return fetch("/runtime/desk-solutions", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: prev ? prev.id : "",
          solutionId: "light_button_toggle",
          trigger: { deviceTopicKey: key.deviceTopicKey, controlId: key.controlId },
          targets: targets,
        }),
      }).then((r) => r.json()).then((j) => {
        if (j && j.ok && Array.isArray(j.solutions)) deskSolutions = j.solutions;
        return j;
      });
    }
    function busLoads() {
      const rows = [];
      (lastShelvesRows || []).forEach((s) => {
        (s.channels || []).forEach((c) => {
          if (c && isDeskLoad(c.controlId)) {
            rows.push({
              deviceTopicKey: s.deviceTopicKey,
              controlId: c.controlId,
              name: c.name || "",
            });
          }
        });
      });
      return rows;
    }
    function assignCard(existing) {
      const row = existing || {};
      rememberSiteLoads(row.deviceTopicKey ? row : Object.assign({}, keyCatch, row));
      const card = document.createElement("div");
      card.className = "key-plan-add glass";
      const topic = document.createElement("p");
      topic.className = "meta";
      topic.textContent = shelfLabel(keyCatch.deviceTopicKey) + " · " + prettyControlId(keyCatch.controlId);
      const room = keyField("Помещение", row.room, "Помещение");
      const code = keyField("Код", row.code, "Код помещения");
      const pair = document.createElement("div");
      pair.className = "key-pair";
      const count = keyField("Клавиш в ряду", row.rowCount ? String(row.rowCount) : "", "Клавиш в ряду");
      count.input.inputMode = "numeric";
      const index = keyField("Какая слева", row.keyIndex ? String(row.keyIndex) : "", "Номер слева направо");
      index.input.inputMode = "numeric";
      pair.append(count.wrap, index.wrap);
      const where = keyField("Где", row.note, "Где на стене");
      where.input.placeholder = "Подрозетник, изголовье, проходной";
      const kinds = ["Основной", "Бра", "Контур"];
      let picked = kinds.indexOf(row.label) >= 0 ? row.label : "";
      const purpose = document.createElement("div");
      purpose.className = "purpose";
      const custom = document.createElement("input");
      custom.className = "bind";
      custom.placeholder = "Своё, если не из трёх";
      custom.setAttribute("aria-label", "За что клавиша");
      if (row.label && !picked) custom.value = row.label;
      const chips = kinds.map((name) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "mod-pill" + (picked === name ? " on" : "");
        btn.textContent = name;
        btn.addEventListener("click", () => {
          picked = picked === name ? "" : name;
          if (picked) custom.value = "";
          chips.forEach((chip) => chip.classList.toggle("on", chip.textContent === picked));
        });
        purpose.appendChild(btn);
        return btn;
      });
      custom.addEventListener("input", () => {
        if (custom.value.trim()) {
          picked = "";
          chips.forEach((chip) => chip.classList.remove("on"));
        }
      });
      const act = document.createElement("div");
      act.className = "key-plan-actions";
      const save = document.createElement("button");
      save.type = "button";
      save.className = "ghost key-add-all";
      save.textContent = "Записать";
      save.addEventListener("click", () => {
        const label = picked || custom.value.trim();
        const roomName = room.input.value.trim();
        if (!roomName || !label) {
          keyPlanNote = "Напишите помещение и за что клавиша.";
          const status = document.querySelector("#mark-body .key-scan-status");
          if (status) status.textContent = keyPlanNote;
          return;
        }
        const id = (existing && existing.id) || (keyCatch && keyCatch.id);
        if (!id) return;
        const ignoreKey = keyCatch && keyCatch.ignoreKey;
        fetch("/runtime/desk-key-plan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            patch: true,
            id,
            room: roomName,
            code: code.input.value.trim(),
            note: where.input.value.trim(),
            label,
            rowCount: count.input.value.trim(),
            keyIndex: index.input.value.trim(),
          }),
        })
          .then((r) => r.json())
          .then((res) => {
            if (res && res.ok) {
              keyPlan = res.keyPlan || keyPlan;
              const saved = res.key || {};
              paintCaughtOnShelf(
                keyCatch,
                (saved.code ? saved.code + " " : "") + (saved.room || roomName) + " · " + (saved.label || label),
              );
              keyPlanNote = "";
              closeKeyCard(ignoreKey);
              return;
            }
            keyPlanNote = "Клавиша не записалась.";
            renderMark();
          })
          .catch(() => {
            keyPlanNote = "Щит не ответил.";
            renderMark();
          });
      });
      const skip = document.createElement("button");
      skip.type = "button";
      skip.className = "ghost";
      skip.textContent = "Ещё раз";
      skip.addEventListener("click", () => {
        const ignoreKey = keyCatch && keyCatch.ignoreKey;
        const fresh = keyCatch && keyCatch.fresh;
        const id = keyCatch && keyCatch.id;
        keyCatch = null;
        if (fresh && id) {
          fetch("/runtime/desk-key-plan", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ delete: id }),
          })
            .then((r) => r.json())
            .then((j) => {
              if (j && j.ok) keyPlan = j.keyPlan || [];
              closeKeyCard(ignoreKey);
            })
            .catch(() => closeKeyCard(ignoreKey));
          return;
        }
        closeKeyCard(ignoreKey);
      });
      const lightHead = document.createElement("p");
      lightHead.className = "meta";
      lightHead.textContent = siteLoads.length ? "Свет · " + siteLoads.length : "Свет";
      const lightList = document.createElement("p");
      lightList.className = "meta";
      lightList.textContent = siteLoads.length
        ? siteLoads.map((t) => shelfLabel(t.deviceTopicKey) + " · " + prettyControlId(t.controlId)).join("  ·  ")
        : "Линия ещё не выбрана.";
      const bind = document.createElement("button");
      bind.type = "button";
      bind.className = "ghost key-add-all";
      bind.textContent = "В типовое";
      bind.addEventListener("click", () => {
        const key = row.deviceTopicKey ? row : keyCatch;
        saveKeyTypical(key, siteLoads).then((j) => {
          if (j && j.ok) {
            keyPlanNote = "Типовое записано. На щите его ещё нет.";
            siteLoadsKey = "";
            renderMark();
            return;
          }
          keyPlanNote = j && j.error === "need_target" ? "Сначала выберите свет." : "Типовое не сохранилось.";
          const status = document.querySelector("#mark-body .key-scan-status");
          if (status) status.textContent = keyPlanNote;
        }).catch(() => {
          keyPlanNote = "Щит не ответил.";
          renderMark();
        });
      });
      act.append(save, bind, skip);
      if (activeNav === "site") {
        const find = document.createElement("button");
        find.type = "button";
        find.className = "ghost";
        find.textContent = siteBeaconOn ? "Скрыть свет" : "Найти свет";
        find.addEventListener("click", () => {
          if (siteBeaconOn) {
            siteBeaconOn = false;
            stopLineBeacon();
            renderMark();
            return;
          }
          siteBeaconOn = true;
          lineBeaconLoading = true;
          renderMark();
          fetchBeaconCandidates(true, "all").then((rows) => {
            lineBeaconLoading = false;
            lineBeaconCandidates = rows;
            lineBeaconFamilyLoaded = "all";
            renderMark();
          });
        });
        const zone = document.createElement("button");
        zone.type = "button";
        zone.className = "ghost";
        zone.textContent = "Записать зону";
        zone.addEventListener("click", () => pourZone(room.input.value.trim(), zone));
        act.append(find, zone);
      }
      card.append(topic, room.wrap, code.wrap, pair, where.wrap, purpose, custom, lightHead, lightList);
      if (activeNav === "site" && siteBeaconOn) {
        const dots = document.createElement("div");
        dots.className = "line-beacon-dots";
        if (lineBeaconLoading) {
          const wait = document.createElement("p");
          wait.className = "meta";
          wait.textContent = "Смотрю каналы на щите.";
          card.appendChild(wait);
        }
        (lineBeaconCandidates || []).forEach((ch) => {
          const on = siteLoads.some((t) => t.deviceTopicKey === ch.deviceTopicKey && t.controlId === ch.controlId);
          const circle = document.createElement("button");
          circle.type = "button";
          circle.className = "line-beacon-circle sm" + (on ? " on" : "");
          circle.title = shelfLabel(ch.deviceTopicKey) + " · " + prettyControlId(ch.controlId);
          circle.textContent = beaconDotLabel(ch.controlId);
          circle.addEventListener("click", () => {
            const i = siteLoads.findIndex((t) => t.deviceTopicKey === ch.deviceTopicKey && t.controlId === ch.controlId);
            if (i >= 0) siteLoads.splice(i, 1);
            else siteLoads.push({ deviceTopicKey: ch.deviceTopicKey, controlId: ch.controlId });
            void pickBeaconChannel(ch);
          });
          dots.appendChild(circle);
        });
        card.appendChild(dots);
      }
      if (activeNav === "remote") {
        const pick = document.createElement("select");
        pick.className = "bind";
        pick.setAttribute("aria-label", "Свет с шины");
        const blank = document.createElement("option");
        blank.value = "";
        blank.textContent = "Свет с шины";
        pick.appendChild(blank);
        busLoads().forEach((load) => {
          const opt = document.createElement("option");
          opt.value = load.deviceTopicKey + "\0" + load.controlId;
          opt.textContent = shelfLabel(load.deviceTopicKey) + " · " + prettyControlId(load.controlId)
            + (load.name ? " · " + load.name : "");
          pick.appendChild(opt);
        });
        const take = document.createElement("button");
        take.type = "button";
        take.className = "ghost";
        take.textContent = "Этот свет";
        take.addEventListener("click", () => {
          const parts = String(pick.value || "").split("\0");
          if (!parts[0] || !parts[1]) return;
          if (!siteLoads.some((t) => t.deviceTopicKey === parts[0] && t.controlId === parts[1])) {
            siteLoads.push({ deviceTopicKey: parts[0], controlId: parts[1] });
          }
          renderMark();
        });
        card.append(pick, take);
      }
      card.appendChild(act);
      return card;
    }
    function keyTable() {
      const wrap = document.createElement("div");
      const rows = (keyPlan || []).filter((k) => k && k.deviceTopicKey).slice().sort((a, b) => {
        const c = String(a.code || "999").localeCompare(String(b.code || "999"));
        return c || String(a.controlId || "").localeCompare(String(b.controlId || ""), "ru", { numeric: true });
      });
      if (!rows.length) {
        const empty = document.createElement("p");
        empty.className = "meta orphan";
        empty.textContent = activeNav === "remote"
          ? "Добавьте клавишу из списка шины."
          : "Нажмите «Сканировать». После трёх нажатий откроется карточка этой клавиши.";
        wrap.appendChild(empty);
        return wrap;
      }
      const table = document.createElement("table");
      table.className = "key-table";
      const head = document.createElement("tr");
      ["Помещение", "Код", "Клавиша", "Топик", "Что включает", "Примечание", "Канал", ""].forEach((label) => {
        const th = document.createElement("th");
        th.textContent = label;
        head.appendChild(th);
      });
      table.appendChild(head);
      rows.forEach((k) => {
        const tr = document.createElement("tr");
        const mates = rows.filter((x) => x.deviceTopicKey === k.deviceTopicKey && String(x.code || "") === String(k.code || ""));
        const order = mates.slice().sort((a, b) => String(a.controlId).localeCompare(String(b.controlId), "ru", { numeric: true }));
        const idx = order.findIndex((x) => x.id === k.id) + 1;
        const fallbackPlace = idx + " из " + order.length;
        const put = (name, value, label) => {
          const td = document.createElement("td");
          const input = document.createElement("input");
          input.className = "bind";
          input.value = value;
          input.setAttribute("aria-label", label);
          input.addEventListener("change", () => {
            const body = { patch: true, id: k.id };
            body[name] = input.value;
            fetch("/runtime/desk-key-plan", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            })
              .then((r) => r.json())
              .then((j) => {
                if (j && j.ok) keyPlan = j.keyPlan || keyPlan;
                else keyPlanNote = "Строка не сохранилась.";
              });
          });
          td.appendChild(input);
          return td;
        };
        tr.appendChild(put("room", k.room || "", "Помещение"));
        tr.appendChild(put("code", k.code || "", "Код"));
        const placeCell = document.createElement("td");
        placeCell.textContent = k.place || fallbackPlace;
        tr.appendChild(placeCell);
        const topic = document.createElement("td");
        const open = document.createElement("button");
        open.type = "button";
        open.className = "ghost";
        open.textContent = shelfLabel(k.deviceTopicKey) + " · " + prettyControlId(k.controlId);
        open.title = "Открыть карточку";
        open.addEventListener("click", () => {
          stopKeyScan();
          keyCatch = {
            deviceTopicKey: k.deviceTopicKey,
            controlId: k.controlId,
            id: k.id,
            fresh: false,
          };
          renderMark();
        });
        topic.appendChild(open);
        tr.appendChild(topic);
        tr.appendChild(put("label", k.label || "", "Что включает"));
        tr.appendChild(put("note", k.note || "", "Примечание"));
        tr.appendChild(put("load", k.load || "", "Канал"));
        const act = document.createElement("td");
          const del = document.createElement("button");
          del.type = "button";
          del.className = "ghost";
          del.textContent = "×";
        del.title = "Убрать строку";
          del.addEventListener("click", () => {
            fetch("/runtime/desk-key-plan", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ delete: k.id }),
            })
              .then((r) => r.json())
              .then((j) => {
                if (j && j.ok) {
                  keyPlan = j.keyPlan || [];
                  renderMark();
                }
              });
          });
          act.appendChild(del);
        tr.appendChild(act);
        table.appendChild(tr);
        });
      wrap.appendChild(table);
      return wrap;
    }
    function stopLineBeacon() {
      beaconPick += 1;
      const cur = lineBeacon && lineBeacon.current;
      lineBeacon = null;
      if (cur && cur.deviceTopicKey && cur.controlId) {
        void actuateChannel(cur.deviceTopicKey, cur.controlId, "off");
      }
    }
    async function loadLinePlan() {
      try {
        const r = await fetch("/runtime/desk-line-plan");
        const j = await r.json();
        if (j && j.error === "marking_unreadable") {
          markingUnreadable = true;
          linePlan = [];
        } else {
          if (j && j.ok) markingUnreadable = false;
        linePlan = Array.isArray(j.linePlan) ? j.linePlan : [];
        }
      } catch {
        linePlan = [];
      }
    }
    function nextLineLabelForRoom(room) {
      const n = linePlan.filter((k) => k.room === room).length + 1;
      return "линия " + n;
    }
    function postLinePlanLabels(room, labelsText, done) {
      const roomName = String(room || "").trim();
      const text = String(labelsText || "").trim();
      if (!roomName || !text) return;
      fetch("/runtime/desk-line-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ room: roomName, labelsText: text }),
      })
        .then((r) => r.json())
        .then((j) => {
          if (j && j.ok) {
            linePlan = j.linePlan || [];
            lineRoomFilter = roomName;
            linePlanFocus = true;
            linePlanNote = j.dropped
              ? ("Не влезло " + j.dropped + " из " + j.added + ". План держит " + j.cap + " линий.")
              : (j.duplicates ? ("Уже были в этой комнате: " + j.duplicates + ".") : "");
            if (typeof done === "function") done(j);
            renderMark();
          }
        });
    }
    async function fetchBeaconCandidates(includeNamed, family) {
      try {
        const r = await fetch("/runtime/desk-line-plan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            candidates: true,
            shelves: lastShelvesRows || [],
            includeNamed: includeNamed === true,
            family: family || lineBeaconFamily || "all",
          }),
        });
        const j = await r.json();
        return Array.isArray(j.candidates) ? j.candidates : [];
      } catch {
        return [];
      }
    }
    function lightPurposeGroups(kind) {
      const picked = kind === "relay" ? walkLightPurposes.relay : walkLightPurposes.led;
      if (picked && picked.length) return picked;
      if (kind === "relay") {
        return [{ group: "Свет", names: ["Основное освещение", "Люстра", "Бра", "Подвес", "Точечные", "Треки", "Ночник", "Рабочий свет", "Свет у зеркала", "Дежурный свет", "Свет в шкафу", "Уличный свет"] }];
      }
      return [
        { group: "Подсветка", names: ["Светодиодная лента", "Световая линия", "Подсветка плинтуса", "Подсветка штор", "Подсветка ниш", "Подсветка ТВ-зоны", "Подсветка потолка", "Подсветка пола", "Подсветка лестницы", "Подсветка полок", "Подсветка зеркала", "Подсветка карниза", "Контурный свет", "Парящий потолок"] },
        { group: "Подсветка уличная", names: ["Подсветка фасада", "Подсветка дорожки", "Подсветка крыльца", "Подсветка участка", "Подсветка террасы", "Подсветка забора", "Контур дома"] },
      ];
    }
    function lightPurposeNames(kind) {
      const names = [];
      lightPurposeGroups(kind).forEach((group) => {
        (group.names || []).forEach((name) => { if (names.indexOf(name) < 0) names.push(name); });
      });
      return names;
    }
    function matchLightPurpose(label, kind) {
      const names = lightPurposeNames(kind);
      const text = String(label || "").trim();
      if (names.indexOf(text) >= 0) return text;
      const base = text.replace(/\s+\d+$/, "");
      if (names.indexOf(base) >= 0) return base;
      if ((base === "Основной свет" || text === "Основной свет") && names.indexOf("Основное освещение") >= 0) {
        return "Основное освещение";
      }
      return "";
    }
    function beaconDotLabel(controlId) {
      const ch = /^Channel\s+(\d+)$/i.exec(String(controlId || "").trim());
      return ch ? ch[1] : String(controlId || "");
    }
    function beaconLineFor(ch) {
      return (linePlan || []).find((k) => k && k.deviceTopicKey === ch.deviceTopicKey && k.controlId === ch.controlId) || null;
    }
    async function loadBeaconCandidates() {
      const fam = lineBeaconFamily;
      lineBeaconLoading = true;
      const rows = await fetchBeaconCandidates(true, fam);
      if (fam !== lineBeaconFamily) return;
      lineBeaconLoading = false;
      lineBeaconCandidates = rows;
      lineBeaconFamilyLoaded = fam;
        renderMark();
    }
    async function pickBeaconChannel(ch) {
      if (!ch || !ch.deviceTopicKey || !ch.controlId) return;
      const ticket = ++beaconPick;
      const prev = lineBeacon && lineBeacon.current;
      const same = prev && prev.deviceTopicKey === ch.deviceTopicKey && prev.controlId === ch.controlId;
      lineBeacon = { current: prev || null, busy: true };
      renderMark();
      try {
        if (prev) {
          try { await actuateChannel(prev.deviceTopicKey, prev.controlId, "off"); } catch (_) { /* */ }
          if (!same && prev.kind === "led") await new Promise((r) => setTimeout(r, 350));
        }
        if (ticket !== beaconPick) return;
        if (same) {
          lineBeacon = { current: null, busy: false };
        return;
      }
      lineBeacon = {
          current: { deviceTopicKey: ch.deviceTopicKey, controlId: ch.controlId, kind: ch.kind || "led" },
        busy: false,
      };
        try { await actuateChannel(ch.deviceTopicKey, ch.controlId, "on"); } catch (_) { /* */ }
      } finally {
        if (ticket === beaconPick && lineBeacon) lineBeacon.busy = false;
        if (ticket === beaconPick) renderMark();
      }
    }
    function saveLitLine(room, purpose) {
      const cur = lineBeacon && lineBeacon.current;
      const label = String(purpose || "").trim();
      if (!cur || !room || !room.name || !label) return;
      fetch("/runtime/desk-line-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mark: true,
          room: room.name,
          code: room.code || "",
          floor: room.floor || 1,
          label,
          deviceTopicKey: cur.deviceTopicKey,
          controlId: cur.controlId,
        }),
      })
        .then((r) => r.json())
        .then((res) => {
          if (!res || !res.ok) {
            linePlanNote = "Не сохранил.";
            renderMark();
            return;
          }
          linePlan = res.linePlan || linePlan;
          const saved = res.line || {};
          const markName = (saved.code ? saved.code + " " : "") + (saved.room || room.name) + " · " + (saved.label || label);
            lastShelvesRows = (lastShelvesRows || []).map((s) => {
              if (!s || s.deviceTopicKey !== cur.deviceTopicKey) return s;
              return {
                ...s,
                channels: (s.channels || []).map((c) =>
                c && c.controlId === cur.controlId ? { ...c, name: markName, source: "desk" } : c,
                ),
              };
            });
          lineBeaconCandidates = (lineBeaconCandidates || []).map((c) =>
            c && c.deviceTopicKey === cur.deviceTopicKey && c.controlId === cur.controlId
              ? { ...c, name: markName }
              : c,
          );
          linePlanNote = "";
          stopLineBeacon();
          renderMark();
        })
        .catch(() => renderMark());
    }
    function renderLineBeaconPanel(body) {
      body.replaceChildren();
      const intro = document.createElement("p");
      intro.className = "meta";
      intro.textContent = "Контур — выход без имени. Зелёный — уже назван. Кольцо — сейчас горит.";
      body.appendChild(intro);
      const fam = document.createElement("div");
      fam.className = "filters line-beacon-fam";
      fam.setAttribute("role", "tablist");
      fam.setAttribute("aria-label", "Тип линий маяка");
      [
        { id: "dim", t: "Диммеры" },
        { id: "led", t: "WB-LED" },
        { id: "dali", t: "DALI" },
        { id: "mdm", t: "MDM3" },
        { id: "mr", t: "WB-MR" },
      ].forEach((opt) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = opt.t;
        b.setAttribute("aria-pressed", lineBeaconFamily === opt.id ? "true" : "false");
        b.addEventListener("click", () => {
          if (lineBeaconFamily === opt.id) return;
          lineBeaconFamily = opt.id;
          lineBeaconFamilyLoaded = "";
          if (lineBeacon && lineBeacon.current) stopLineBeacon();
            renderMark();
        });
        fam.appendChild(b);
      });
      body.appendChild(fam);
      const status = document.createElement("p");
      status.className = "meta key-scan-status";
      const lit = lineBeacon && lineBeacon.current;
      const markedN = (lineBeaconCandidates || []).filter((ch) => beaconLineFor(ch) || ch.name).length;
      if (lit) {
        const row = beaconLineFor(lit);
        status.textContent = "Горит "
          + shelfLabel(lit.deviceTopicKey) + " · " + prettyControlId(lit.controlId)
          + (row ? " · " + (row.code ? row.code + " " : "") + row.room + " · " + row.label : "")
          + ". Другой кружок переключит свет. Тот же кружок погасит.";
        status.classList.add("live");
      } else if (lineBeaconLoading || lineBeaconFamilyLoaded !== lineBeaconFamily) {
        status.textContent = "Смотрю каналы на щите.";
        if (!lineBeaconLoading) void loadBeaconCandidates();
      } else {
        const silentN = (lineBeaconCandidates || []).filter((ch) => ch.silent).length;
        status.textContent = (linePlanNote ? linePlanNote + " " : "")
          + "Названо " + markedN + " из " + (lineBeaconCandidates || []).length
          + (silentN ? ". Пунктир — шина этот выход не прислала" : "");
      }
      body.appendChild(status);
      const groups = new Map();
      (lineBeaconCandidates || []).forEach((ch) => {
        if (!ch || !ch.deviceTopicKey) return;
        if (!groups.has(ch.deviceTopicKey)) groups.set(ch.deviceTopicKey, []);
        groups.get(ch.deviceTopicKey).push(ch);
      });
      const grid = document.createElement("div");
      grid.className = "line-beacon-grid";
      [...groups.keys()].sort((a, b) => shelfLabel(a).localeCompare(shelfLabel(b), "ru", { numeric: true })).forEach((dk) => {
        const block = document.createElement("div");
        block.className = "line-beacon-mod";
        const list = groups.get(dk).slice().sort((a, b) => String(a.controlId).localeCompare(String(b.controlId), "ru", { numeric: true }));
        const namedHere = list.filter((ch) => beaconLineFor(ch) || ch.name).length;
        const ttl = document.createElement("p");
        ttl.className = "meta";
        ttl.textContent = shelfLabel(dk) + " · " + namedHere + " из " + list.length;
        const dots = document.createElement("div");
        dots.className = "line-beacon-dots";
        list.forEach((ch) => {
          const on = lit && lit.deviceTopicKey === ch.deviceTopicKey && lit.controlId === ch.controlId;
          const row = beaconLineFor(ch);
        const circle = document.createElement("button");
        circle.type = "button";
          circle.className = "line-beacon-circle sm" + (on ? " on" : "") + (row || ch.name ? " marked" : "") + (ch.silent ? " silent" : "");
          circle.title = ch.silent
            ? "Шина этот канал не прислала. Нажатие всё равно пробует включить"
            : (on ? "Погасить" : "Зажечь только этот канал");
          const shown = row
            ? (matchLightPurpose(row.label, ch.kind || "led") || row.label)
            : "";
          const cap = row
            ? ((row.code ? row.code + " " : "") + shown)
            : (ch.name || "");
          circle.innerHTML = "<span></span><span class=\"cap\"></span>";
          circle.querySelector("span").textContent = beaconDotLabel(ch.controlId);
          circle.querySelector(".cap").textContent = cap;
          circle.addEventListener("click", () => { void pickBeaconChannel(ch); });
          dots.appendChild(circle);
        });
        block.append(ttl, dots);
        grid.appendChild(block);
      });
      body.appendChild(grid);
      if (lit) {
        const live = document.createElement("div");
        live.className = "key-plan-add glass";
        const topic = document.createElement("p");
        topic.className = "meta";
        topic.textContent = "Горит · " + shelfLabel(lit.deviceTopicKey) + " · " + prettyControlId(lit.controlId);
        const off = document.createElement("button");
        off.type = "button";
        off.className = "ghost";
        off.textContent = "Погасить";
        off.addEventListener("click", () => { stopLineBeacon(); renderMark(); });
        live.append(topic, off);
        body.appendChild(live);
      }
      const addBox = document.createElement("div");
      addBox.className = "key-plan-add glass";
      const existing = lit ? beaconLineFor(lit) : null;
      const roomSel = document.createElement("select");
      roomSel.className = "bind";
      roomSel.setAttribute("aria-label", "Комната");
      const roomBlank = document.createElement("option");
      roomBlank.value = "";
      roomBlank.textContent = "Комната";
      roomSel.appendChild(roomBlank);
      const knownNames = new Set();
      (walkRooms || []).slice().sort((a, b) => String(a.code).localeCompare(String(b.code))).forEach((room) => {
        knownNames.add(String(room.name || "").toLowerCase());
        const opt = document.createElement("option");
        opt.value = "code:" + room.code;
        opt.textContent = room.code + " · " + room.name;
        roomSel.appendChild(opt);
      });
      [...new Set((linePlan || []).map((k) => k.room).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru")).forEach((name) => {
        if (knownNames.has(String(name).toLowerCase())) return;
        knownNames.add(String(name).toLowerCase());
        const opt = document.createElement("option");
        opt.value = "room:" + name;
        opt.textContent = name;
        roomSel.appendChild(opt);
      });
      const catalog = (walkCatalog || []).length
        ? walkCatalog
        : [{ group: "Комнаты", names: ["Спальня", "Кухня", "Гостиная", "Детская", "Ванная", "Прихожая", "Коридор", "Кабинет"] }];
      catalog.forEach((group) => {
        const names = (group.names || []).filter((name) => !knownNames.has(String(name).toLowerCase()));
        if (!names.length) return;
        const og = document.createElement("optgroup");
        og.label = group.group || "Комната";
        names.forEach((name) => {
          const opt = document.createElement("option");
          opt.value = "new:" + name;
          opt.textContent = name;
          og.appendChild(opt);
        });
        roomSel.appendChild(og);
      });
      if (existing && existing.code && [...roomSel.options].some((o) => o.value === "code:" + existing.code)) {
        roomSel.value = "code:" + existing.code;
      } else if (existing && existing.room) {
        const byCode = (walkRooms || []).find((r) => r.name === existing.room);
        const plain = "room:" + existing.room;
        roomSel.value = byCode ? "code:" + byCode.code : ([...roomSel.options].some((o) => o.value === plain) ? plain : "");
      }
      const lightKind = (lit && lit.kind === "relay") || lineBeaconFamily === "mr" || lineBeaconFamily === "relay"
        ? "relay"
        : "led";
      const purposeSel = document.createElement("select");
      purposeSel.className = "bind";
      purposeSel.setAttribute("aria-label", "Что за свет");
      const purposeBlank = document.createElement("option");
      purposeBlank.value = "";
      purposeBlank.textContent = lightKind === "relay" ? "Свет" : "Подсветка";
      purposeSel.appendChild(purposeBlank);
      lightPurposeGroups(lightKind).forEach((group) => {
        const og = document.createElement("optgroup");
        og.label = group.group || "Свет";
        (group.names || []).forEach((name) => {
          const opt = document.createElement("option");
          opt.value = name;
          opt.textContent = name;
          og.appendChild(opt);
        });
        purposeSel.appendChild(og);
      });
      const other = document.createElement("option");
      other.value = "__other";
      other.textContent = "Другое";
      purposeSel.appendChild(other);
      const matchedPurpose = existing ? matchLightPurpose(existing.label, lightKind) : "";
      if (matchedPurpose) purposeSel.value = matchedPurpose;
      else if (existing && existing.label) purposeSel.value = "__other";
      const custom = document.createElement("input");
      custom.className = "bind";
      custom.placeholder = "Своё название света";
      custom.hidden = purposeSel.value !== "__other";
      if (existing && existing.label && purposeSel.value === "__other") custom.value = existing.label;
      purposeSel.addEventListener("change", () => { custom.hidden = purposeSel.value !== "__other"; });
      const act = document.createElement("div");
      act.className = "key-plan-actions";
      const save = document.createElement("button");
      save.type = "button";
      save.className = "ghost key-add-all";
      save.textContent = "Зафиксировать";
      save.disabled = !lit;
      save.addEventListener("click", () => {
        if (!lit) return;
        const purpose = purposeSel.value === "__other" ? custom.value : purposeSel.value;
        const pick = roomSel.value;
        if (!pick || !purpose) return;
        if (pick.indexOf("code:") === 0) {
          const room = (walkRooms || []).find((r) => r.code === pick.slice(5));
          if (room) saveLitLine(room, purpose);
          return;
        }
        if (pick.indexOf("room:") === 0) {
          saveLitLine({ name: pick.slice(5) }, purpose);
          return;
        }
        if (pick.indexOf("new:") === 0) {
          const name = pick.slice(4);
          const addRoom = () => {
            fetch("/runtime/desk-key-plan", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ addRoom: { floor: 1, name } }),
            })
              .then((r) => r.json())
              .then((j) => {
                if (!j || !j.ok || !j.room) {
                  linePlanNote = "Не сохранил комнату.";
                  renderMark();
                  return;
                }
                walkSite = j.site || walkSite;
                walkRooms = Array.isArray(j.roomBook) ? j.roomBook : walkRooms;
                saveLitLine(j.room, purpose);
              })
              .catch(() => renderMark());
          };
          if (walkSite && walkSite.kind) addRoom();
          else {
            fetch("/runtime/desk-key-plan", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ site: { kind: "flat", floors: 1 } }),
            })
              .then((r) => r.json())
              .then((j) => {
                if (j && j.ok) walkSite = j.site || { kind: "flat", floors: 1 };
                addRoom();
              })
              .catch(() => renderMark());
          }
        }
      });
      act.appendChild(save);
      if (!lit) {
        const hint = document.createElement("p");
        hint.className = "meta";
        hint.textContent = "Нажмите кружок. Здесь выберете комнату и что за свет.";
        addBox.append(hint, roomSel, purposeSel, custom, act);
      } else {
        addBox.append(roomSel, purposeSel, custom, act);
      }
      body.appendChild(addBox);
      const rooms = [...new Set(linePlan.map((k) => k.room))].sort((a, b) => a.localeCompare(b, "ru"));
      if (!rooms.length) {
        const empty = document.createElement("p");
        empty.className = "meta orphan";
        empty.textContent = "Пока пусто. Нажмите кружок и выберите комнату и свет.";
        body.appendChild(empty);
        return;
      }
      rooms.forEach((room) => {
        const det = document.createElement("details");
        det.className = "key-room";
        det.open = !lineRoomFilter || lineRoomFilter === room;
        const sum = document.createElement("summary");
        const lines = linePlan.filter((k) => k.room === room);
        const bound = lines.filter((k) => k.deviceTopicKey).length;
        const head = document.createElement("span");
        head.className = "key-room-title";
        head.textContent = room + " · " + bound + "/" + lines.length;
        sum.appendChild(head);
        det.appendChild(sum);
        const list = document.createElement("ol");
        list.className = "key-list";
        lines.forEach((k, i) => {
          const li = document.createElement("li");
          const litRow = lineBeacon && lineBeacon.current
            && lineBeacon.current.deviceTopicKey === k.deviceTopicKey
            && lineBeacon.current.controlId === k.controlId;
          li.className = "key-row" + (k.deviceTopicKey ? " bound" : "") + (litRow ? " armed" : "");
          const num = document.createElement("span");
          num.className = "key-num";
          num.textContent = String(i + 1);
          const mid = document.createElement("div");
          mid.className = "key-mid";
          const ttl = document.createElement("strong");
          ttl.textContent = k.label;
          const sub = document.createElement("span");
          sub.className = "meta";
          sub.textContent = k.deviceTopicKey
            ? "/devices/" + k.deviceTopicKey + "/controls/" + k.controlId
            : "не привязана";
          mid.append(ttl, sub);
          const act = document.createElement("div");
          act.className = "key-act";
          if (k.deviceTopicKey && k.controlId) {
            const light = document.createElement("button");
            light.type = "button";
            light.className = "ghost key-scan-btn";
            light.textContent = litRow ? "Погасить" : "Зажечь";
            light.addEventListener("click", () => { void pickBeaconChannel(k); });
            act.appendChild(light);
          }
          const del = document.createElement("button");
          del.type = "button";
          del.className = "ghost";
          del.textContent = "×";
          del.addEventListener("click", () => {
            fetch("/runtime/desk-line-plan", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ delete: k.id }),
            })
              .then((r) => r.json())
              .then((j) => {
                if (j && j.ok) {
                  linePlan = j.linePlan || [];
                  if (lineBeacon && lineBeacon.current && lineBeacon.current.deviceTopicKey === k.deviceTopicKey && lineBeacon.current.controlId === k.controlId) stopLineBeacon();
                  renderMark();
                }
              });
          });
          act.appendChild(del);
          li.append(num, mid, act);
          list.appendChild(li);
        });
        det.appendChild(list);
        body.appendChild(det);
      });
    }
    function stopPairListen() {
      if (pairListen && pairListen.timer) clearInterval(pairListen.timer);
      pairListen = null;
    }
    function namedInputLabel(deviceTopicKey, controlId) {
      const s = (lastShelvesRows || []).find((x) => x.deviceTopicKey === deviceTopicKey);
      if (!s) return "";
      const ch = (s.channels || []).find((c) => c.controlId === controlId);
      return ch ? String(ch.name || "").trim() : "";
    }
    function pairPulseForTrigger(deviceTopicKey, controlId, buttonName) {
      const seen = new Set();
      const loads = [];
      const add = (dk, cid, src) => {
        if (!dk || !cid || !isDeskLoad(cid)) return;
        const k = contactKey(dk, cid);
        if (seen.has(k)) return;
        seen.add(k);
        loads.push({ deviceTopicKey: dk, controlId: cid, src });
      };
      // 1) Типовые на столе с этой кнопкой.
      deskSolutions.forEach((sol) => {
        const t = sol && sol.trigger;
        if (!t || t.deviceTopicKey !== deviceTopicKey) return;
        const base = String(t.controlId || "").replace(/\s+(?:Single|Shortlong|Short|Long|Double) Press Counter$/i, "").trim();
        if (base !== controlId && t.controlId !== controlId) return;
        (sol.targets || []).forEach((x) => {
          if (x) add(x.deviceTopicKey, x.controlId, "tip");
        });
      });
      // 2) Все подписанные нагрузки той же комнаты (скан клавиш / маяк) — даже без типовой.
      const room = nameRoom(buttonName);
      if (room) {
        (lastShelvesRows || []).forEach((s) => {
          (s.channels || []).forEach((ch) => {
            if (!isDeskLoad(ch.controlId)) return;
            const nm = String(ch.name || "").trim();
            if (!nm || nameRoom(nm) !== room) return;
            add(s.deviceTopicKey, ch.controlId, "room");
          });
        });
        (linePlan || []).forEach((ln) => {
          if (prettyRoom(ln.room) !== room || !ln.deviceTopicKey || !ln.controlId) return;
          add(ln.deviceTopicKey, ln.controlId, "plan");
        });
      }
      const pulseCap = 64;
      const shown = loads.slice(0, pulseCap);
      shown.forEach((x) => {
        void actuateChannel(x.deviceTopicKey, x.controlId, "pulse");
      });
      return {
        count: shown.length,
        total: loads.length,
        fromTip: loads.filter((x) => x.src === "tip").length,
        fromRoom: loads.filter((x) => x.src !== "tip").length,
      };
    }
    function startPairListen() {
      stopPairListen();
      stopKeyScan();
      stopLineBeacon();
      if (!linePlan.length) void loadLinePlan();
      pairListen = {
        timer: 0,
        baseline: pressSignalMap(lastShelvesRows),
        prevClosed: new Map(),
        last: null,
      };
      pressSignalMap(lastShelvesRows).forEach((sig, k) => {
        if (sig.kind === "level") pairListen.prevClosed.set(k, Boolean(sig.closed));
      });
      const tick = () => {
        if (!pairListen || pairBusy) return;
        pairBusy = true;
        fetch("/runtime/mqtt-scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ instant: true, inputsOnly: true }),
        })
          .then((r) => r.json())
          .then((j) => {
            if (!pairListen || !j || !j.ok || !Array.isArray(j.shelves)) return;
            lastShelvesRows = paintLiveValues(lastShelvesRows, j.shelves);
            const rises = pressRises(pairListen, pressSignalMap(lastShelvesRows));
            if (rises.length !== 1 || rises[0].jump) return;
            const sig = rises[0].sig;
            const name = namedInputLabel(sig.deviceTopicKey, sig.controlId);
            if (!name) return;
            const pulsed = pairPulseForTrigger(sig.deviceTopicKey, sig.controlId, name);
            pairListen.last = {
              name,
              deviceTopicKey: sig.deviceTopicKey,
              controlId: sig.controlId,
              pulsed,
              at: Date.now(),
            };
            renderMark();
          })
          .catch(() => {})
          .finally(() => { pairBusy = false; });
      };
      pairListen.timer = setInterval(tick, 280);
      tick();
    }
    function renderPairVerifyPanel(body) {
      body.replaceChildren();
      if (!pairListen) startPairListen();
      const intro = document.createElement("p");
      intro.className = "meta";
      intro.textContent = "Нажмите кнопку — стол покажет имя и мигнёт все подписанные линии этой комнаты (и типовые, если есть).";
      body.appendChild(intro);
      const status = document.createElement("p");
      status.className = "meta key-scan-status live";
      status.textContent = "Слушаю Short Press на размеченных входах…";
      body.appendChild(status);
      const hit = document.createElement("div");
      hit.className = "pair-hit glass";
      if (pairListen && pairListen.last) {
        const L = pairListen.last;
        const strong = document.createElement("strong");
        strong.textContent = L.name;
        const sub = document.createElement("p");
        sub.className = "meta";
        const p = L.pulsed && typeof L.pulsed === "object" ? L.pulsed : { count: Number(L.pulsed) || 0 };
        sub.textContent = L.deviceTopicKey + "/" + L.controlId
          + (p.count
            ? (" · импульс " + p.count + (p.total > p.count ? (" из " + p.total) : "")
              + (p.fromRoom ? (" · комната " + p.fromRoom) : "")
              + (p.fromTip ? (" · типовые " + p.fromTip) : ""))
            : " · нет линий комнаты с именем — разметьте свет маяком");
        hit.append(strong, sub);
      } else {
        const wait = document.createElement("p");
        wait.className = "meta";
        wait.textContent = "Жду нажатие…";
        hit.appendChild(wait);
      }
      body.appendChild(hit);
      const named = [];
      (lastShelvesRows || []).forEach((s) => {
        visibleChannels(s).forEach((ch) => {
          if (!isDeskInput(ch.controlId, s.deviceTopicKey)) return;
          const name = String(ch.name || "").trim();
          if (!name) return;
          named.push({ deviceTopicKey: s.deviceTopicKey, controlId: ch.controlId, name });
        });
      });
      const list = document.createElement("ul");
      list.className = "pair-named";
      if (!named.length) {
        const empty = document.createElement("p");
        empty.className = "meta orphan";
        empty.textContent = "Нет подписанных кнопок — сначала «Клавиши · скан».";
        body.appendChild(empty);
      } else {
        const h = document.createElement("p");
        h.className = "meta";
        h.textContent = "Размеченные кнопки (" + named.length + "):";
        body.appendChild(h);
        named.sort((a, b) => a.name.localeCompare(b.name, "ru")).forEach((r) => {
          const li = document.createElement("li");
          li.textContent = r.name + " · " + r.deviceTopicKey + "/" + r.controlId;
          list.appendChild(li);
        });
        body.appendChild(list);
      }
      const stop = document.createElement("button");
      stop.type = "button";
      stop.className = "ghost";
      stop.textContent = "Остановить прозвон";
      stop.addEventListener("click", () => {
        stopPairListen();
        modFamily = "all";
        renderMark();
      });
      body.appendChild(stop);
    }
    function solutionsOnLoad(deviceTopicKey, controlId) {
      const titles = [];
      (deskSolutions || []).forEach((sol) => {
        const hit = (sol.targets || []).some(
          (t) => t && t.deviceTopicKey === deviceTopicKey && t.controlId === controlId,
        );
        if (!hit) return;
        const card = (deskCatalog || []).find((c) => c.id === sol.solutionId);
        const title = (card && card.title) || sol.title || sol.solutionId;
        if (title && !titles.includes(title)) titles.push(title);
      });
      return titles;
    }
    function deskOutputFight() {
      const by = new Map();
      (deskSolutions || []).forEach((s) => {
        const card = (deskCatalog || []).find((c) => c && c.id === s.solutionId);
        const kind = card && card.continuous ? "c" : card && card.cron ? "k" : "";
        if (!kind) return;
        (s.targets || []).forEach((t) => {
          if (!t || !t.deviceTopicKey || !t.controlId) return;
          const key = t.deviceTopicKey + "/" + t.controlId;
          if (!by.has(key)) by.set(key, { c: new Set(), k: new Set() });
          by.get(key)[kind].add(s.id || s.solutionId);
        });
      });
      let busy = false;
      let schedule = false;
      for (const bucket of by.values()) {
        if (bucket.c.size > 1) busy = true;
        if (bucket.c.size && bucket.k.size) schedule = true;
      }
      return { busy, schedule };
    }
    function gapScanText(scan) {
      const bits = [];
      if (Number(scan.modulesMissing) > 0) bits.push(scan.modulesMissing + " модулей");
      if (Number(scan.channelsMissing) > 0) bits.push(scan.channelsMissing + " каналов");
      return bits.length ? "не ответили " + bits.join(" и ") + " прошлого снимка" : "шина ещё не вся";
    }
    function paintTornDesk() {
      paintCheckList(
        [{ level: "bad", text: "Файл стола не читается. На диске он не стёрт, на экране плана нет." }],
        "Файл стола не читается",
        "bad",
      );
    }
    async function ensureDeskOpen() {
      let gate = {};
      try {
        gate = await (await fetch("/runtime/desk-gate")).json();
      } catch {
        gate = {};
      }
      if (!gate.locked || gate.open) return true;
      const lock = $("deskLock");
      if (lock) lock.hidden = false;
      const form = $("deskLockForm");
      if (form) {
        form.onsubmit = async (event) => {
          event.preventDefault();
          const note = $("deskLockNote");
          if (note) note.textContent = "";
          try {
            const r = await fetch("/runtime/desk-gate", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ action: "open", password: $("deskLockPassword").value }),
            });
            const j = await r.json();
            if (!j || !j.ok) {
              if (note) note.textContent = "Пароль не подошёл.";
              return;
            }
            location.reload();
          } catch {
            if (note) note.textContent = "Щит не ответил.";
          }
        };
      }
      return false;
    }
    function saveDeskSecret(kind) {
      const first = $(kind === "root" ? "rootPass" : "gatePass");
      const second = $(kind === "root" ? "rootPass2" : "gatePass2");
      const note = $(kind === "root" ? "rootNote" : "gateNote");
      const button = $(kind === "root" ? "rootSave" : "gateSave");
      const password = first ? first.value : "";
      const again = second ? second.value : "";
      if (note) note.hidden = false;
      if (password.length < 8 || password !== again) {
        if (note) note.textContent = password.length < 8 ? "Нужно от 8 знаков." : "Пароли не совпали.";
        return;
      }
      if (button) button.disabled = true;
      if (note) note.textContent = "Записываю…";
      const url = kind === "root" ? "/runtime/desk-root" : "/runtime/desk-gate";
      const body = kind === "root"
        ? { password, again }
        : { action: "set", password, again };
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
        .then((r) => r.json().then((j) => ({ okHttp: r.ok, j })))
        .then(({ j }) => {
          if (!j || !j.ok) {
            if (note) {
              note.textContent = j && j.error === "need_interface_password"
                ? "Сначала закройте интерфейс."
                : "Не записался.";
            }
            return;
          }
          if (first) first.value = "";
          if (second) second.value = "";
          if (kind === "root") {
            if (note) note.textContent = "Пароль root записан. Им открываются контроллер и его веб.";
            return;
          }
          location.reload();
        })
        .catch(() => {
          if (note) note.textContent = "Щит не ответил.";
        })
        .finally(() => {
          if (button) button.disabled = false;
        });
    }
    function paintShieldClock() {
      const el = $("shieldClock");
      if (!el) return;
      el.textContent = shieldClockLabel || "";
      el.title = shieldClockSource === "host" ? "Время на контроллере" : "Часы контроллера не прочитаны";
      el.hidden = !shieldClockLabel;
    }
    function paintBenchReady() {
      const el = $("benchReady");
      if (!el) return;
      if (markingUnreadable) {
        el.hidden = false;
        el.textContent = "Черновик не читается. На диске он цел, на экране его нет.";
        return;
      }
      if (shieldClockUnverified) {
        el.hidden = false;
        el.textContent = "Время щита не прочитано. Сверьте с телефоном.";
        return;
      }
      if (shieldClockOk === false) {
        el.hidden = false;
        el.textContent = "Часы щита не совпадают с телефоном. Вечерний свет включится не в тот час.";
        return;
      }
      const keys = keyPlan.length;
      const keysBound = keyPlan.filter((k) => k.deviceTopicKey && k.controlId).length;
      const lines = linePlan.length;
      const linesBound = linePlan.filter((k) => k.deviceTopicKey && k.controlId).length;
      const scan = lastBusScan;
      const busText = !scan
        ? "шину ещё не снимали"
        : scan.truncated
          ? "скан обрезан"
            : scan.shortScan
            ? gapScanText(scan)
            : scan.settled === false
              ? "шина ещё дописывается"
              : Number(scan.offlineDeviceCount) > 0
                ? ("молчит " + scan.offlineDeviceCount)
                : "шина спокойна";
      const keyText = keys && keysBound !== keys ? ("клавиши " + keysBound + "/" + keys) : "";
      const lineText = lines && linesBound !== lines ? ("линии " + linesBound + "/" + lines) : "";
      const ready = Boolean(scan) && scan.truncated !== true && scan.shortScan !== true && scan.settled !== false
        && !(Number(scan.offlineDeviceCount) > 0)
        && keys > 0 && keysBound === keys
        && (lines === 0 || linesBound === lines);
      const parts = !scan
        ? ["Обновите щит. Затем встаньте в комнате и нажмите кнопку три раза."]
        : [busText === "шина спокойна" ? "" : busText, keyText, lineText].filter(Boolean);
      el.hidden = ready || parts.length === 0;
      el.textContent = ready ? "" : parts.join(" · ");
      paintShieldClock();
    }
    function renderMark() {
      paintBenchReady();
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
      const intro = $("markIntro");
      if (intro) {
        intro.hidden = modFamily === "keys" || modFamily === "lines" || modFamily === "site" || modFamily === "remote";
        intro.textContent = modFamily === "keys" || modFamily === "lines" || modFamily === "site" || modFamily === "remote"
          ? ""
            : modFamily === "pair"
              ? "1 · Прозвон: нажмите физ. кнопку — увидите имя и импульс связанных линий."
              : "Назовите комнату и то, что в ней включается.";
      }
      const body = $("mark-body");
      if (!body) return;
      body.hidden = false;
      if (modFamily === "site" || modFamily === "keys") {
        renderKeyScanPanel(body);
        return;
      }
      if (modFamily === "lines") {
        renderLineBeaconPanel(body);
        return;
      }
      if (modFamily === "pair") {
        renderPairVerifyPanel(body);
        return;
      }
      const famRows = modFamily === "all"
        ? sortModules([].concat(split.light || [], split.buttons || [], split.relays || []))
        : (split[modFamily] || []);
      const empty = modFamily === "buttons"
        ? "Встаньте у кнопки и нажмите её три раза."
        : modFamily === "relays"
          ? "Реле появятся после обновления щита."
          : modFamily === "light"
            ? "Включите линию и назовите то, что загорелось."
            : "Встаньте в комнате и нажмите кнопку три раза.";
      fillModuleVitrine(body, famRows, empty);
    }
    function renderShelves(rows) {
      lastShelvesRows = rows || [];
      renderMark();
    }
    async function scanNow() {
      $("scan").disabled = true;
      try {
        $("bus").textContent = "Смотрю дом…";
        const r = await fetch("/runtime/mqtt-scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scanMs: 8000 }),
        });
        const j = await r.json();
        if (!j.ok || !Array.isArray(j.shelves)) {
            $("bus").className = "meta bad";
            $("bus").style.color = "rgb(var(--bad))";
            delete $("bus").dataset.base;
          $("bus").textContent = j.error || "Шина не ответила";
          return;
        }
        showShelves(j);
      } catch (e) {
          $("bus").className = "meta";
          $("bus").style.color = "rgb(var(--bad))";
          delete $("bus").dataset.base;
          $("bus").textContent = String(e.message || e);
      } finally {
        $("scan").disabled = false;
      }
    }
    $("scan").onclick = () => { void scanNow(); };
    if ($("fieldCert")) $("fieldCert").onclick = () => { void openFieldCert(); };
    if ($("settingsToggle")) {
      $("settingsToggle").onclick = async () => {
        const sheet = $("settingsSheet");
        if (!sheet) return;
        const open = sheet.hidden;
        sheet.hidden = !open;
        $("settingsToggle").setAttribute("aria-expanded", open ? "true" : "false");
        if (!open) return;
        if (!clockZones.length) {
          try {
            const j = await (await fetch("/runtime/desk-clock")).json();
            clockZones = Array.isArray(j.zones) ? j.zones : [];
          } catch { clockZones = []; }
        }
        const sel = $("shieldClockZone");
        if (!sel) return;
        sel.replaceChildren();
        if (shieldClockZone && !clockZones.some((z) => z.id === shieldClockZone)) {
          const current = document.createElement("option");
          current.value = "";
          current.textContent = "Сейчас " + shieldClockZone;
          current.disabled = true;
          current.selected = true;
          sel.appendChild(current);
        }
        clockZones.forEach((z) => {
          const opt = document.createElement("option");
          opt.value = z.id;
          opt.textContent = z.label + " · " + z.offset;
          sel.appendChild(opt);
        });
        if (shieldClockZone && clockZones.some((z) => z.id === shieldClockZone)) sel.value = shieldClockZone;
        const note = $("shieldClockNote");
        if (note) { note.hidden = true; note.textContent = ""; }
      };
    }
    if ($("gateSave")) $("gateSave").onclick = () => saveDeskSecret("gate");
    if ($("rootSave")) $("rootSave").onclick = () => saveDeskSecret("root");
    if ($("shieldClockSave")) {
      $("shieldClockSave").onclick = async () => {
        const sel = $("shieldClockZone");
        const note = $("shieldClockNote");
        const zone = sel ? sel.value : "";
        if (!zone) return;
        if (note) {
          note.hidden = false;
          note.textContent = "Записываю пояс на щит…";
        }
        $("shieldClockSave").disabled = true;
        try {
          const r = await fetch("/runtime/desk-clock", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ zone }),
          });
          const j = await r.json();
          if (!j || !j.ok) {
            if (note) note.textContent = "Пояс не записался.";
            return;
          }
          const clock = j.clock || {};
          shieldClockLabel = clock.label || shieldClockLabel;
          shieldClockSource = clock.source || shieldClockSource;
          shieldClockZone = clock.zone || zone;
          shieldClockOk = clock.ok !== false;
          shieldClockUnverified = clock.unverified === true;
          paintShieldClock();
          if (note) note.textContent = "Пояс записан. Время на щите обновлено.";
          void loadHealth();
        } catch {
          if (note) note.textContent = "Щит не ответил.";
        } finally {
          $("shieldClockSave").disabled = false;
        }
      };
    }
    $("cardMask").addEventListener("click", closeCardSheet);
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const settings = $("settingsSheet");
      if (settings && !settings.hidden) {
        settings.hidden = true;
        if ($("settingsToggle")) $("settingsToggle").setAttribute("aria-expanded", "false");
        return;
      }
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
      const shelves = Array.isArray(j.shelves) ? j.shelves : [];
      $("bus").className = "meta";
      $("bus").style.color = "";
      const named = shelves.reduce(function (n, s) {
        return n + (s.channels || []).filter(function (c) { return c.source === "rules" && c.name; }).length;
      }, 0);
      lastBusScan = j.scan || null;
      let line = "";
      if (j.scan && j.scan.truncated) line = "Список ещё не весь. Обновите ещё раз.";
      else if (j.scan && j.scan.shortScan) line = gapScanText(j.scan);
      else if (j.scan && j.scan.settled === false) line = "Дом ещё дописывается.";
      else if (j.scan && Number(j.scan.offlineDeviceCount) > 0) line = "Молчит " + j.scan.offlineDeviceCount;
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
    function paintHaPane(box) {
      box.className = "";
      const lead = document.createElement("p");
      lead.className = "meta";
      lead.textContent = "Свет из правил. Имя станет подписью в Home Assistant.";
      box.appendChild(lead);
      if (!haLights) {
        const wait = document.createElement("p");
        wait.className = "empty";
        wait.textContent = "Читаю правила…";
        box.appendChild(wait);
        return;
      }
      const find = document.createElement("input");
      find.type = "search";
      find.className = "ha-find";
      find.placeholder = "кух, бра, K5";
      find.setAttribute("aria-label", "Найти линию");
      const list = document.createElement("div");
      list.className = "ha-list";
      function paintRows() {
        const q = String(find.value || "").trim().toLowerCase().replace(/[№#_\-]+/g, " ");
        list.replaceChildren();
        const rows = haLights.filter((row) => {
          if (!q) return true;
          const draft = haDrafts.get(haRowKey(row)) || "";
          const blob = (row.hardware + " " + row.title + " " + draft + " " + row.deviceTopicKey + " " + row.controlId)
            .toLowerCase().replace(/[№#_\-]+/g, " ");
          return q.split(/\s+/).every((part) => part && blob.includes(part));
        });
        if (!rows.length) {
          const empty = document.createElement("p");
          empty.className = "empty";
          empty.textContent = haLights.length ? "Такой линии нет." : "В правилах пока нет света.";
          list.appendChild(empty);
          return;
        }
        rows.forEach((row) => {
          const line = document.createElement("label");
          line.className = "ha-row";
          const cap = document.createElement("span");
          cap.textContent = row.hardware;
          const key = haRowKey(row);
          const input = document.createElement("input");
          input.type = "text";
          input.className = "ha-name";
          input.placeholder = "Комната · светильник";
          input.value = haDrafts.has(key) ? haDrafts.get(key) : (row.named ? row.title : "");
          input.addEventListener("input", () => { haDrafts.set(key, input.value); });
          line.append(cap, input);
          list.appendChild(line);
        });
      }
      find.addEventListener("input", paintRows);
      paintRows();
      const foot = document.createElement("div");
      foot.className = "ha-foot";
      const write = document.createElement("button");
      write.type = "button";
      write.className = "ghost pour-primary";
      write.textContent = "Записать на щит";
      const note = document.createElement("p");
      note.className = "meta";
      write.addEventListener("click", () => { void writeHaNames(write, note); });
      foot.append(write, note);
      box.append(find, list, foot);
    }
    async function writeHaNames(btn, note) {
      const jobs = (haLights || []).map((row) => {
        const key = haRowKey(row);
        const name = String(haDrafts.get(key) || "").trim().replace(/\s+/g, " ");
        const was = row.named ? row.title : "";
        return name && name !== was ? { row, name } : null;
      }).filter(Boolean);
      if (!jobs.length) {
        note.textContent = "Нечего записывать.";
        return;
      }
      btn.disabled = true;
      note.textContent = "";
      try {
        for (const job of jobs) {
          const r = await fetch("/runtime/desk-marking", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              deviceTopicKey: job.row.deviceTopicKey,
              controlId: job.row.controlId,
              name: job.name,
            }),
          });
          const j = await r.json();
          if (!j || j.ok === false) throw new Error(j && j.error ? j.error : "Не сохранил имя");
        }
      } catch (e) {
        btn.disabled = false;
        note.textContent = String(e.message || e);
        return;
      }
      btn.disabled = false;
      runDeskPour("names", btn, null, () => {
        if (pouredPane === "ha") void loadHaLights();
      });
    }
    async function loadHaLights() {
      try {
        const r = await fetch("/runtime/desk-ha-lights");
        const j = await r.json();
        haLights = j && j.ok && Array.isArray(j.lights) ? j.lights : [];
        haDrafts = new Map(haLights.map((row) => [haRowKey(row), row.named ? row.title : ""]));
      } catch (_) {
        haLights = [];
      }
      if (pouredPane === "ha") renderReady();
    }
    async function loadRulesFile() {
      try {
        const r = await fetch("/runtime/desk-rules-file");
        const j = await r.json();
        rulesFileText = j && j.ok ? String(j.content || "") : "";
      } catch (_) {
        rulesFileText = "";
      }
      if (pouredPane === "file") renderReady();
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
            ? String(j.revisionId).replace(/^(?:fnv1a32:|sha256:)/i, "").slice(0, 8)
            : "";
          const files = (j.files || []).map((f) => f.filename).filter(Boolean);
          const omitted = Number(j.rulesOmitted) || 0;
          const total = j.ruleCount || pouredRules.length;
          headEl.textContent = (omitted ? ("показаны " + pouredRules.length + " из " + total) : (total + " правил"))
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
        if (j && j.error === "cache_unreadable") {
          const bus = $("bus");
          if (bus) {
            bus.className = "meta bad";
            bus.style.color = "rgb(var(--bad))";
            bus.textContent = "Снимок шины на диске не читается. Слушаю щит заново.";
          }
        }
      } catch (_) { /* снимем шину ниже */ }
      await scanNow();
    }
    function pourResultLine(j) {
      const diskOk = j.disk ? j.disk.ok === true : true;
      const diskLine = j.disk ? (diskOk ? "На диске совпало" : "Диск не совпал") : "";
      const busLine = j.bus
        ? (j.bus.engineAccepted
          ? "Движок принял файл"
          : j.bus.restarted
            ? "Движок перезапущен, файл не подтверждён"
            : "Движок не перезапущен")
        : (j.restarted ? "Движок перезапущен" : "");
      const timerLine = j.bus && j.bus.timersReset ? "таймеры и удержания сброшены" : "";
      const mqttLine = (j.bus && j.bus.mqttPublished) || j.mqttPublished
        ? "Шина " + ((j.bus && j.bus.mqttPublished) || j.mqttPublished)
        : "";
      return [diskLine, busLine, timerLine, mqttLine].filter(Boolean).join(" · ");
    }
    function runDeskPour(scope, btn, solutionIds, onDone) {
      if (!btn || btn.disabled) return;
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = solutionIds && solutionIds.length
        ? "Пишу…"
        : scope === "all" ? "Записываю…" : scope === "names" ? "Имена…" : scope === "rules" ? "Сценарии…" : "Убираю…";
      const payload = { scope: scope === "repair" ? "names" : scope };
      if (solutionIds && solutionIds.length) payload.solutionIds = solutionIds;
      fetch("/runtime/desk-pour", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then((r) => r.json())
        .then((j) => {
          btn.disabled = false;
          btn.textContent = label;
          if (typeof onDone === "function") onDone(j);
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
            if (j.disk && j.disk.ok === false) {
              head.style.color = "rgb(var(--bad))";
              head.textContent = "На диск не легло";
            } else {
            head.style.color = "";
              const bits = [j.mqttOnly ? "Дубли спрятаны" : "Записано на щит"];
              if (j.namedCount) bits.push("имён " + j.namedCount);
              if (j.emittedSolutions) bits.push("сценариев " + j.emittedSolutions);
              head.textContent = bits.join(" · ");
            }
          }
          openPourMod = "";
          loadPoured().then(() => renderDeskSolutions());
          loadPreview();
        })
        .catch((e) => {
          btn.disabled = false;
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
    document.querySelectorAll(".tab[data-nav]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.nav === "controller") {
          const tree = btn.closest(".rail-tree");
          if (!tree) return;
          tree.dataset.open = tree.dataset.open === "1" ? "0" : "1";
          btn.setAttribute("aria-expanded", tree.dataset.open === "1" ? "true" : "false");
          return;
        }
        openNav(btn.dataset.nav);
      });
    });
    const modSearch = $("modSearch");
    if (modSearch) {
      modSearch.addEventListener("input", () => {
        modQuery = modSearch.value;
        if (openMod) {
          const open = (lastShelvesRows || []).find((s) => s.deviceTopicKey === openMod);
          if (!open || !moduleMatchesQuery(open, modQuery)) openMod = "";
        }
        renderMark();
      });
    }
    document.querySelectorAll("#modFamily [data-fam]").forEach((btn) => {
      btn.addEventListener("click", () => {
        modFamily = /^(all|light|buttons|relays|keys|lines|pair)$/.test(btn.dataset.fam) ? btn.dataset.fam : "all";
        openMod = "";
        openAssign = "";
        markPending = {};
        markPath = "modules";
        if (modFamily !== "keys") stopKeyScan();
        if (modFamily !== "lines") stopLineBeacon();
        if (modFamily !== "pair") stopPairListen();
        if (modFamily === "keys") loadKeyPlan().then(() => renderMark());
        else if (modFamily === "lines") loadLinePlan().then(() => renderMark());
        else if (modFamily === "pair") {
          stopPairListen();
          renderMark();
        } else renderMark();
      });
    });
    if ($("passportXlsx")) {
      $("passportXlsx").addEventListener("click", () => {
        const unboundKeys = keyPlan.filter((k) => !k.deviceTopicKey).length;
        const unboundLines = linePlan.filter((k) => !k.deviceTopicKey).length;
        const holes = [];
        if (markingUnreadable) holes.push("файл стола не читается — на экране плана нет");
        if (shieldClockUnverified) holes.push("время щита не прочитано — сверьте с телефоном");
        else if (shieldClockOk === false) holes.push("часы щита неверные — файл домой не везти");
        const fight = deskOutputFight();
        if (fight.busy) holes.push("два постоянных правила на один выход — заливка их не запишет");
        if (fight.schedule) holes.push("расписание и постоянное правило на одном выходе — заливка их не запишет");
        if (!lastBusScan) holes.push("полный снимок шины ещё не сохранён — сначала «Обновить»");
        else if (lastBusScan.truncated) holes.push("последний скан шины обрезан");
        else if (lastBusScan.shortScan) holes.push(gapScanText(lastBusScan) + " — файл домой не везти");
        else if (lastBusScan.settled === false) holes.push("шина ещё дописывалась в момент снимка");
        if (unboundKeys) holes.push(unboundKeys + " клавиш без топика");
        if (unboundLines) holes.push(unboundLines + " линий без канала");
        if (holes.length && !window.confirm(holes.join("\n") + "\n\nНа листе «Дыры» это будет видно. Скачать файл всё равно?")) {
          return;
        }
        const a = document.createElement("a");
        a.href = "/runtime/desk-passport.xlsx";
        a.download = "паспорт-щита.xlsx";
        a.click();
      });
    }
    if ($("passportJson")) {
      $("passportJson").addEventListener("click", () => {
        if (markingUnreadable) {
          window.alert("Файл стола не читается. JSON не отдаю, чтобы не сохранить пустой дом.");
          return;
        }
        const a = document.createElement("a");
        a.href = "/runtime/desk-marking.json";
        a.download = "стол-щита.json";
        a.click();
      });
    }
    if ($("passportJsonRestore") && $("passportJsonFile")) {
      $("passportJsonRestore").addEventListener("click", () => $("passportJsonFile").click());
      $("passportJsonFile").addEventListener("change", () => {
        const file = $("passportJsonFile").files && $("passportJsonFile").files[0];
        $("passportJsonFile").value = "";
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          let body;
          try {
            body = JSON.parse(String(reader.result || ""));
          } catch {
            window.alert("Этот файл не JSON.");
            return;
          }
          if (!window.confirm("Заменить черновик стола этим файлом?\n\nПравила на щите не меняются.")) return;
          fetch("/runtime/desk-marking.json", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          })
            .then((r) => r.json())
            .then((j) => {
              if (!j || !j.ok) {
                window.alert(j && j.error === "too_large" ? "Файл слишком большой." : "Стол не принял файл.");
                return;
              }
              markingUnreadable = false;
              if (j.outputBusy) {
                window.alert("Черновик на месте. В нём два постоянных правила на один выход — заливка сценариев их не запишет.");
              }
              if (j.outputSchedule) {
                window.alert("Черновик на месте. На одном выходе расписание спорит с постоянным правилом — заливка сценариев их не запишет.");
              }
              window.location.reload();
            })
            .catch(() => window.alert("Нет связи со столом."));
        };
        reader.readAsText(file);
      });
    }
    if ($("clearMarks")) {
      $("clearMarks").addEventListener("click", () => {
        if (
          !window.confirm(
            "Снять всю разметку со стола?\nИмена исчезнут. Типовые и комнаты останутся. Щит не трогаем.",
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
    if ($("clearProject")) {
      $("clearProject").addEventListener("click", () => {
        if (
          !window.confirm(
            "Очистить проект полностью?\n\nСотрётся:\n• вся разметка (имена)\n• план клавиш и линий\n• все типовые на столе\n• список комнат\n\nШину MQTT не трогаем.",
          )
        ) {
          return;
        }
        if (!window.confirm("Точно очистить? Это нельзя отменить.")) return;
        const wipeShield = window.confirm(
          "Также снять со щита сценарии desk_sol (типовые с этого стола)?\n\nОК — зальём пустые правила (хвосты уйдут).\nОтмена — только стол, правила на щите останутся.",
        );
        const btn = $("clearProject");
        btn.disabled = true;
        fetch("/runtime/desk-marking", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ clear: "project" }),
        })
          .then((r) => r.json())
          .then((j) => {
            markPending = {};
            deskSolutions = [];
            keyPlan = [];
            linePlan = [];
            stopKeyScan();
            stopLineBeacon();
            stopPairListen();
            const head = $("previewHead");
            const baseMsg = j && j.ok
              ? ("Проект очищен"
                + (j.clearedShelves ? " · имён " + j.clearedShelves : "")
                + (j.clearedSolutions ? " · типовых " + j.clearedSolutions : "")
                + (j.clearedKeyPlan ? " · клавиш " + j.clearedKeyPlan : "")
                + (j.clearedLinePlan ? " · линий " + j.clearedLinePlan : "")
                + ". Размечайте заново.")
              : "Не очистил проект";
            if (head) {
              head.style.color = "";
              head.textContent = baseMsg;
            }
            const after = () => Promise.all([
              loadLast(), loadSolutions(), loadPreview(), loadKeyPlan(), loadLinePlan(),
            ]).then(() => {
              renderDeskSolutions();
              renderMark();
              setTab("mark");
              btn.disabled = false;
            });
            if (!(j && j.ok && wipeShield)) return after();
            return fetch("/runtime/desk-pour", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ scope: "rules" }),
            })
              .then((r) => r.json())
              .then((pour) => {
                if (head) {
                  head.textContent = baseMsg
                    + (pour && pour.ok
                      ? " · desk_sol с щита сняты"
                      : pour && pour.reason
                        ? " · щит: " + String(pour.reason)
                        : " · щит без изменений");
                }
                return after();
              })
              .catch(() => after());
          })
          .catch(() => {
            btn.disabled = false;
          });
      });
    }
    function paintCheckList(items, headText, tone) {
      const head = $("checkHead");
      const list = $("checkList");
      if (!head || !list) return;
      head.hidden = false;
      head.style.color = tone === "bad" ? "rgb(var(--bad))" : "";
      head.textContent = headText || "";
      list.hidden = false;
      list.replaceChildren();
      (items || []).forEach((it) => {
        const li = document.createElement("li");
        li.className = it.level === "bad" ? "bad" : it.level === "ok" ? "ok" : "warn";
        li.textContent = (it.level === "bad" ? "● " : it.level === "ok" ? "✓ " : "· ")
          + (it.text || it.name || "");
        list.appendChild(li);
      });
    }
    function fieldReadyBits(summary, issues) {
      const s = summary || {};
      const list = Array.isArray(issues) ? issues : [];
      const openKeys = list.some((i) => i.code === "key_plan_open");
      const openLines = list.some((i) => i.code === "line_plan_open");
      const bad = Number(s.bad) || 0;
      return {
        ready: bad === 0 && !openKeys && !openLines,
        openKeys,
        openLines,
        bad,
      };
    }
    async function fetchDeskHealth() {
      const r = await fetch("/runtime/desk-health", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shelves: lastShelvesRows || [] }),
      });
      return r.json();
    }
    async function runDeskHealthQuiet() {
      try {
        if (!(lastShelvesRows || []).length) await loadLast();
        await Promise.all([loadKeyPlan(), loadLinePlan(), loadSolutions()]);
        if (markingUnreadable) {
          paintTornDesk();
          return;
        }
        const j = await fetchDeskHealth();
        if (j && j.error === "marking_unreadable") {
          markingUnreadable = true;
          paintTornDesk();
          return;
        }
        const s = j.summary || {};
        const ready = fieldReadyBits(s, j.issues);
        const head = (ready.ready ? "К полю: разметка закрыта" : "Перед полем закройте хвосты")
          + " · имён " + (s.named || 0)
          + " · типовых " + (s.solutions || 0)
          + (s.bad ? (" · ошибок " + s.bad) : "")
          + (s.warn ? (" · замечаний " + s.warn) : "");
        const issues = (j.issues || []).length
          ? j.issues
          : [{ level: "ok", text: "Можно: диагностика → аудит → имена → сценарии." }];
        paintCheckList(issues, head, ready.ready ? "" : "bad");
      } catch (_) {
        /* тихий режим — не шумим */
      }
    }
    async function runDeskHealth() {
      const btn = $("runHealth");
      if (btn) btn.disabled = true;
      try {
        await loadLast();
        await Promise.all([loadKeyPlan(), loadLinePlan(), loadSolutions()]);
        if (markingUnreadable) {
          paintTornDesk();
          return;
        }
        const j = await fetchDeskHealth();
        if (j && j.error === "marking_unreadable") {
          markingUnreadable = true;
          paintTornDesk();
          return;
        }
        const s = j.summary || {};
        const ready = fieldReadyBits(s, j.issues);
        const head = (ready.ready ? "Диагностика ок · к полю" : "Есть проблемы")
          + " · модулей " + (s.modules || 0)
          + " · имён " + (s.named || 0)
          + (s.unboundLoads ? (" · без имени " + s.unboundLoads) : "")
          + (s.bad ? (" · ошибок " + s.bad) : "")
          + (s.warn ? (" · замечаний " + s.warn) : "");
        const issues = (j.issues || []).length
          ? j.issues
          : [{ level: "ok", text: "Дыр не видно — можно заливать и аудитить." }];
        paintCheckList(issues, head, ready.ready ? "" : "bad");
      } catch (e) {
        paintCheckList([], String(e.message || e), "bad");
      } finally {
        if (btn) btn.disabled = false;
      }
    }
    async function runExpressAudit() {
      const btn = $("runAudit");
      if (!btn || btn.disabled) return;
      if (!window.confirm(
        "Экспресс-аудит: короткий импульс по всем подписанным линиям света/реле.\nСтойте в зоне видимости. Продолжить?",
      )) {
        return;
      }
      btn.disabled = true;
      const label = btn.textContent;
      try {
        await loadLast();
        const tr = await fetch("/runtime/desk-audit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targets: true, shelves: lastShelvesRows || [] }),
        });
        const tj = await tr.json();
        const targets = Array.isArray(tj.targets) ? tj.targets : [];
        if (!targets.length) {
          paintCheckList(
            [{ level: "warn", text: "Нет подписанных линий — сначала разметка / маяк." }],
            "Аудит: нечего проверять",
            "bad",
          );
          return;
        }
        const rows = [];
        for (let i = 0; i < targets.length; i += 1) {
          const t = targets[i];
          btn.textContent = "Аудит " + (i + 1) + "/" + targets.length;
          paintCheckList(
            rows.map((r) => ({
              level: r.ok ? "ok" : "bad",
              text: (r.name || r.controlId) + (r.ok ? "" : " — " + (r.error || "нет ответа")),
            })).concat([{ level: "warn", text: "→ " + t.name + "…" }]),
            "Аудит " + (i + 1) + "/" + targets.length,
            "",
          );
          const res = await actuateChannel(t.deviceTopicKey, t.controlId, "pulse");
          rows.push({
            deviceTopicKey: t.deviceTopicKey,
            controlId: t.controlId,
            name: t.name,
            kind: t.kind,
            ok: Boolean(res && res.ok),
            error: res && res.ok ? undefined : (res && res.error) || "mqtt",
          });
          if (t.kind === "led") await new Promise((r) => setTimeout(r, 400));
        }
        const saved = await fetch("/runtime/desk-audit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ label: "Экспресс-аудит", rows }),
        }).then((r) => r.json());
        const okN = rows.filter((r) => r.ok).length;
        paintCheckList(
          rows.map((r) => ({
            level: r.ok ? "ok" : "bad",
            text: (r.name || r.controlId) + (r.ok ? "" : " — " + (r.error || "fail")),
          })),
          (saved && saved.run && saved.run.ok ? "Аудит сдан" : "Аудит с ошибками")
            + " · " + okN + "/" + rows.length
            + (saved && saved.run && saved.run.at
              ? " · " + String(saved.run.at).slice(0, 19).replace("T", " ")
              : ""),
          okN === rows.length ? "" : "bad",
        );
      } catch (e) {
        paintCheckList([], String(e.message || e), "bad");
      } finally {
        btn.textContent = label;
        btn.disabled = false;
      }
    }
    if ($("runHealth")) $("runHealth").addEventListener("click", () => { void runDeskHealth(); });
    if ($("runAudit")) $("runAudit").addEventListener("click", () => { void runExpressAudit(); });
    if ($("pourAll")) {
      $("pourAll").addEventListener("click", () => {
        if (!canPourNamesDesk && !canPourRulesDesk) return;
        runDeskPour("all", $("pourAll"));
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
    document.querySelectorAll("[data-go]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const go = btn.dataset.go;
        if (go === "time") {
          const scan = $("scan");
          if (scan) scan.click();
          return;
        }
        if (go === "xlsx") {
          const x = $("passportXlsx");
          if (x) x.click();
          return;
        }
        if (go === "cards" || go === "scenes") { openNav("scenes"); return; }
        if (go === "poured" || go === "board") { openNav("board"); return; }
        if (go === "climate") { openNav("climate"); return; }
        if (go === "history") { openNav("history"); return; }
        if (go === "keys" || go === "site") { openNav("site"); return; }
        if (go === "lines" || go === "light") { openNav("site"); return; }
        if (go === "remote") { openNav("remote"); return; }
        openNav("guide");
      });
    });
    const fromHash = location.hash.replace("#", "");
    const hashNav = fromHash === "intro" ? "guide"
      : fromHash === "mark" || fromHash === "keys" || fromHash === "light" || fromHash === "lines" ? "site"
      : fromHash === "remote" ? "remote"
      : fromHash === "cards" ? "scenes"
      : fromHash === "poured" ? "board"
      : fromHash;
    void (async () => {
      if (!(await ensureDeskOpen())) return;
      openNav(NAV[hashNav] ? hashNav : "guide");
      deskNavLive = true;
      loadHealth();
      loadPoured();
      loadRooms();
      loadLast();
      loadSolutions();
    })();
 
