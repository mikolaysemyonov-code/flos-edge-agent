    const $ = (id) => document.getElementById(id);
    let liveKeys = {};
    let pouredRules = [];
    let lastShelvesRows = [];
    let lastGapCount = 0;
    let activeTab = "light";
    let deskCatalog = [];
    let deskSolutions = [];
    let cardFilter = "Свет";
    let deskRooms = [];
    let markEdit = "";
    let markDraft = { room: "", type: "" };
    let roomFilter = "";
    let openMod = "";
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
      return "Привод " + m[1] + (m[2].toLowerCase() === "open" ? " открыть" : " закрыть");
    }
    function driveTwin(controlId) {
      const m = /^((?:Curtain|Actuator)\s+\d+\s+)(Open|Close)$/i.exec(String(controlId || "").trim());
      if (!m) return "";
      return m[1] + (/open/i.test(m[2]) ? "Close" : "Open");
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
      if (!openMod && !markEdit) return;
      openMod = "";
      markEdit = "";
      markDraft = { room: "", type: "" };
      renderShelves(lastShelvesRows);
      renderRoomBars();
    }
    function setTab(tab, keepMod) {
      if (!/^(light|buttons|relays|cards|poured)$/.test(tab)) return;
      activeTab = tab;
      closeCardSheet();
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
        (r.pouredName && r.pouredName !== r.name ? " · на диске " + r.pouredName : "") +
        (r.pouredCards && r.pouredCards.length ? " · на диске " + r.pouredCards.join(" · ") : "");
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
      $("pour").disabled = true;
      $("previewHead").style.color = "";
      const ready = j.ready || {};
      const readyBits = [
        (ready.solutions || 0) + " типовых на столе",
        (ready.blocked || 0) + " без имени",
        (ready.gaps || 0) + " без карточки",
      ].join(" · ");
      if (!rows.length) {
        $("previewHead").textContent = (j.reason || "Превью. Диск не трогаем.") + " · " + readyBits;
      } else {
        $("previewHead").textContent = (j.reason || "Превью. Диск не трогаем.") + " · " + readyBits + " · " + rows.length + " отличий";
        appendRoomList(ul, rows, (r) => nameRoom(r.name), previewRow);
      }
      $("gapsHead").hidden = !gaps.length;
      $("gapsHead").textContent = gaps.length
        ? gaps.length + " линий без карточки · ткни чип, диск не трогаем"
        : "";
      const gapRows = gaps.map((g) => ({
        ...g,
        title: g.name,
        contacts: [{ deviceTopicKey: g.deviceTopicKey, controlId: g.controlId }],
      }));
      appendRoomList(gapsUl, gapRows, (r) => nameRoom(r.name), previewRow);
      lastGapCount = gaps.length;
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
          const first = [...($("gaps").children || [])].find((n) => n.className !== "roomh");
          (first || $("gapsHead")).scrollIntoView({ block: "start" });
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
      const out = parts.filter(
        (p) => p.toLowerCase() !== roomLc && !/^(Channel|Input|K)\s*\d+$/i.test(p),
      );
      return out.join(" · ") || title;
    }
    function pouredRow(r, room) {
      const li = document.createElement("li");
      const left = document.createElement("div");
      const title = document.createElement("div");
      title.textContent = room ? titleUnderRoom(r.title || r.id, room) : (r.title || r.id);
      const sub = document.createElement("div");
      sub.className = "meta";
      const bits = (r.contacts || []).map(contactLine);
      const missing = (r.contacts || []).filter((c) => liveKeys.ready && !liveKeys[c.deviceTopicKey]);
      sub.textContent = bits.join(", ") || "нет контакта на шине";
      if (missing.length) {
        sub.className = "meta orphan";
        sub.textContent = bits.join(", ") + " · нет на этой шине";
      }
      left.appendChild(title);
      left.appendChild(sub);
      const kind = document.createElement("span");
      kind.className = "kind";
      kind.textContent = kindRu(r.kind);
      li.appendChild(left);
      li.appendChild(kind);
      return li;
    }
    function renderPoured() {
      const ul = $("poured");
      const marksUl = $("pouredMarks");
      const wrap = $("pouredMarksWrap");
      ul.innerHTML = "";
      marksUl.innerHTML = "";
      const scenarios = pouredRules.filter((r) => r.kind !== "marking");
      const names = pouredRules.filter((r) => r.kind === "marking");
      $("n-poured").textContent = scenarios.length || "";
      if (!pouredRules.length) {
        wrap.hidden = true;
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = "На диске пока нет user-правил.";
        ul.appendChild(empty);
        return;
      }
      appendRoomList(ul, scenarios, (r) => prettyRoom(String(r.title || "").split(/\s*·\s*/)[1] || ""), pouredRow);
      wrap.hidden = !names.length;
      $("pouredMarksSum").textContent = names.length + " имён из разметки";
      appendRoomList(marksUl, names, (r) => prettyRoom(String(r.title || "").split(/\s*·\s*/)[0] || ""), pouredRow);
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
        ? n + " сценариев уже на диске — вкладка Залито. Новые карточки пока только на столе."
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
          ? solContactLabel(onDesk[0].trigger) + " → " + onDesk[0].targets.map(solContactLabel).join(" · ")
          : card.summary;
        btn.addEventListener("click", () => openCardSheet(card, onDesk[0]));
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
    async function saveBinds(key, controlId, binds) {
      await saveMark({ deviceTopicKey: key, controlId: controlId, binds: binds });
      fetch("/runtime/mqtt-scan").then((res) => res.json()).then((j) => {
        if (j.ok && j.shelves) showShelves(j);
      }).catch(() => {});
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
          const name = String(ch.name || "").trim();
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
    function makeBindSelect(s, ch, pouredLoads) {
      const wrap = document.createElement("div");
      wrap.className = "mark";
      const h = document.createElement("p");
      h.className = "steph";
      h.textContent = "Линия";
      wrap.appendChild(h);
      const cur = (Array.isArray(ch.binds) && ch.binds[0])
        ? contactKey(ch.binds[0].deviceTopicKey, ch.binds[0].controlId)
        : "";
      const loads = loadsForRoom(roomFilter);
      const bar = document.createElement("div");
      bar.className = "chips";
      if (pouredLoads.length && !loads.length) {
        const note = document.createElement("p");
        note.className = "loads";
        note.textContent = pouredLoads.map(prettyContactName).join(" · ");
        wrap.appendChild(note);
      }
      loads.forEach((load) => {
        const key = contactKey(load.deviceTopicKey, load.controlId);
        const b = document.createElement("button");
        b.type = "button";
        b.className = "chip";
        b.textContent = load.label;
        b.setAttribute("aria-pressed", key === cur ? "true" : "false");
        b.addEventListener("click", () => {
          markEdit = "";
          markDraft = { room: "", type: "" };
          if (key === cur) {
            saveBinds(s.deviceTopicKey, ch.controlId, []).catch(() => {});
            return;
          }
          saveBinds(s.deviceTopicKey, ch.controlId, [{
            deviceTopicKey: load.deviceTopicKey,
            controlId: load.controlId,
          }]).catch(() => {});
        });
        bar.appendChild(b);
      });
      wrap.appendChild(bar);
      return wrap;
    }
    function contactKey(key, cid) {
      return String(key) + "::" + String(cid);
    }
    function triggersBoundTo(loadKey, loadCid) {
      const want = contactKey(loadKey, loadCid);
      const out = [];
      (lastShelvesRows || []).forEach((s) => {
        (s.channels || []).forEach((ch) => {
          (Array.isArray(ch.binds) ? ch.binds : []).forEach((b) => {
            if (contactKey(b.deviceTopicKey, b.controlId) !== want) return;
            out.push({
              deviceTopicKey: s.deviceTopicKey,
              controlId: ch.controlId,
              label: solContactLabel({ deviceTopicKey: s.deviceTopicKey, controlId: ch.controlId }),
            });
          });
        });
      });
      return out;
    }
    function jumpToContact(key, cid) {
      openMod = key;
      markEdit = contactKey(key, cid);
      const shelf = lastShelvesRows.find((r) => r.deviceTopicKey === key);
      const hit = shelf && (shelf.channels || []).find((x) => x.controlId === cid);
      markDraft = splitMark(hit && hit.name);
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
        const inp = el.querySelector(".namebtn") || el.querySelector("select.bind") || el.querySelector("button.chip");
        if (inp) inp.focus();
        setTimeout(() => el.classList.remove("jump"), 1400);
      };
      requestAnimationFrame(() => requestAnimationFrame(go));
    }
    function channelRow(s, ch, room) {
      const row = document.createElement("li");
      row.dataset.contact = contactKey(s.deviceTopicKey, ch.controlId);
      const knob = document.createElement("span");
      knob.className = "knob";
      knob.textContent = prettyControlId(ch.controlId);
      const loads = Array.isArray(ch.loads) ? ch.loads.filter(Boolean) : [];
      const isLoad = isDeskLoad(ch.controlId);
      const original = String(ch.name || "").trim();
      const editing = markEdit === contactKey(s.deviceTopicKey, ch.controlId);
      row.appendChild(knob);
      const grow = document.createElement("div");
      if (editing) grow.appendChild(makeMarkEditor(s, ch, isLoad));
      else {
        const nameBtn = document.createElement("button");
        nameBtn.type = "button";
        nameBtn.className = "namebtn" + (original ? "" : " mute");
        nameBtn.textContent = original ? prettyContactName(original) : "Назвать";
        nameBtn.addEventListener("click", () => {
          const saved = splitMark(original);
          if (!roomFilter && !saved.room) {
            const bar = $("rooms-" + activeTab);
            if (bar) {
              bar.classList.remove("need");
              void bar.offsetWidth;
              bar.classList.add("need");
            }
            return;
          }
          markEdit = contactKey(s.deviceTopicKey, ch.controlId);
          markDraft = { room: saved.room || roomFilter, type: saved.type };
          renderShelves(lastShelvesRows);
        });
        grow.appendChild(nameBtn);
      }
      const selected = new Set(exclusiveCards(Array.isArray(ch.cards) ? ch.cards : []));
      const poured = Array.isArray(ch.hints) && ch.hints.length > 0;
      const buttons = Array.isArray(ch.buttons) ? ch.buttons.filter(Boolean) : [];
      const deskTriggers = isLoad ? triggersBoundTo(s.deviceTopicKey, ch.controlId) : [];
      const diskIds = exclusiveCards(CARDS.filter((c) => (ch.hints || []).includes(c.ru)).map((c) => c.id));
      const deskDiverged = poured && [...selected].sort().join(",") !== diskIds.slice().sort().join(",");
      if (!isLoad && original && editing) {
        grow.appendChild(makeBindSelect(s, ch, loads));
      } else if (!isLoad && original) {
        const sub = document.createElement("span");
        sub.className = "loads";
        const bind = Array.isArray(ch.binds) && ch.binds[0];
        sub.textContent = bind ? solContactLabel(bind) : "привязать линию";
        grow.appendChild(sub);
      } else if (!isLoad && Array.isArray(ch.binds) && ch.binds.length) {
        const sub = document.createElement("span");
        sub.className = "loads orphan";
        sub.textContent = "сначала комната и тип";
        grow.appendChild(sub);
      } else if (deskTriggers.length) {
        const sub = document.createElement("button");
        sub.type = "button";
        sub.className = "loads";
        sub.textContent = "кнопка · " + deskTriggers.map((t) => t.label).join(" · ");
        sub.addEventListener("click", () => jumpToContact(deskTriggers[0].deviceTopicKey, deskTriggers[0].controlId));
        grow.appendChild(sub);
      } else if (buttons.length) {
        const sub = document.createElement("span");
        sub.className = "loads";
        sub.textContent = "кнопка · " + buttons.map(prettyContactName).join(" · ");
        grow.appendChild(sub);
      } else if (deskDiverged) {
        const sub = document.createElement("span");
        sub.className = "loads";
        sub.textContent = "на диске · " + (ch.hints || []).join(" · ");
        grow.appendChild(sub);
      } else if (ch.name && !poured) {
        const sub = document.createElement("span");
        sub.className = "loads";
        sub.textContent = "нет кнопки";
        grow.appendChild(sub);
      }
      row.appendChild(grow);
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
    function makeMarkEditor(s, ch, isLoad) {
      const box = document.createElement("div");
      box.className = "mark";
      const saved = splitMark(ch.name);
      const current = {
        room: markDraft.room || saved.room || roomFilter,
        type: markDraft.type || saved.type,
      };
      const persistName = (next) => {
        const jobs = [saveName(s.deviceTopicKey, ch.controlId, next)];
        const twin = isDeskDrive(ch.controlId) ? driveTwin(ch.controlId) : "";
        if (twin) jobs.push(saveName(s.deviceTopicKey, twin, next));
        if (isLoad) {
          markEdit = "";
          markDraft = { room: "", type: "" };
        }
        return Promise.all(jobs).then(() => loadLast());
      };
      const commit = () => {
        const next = composeMark(markDraft.room || current.room, markDraft.type || current.type);
        if (!next || next === String(ch.name || "").trim()) {
          renderShelves(lastShelvesRows);
          return;
        }
        persistName(next).catch(() => {});
      };
      const typeH = document.createElement("p");
      typeH.className = "steph";
      const key = String(s.deviceTopicKey || "");
      typeH.textContent = isDeskDrive(ch.controlId) ? "Подпись"
        : /^K\d+$/i.test(ch.controlId) ? "Тип 220 В"
        : /dali/i.test(key) ? "Тип DALI"
        : isLoad ? "Подсветка"
        : "Тип";
      box.appendChild(typeH);
      const types = [...markTypes(s, ch, isLoad)];
      if (current.type && !types.includes(current.type)) types.push(current.type);
      box.appendChild(makeChipBar(types, current.type, (v) => {
        markDraft.type = v;
        if (!markDraft.room) markDraft.room = current.room || roomFilter;
        commit();
      }));
      const done = document.createElement("button");
      done.type = "button";
      done.className = "done";
      done.textContent = "Готово";
      done.addEventListener("click", () => {
        markEdit = "";
        markDraft = { room: "", type: "" };
        renderShelves(lastShelvesRows);
      });
      box.appendChild(done);
      return box;
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
          if (markEdit && roomFilter) markDraft.room = roomFilter;
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
        const typed = window.prompt("Комната");
        if (!typed || !typed.trim()) return;
        fetch("/runtime/desk-marking", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ room: typed.trim() }),
        }).then((r) => r.json()).then((j) => {
          if (!j.ok) return;
          deskRooms = j.rooms || deskRooms;
          roomFilter = prettyRoom(typed);
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
      return (s.channels || []).filter((c) => String(c.name || "").trim()).length;
    }
    function moduleRoomsOf(s) {
      return [...new Set((s.channels || []).map(channelRoom).filter(Boolean))];
    }
    function sortModules(rows) {
      return rows.slice().sort((a, b) => {
        const na = Number((/№(\d+)/.exec(a.label || "") || [])[1] || 0);
        const nb = Number((/№(\d+)/.exec(b.label || "") || [])[1] || 0);
        return na - nb || String(a.label || "").localeCompare(String(b.label || ""), "ru");
      });
    }
    function paintModuleFace(el, s) {
      const n = (s.channels || []).length || s.channelCount || 0;
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
        markEdit = "";
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
      const rooms = document.createElement("div");
      rooms.className = "rooms";
      rooms.setAttribute("aria-label", "Комнаты");
      fillRooms(rooms);
      const chs = document.createElement("ul");
      chs.className = "channels";
      appendChannelBlock(chs, s, s.channels || []);
      box.append(back, head, rooms, chs);
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
        ? "На K — свет 220 В или силовая. На приводе — подпись."
        : "Реле — свет 220 В и силовые. Ткни модуль."
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
        $("pouredHead").textContent = (j.ruleCount || pouredRules.length) + " правил" +
          (j.revisionId ? " · " + String(j.revisionId).slice(0, 12) : "") +
          (files ? " · " + files : "");
        renderPoured();
        loadPreview();
      } catch (e) {
        $("pouredHead").style.color = "rgb(var(--bad))";
        $("pouredHead").textContent = String(e.message || e);
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
    const fromHash = location.hash.replace("#", "");
    if (/^(light|buttons|relays|cards|poured)$/.test(fromHash)) setTab(fromHash);
    loadHealth();
    loadPoured();
    loadRooms();
    loadLast();
    loadSolutions();
  
