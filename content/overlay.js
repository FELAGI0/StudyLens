(() => {
  const OVERLAY_ID = "studylens-overlay";
  const MIN_SIZE = 5;
  const RENDER_THROTTLE_MS = 120;

  // Пока оверлей на экране, повторный хоткей - no-op.
  // Удалять старый узел нельзя: его document-листенеры остались бы
  // висеть и mouseup ушёл бы в background дважды
  if (document.getElementById(OVERLAY_ID)) return;

  const Z_BACKDROP = "2147483646";
  const Z_TOP = "2147483647";

  // inline !important надёжнее CSS-файла: переживает и случай, когда
  // стили не инжектнулись, и site-правила вида * { border: none !important },
  // которые убивают обычный inline-стиль без important
  const setImp = (el, props) => {
    for (const k in props) el.style.setProperty(k, props[k], "important");
  };

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  // inset:0 и right/bottom:0 надёжнее одного vh: оверлей тянется по
  // краям содержащего блока, а не по вычисленной высоте окна
  setImp(overlay, {
    position: "fixed",
    top: "0",
    left: "0",
    right: "0",
    bottom: "0",
    inset: "0",
    width: "100vw",
    height: "100vh",
    margin: "0",
    padding: "0",
    "box-sizing": "border-box",
    background: "rgba(0,0,0,0.3)",
    cursor: "crosshair",
    "user-select": "none",
    "-webkit-user-select": "none",
    "pointer-events": "auto",
    "z-index": Z_BACKDROP,
    display: "block",
    visibility: "visible",
    opacity: "1",
    transition: "none",
  });

  const selection = document.createElement("div");
  selection.className = "studylens-selection";
  setImp(selection, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "0",
    height: "0",
    "box-sizing": "border-box",
    border: "2px solid #4a9eff",
    background: "rgba(74,158,255,0.2)",
    "box-shadow": "inset 0 0 0 1px rgba(255,255,255,0.4)",
    "pointer-events": "none",
    "z-index": Z_TOP,
    display: "block",
    visibility: "visible",
    opacity: "1",
    transition: "none",
  });

  const indicator = document.createElement("div");
  indicator.className = "studylens-indicator";
  indicator.textContent = "";
  // Размер задаём явно max-content: если оставить width/height пустыми,
  // сайт растянет голый div своим правилом. inline-important перебивает
  // и site-стили, и наш CSS
  // translate(-100%,-100%) прижимает правый нижний угол индикатора к
  // координате, которую задаём в updateBox - размер от transform не зависит
  setImp(indicator, {
    position: "fixed",
    top: "0",
    left: "0",
    right: "auto",
    bottom: "auto",
    width: "max-content",
    height: "auto",
    "max-width": "none",
    "min-width": "0",
    "min-height": "0",
    "box-sizing": "border-box",
    padding: "2px 6px",
    font: "11px/1.4 monospace",
    "white-space": "nowrap",
    background: "rgba(0,0,0,0.85)",
    color: "#ffffff",
    "border-radius": "3px",
    "pointer-events": "none",
    "z-index": Z_TOP,
    transform: "translate(-100%, -100%)",
    display: "block",
    visibility: "visible",
    opacity: "1",
    transition: "none",
  });

  overlay.appendChild(selection);
  overlay.appendChild(indicator);
  document.documentElement.appendChild(overlay);

  let startX = 0;
  let startY = 0;
  let dragging = false;

  const STATUS_ID = "studylens-status";
  const STATUS_STYLE_ID = "studylens-status-style";

  let panelEl = null;
  let mdEl = null;
  let cursorEl = null;
  let cancelBtn = null;
  let rawText = "";
  let streaming = false;
  let renderTimer = null;
  // режим для заголовка и отправки; приходит из background сообщением set-mode
  let currentMode = null;
  let currentTitle = null;
  let helpEl = null;

  // Текст справки держим константой: она нужна и в панели, и потенциально
  // в подсказке, дублировать по коду не хочется
  const HELP_SHORTCUTS = [
    ["Ctrl+Shift+E", "Объясни"],
    ["Ctrl+Shift+K", "Кратко"],
    ["Ctrl+Shift+P", "Пошагово"],
    ["Ctrl+Shift+T", "Переведи"],
    ["Ctrl+Shift+F", "Найди ошибку"],
  ];

  // @keyframes нельзя задать через inline-стиль, поэтому держим их
  // в отдельном теге и добавляем один раз
  const ensureStatusStyles = () => {
    if (document.getElementById(STATUS_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STATUS_STYLE_ID;
    style.textContent = [
      "@keyframes studylens-dots{",
      "0%{content:''}25%{content:'.'}50%{content:'..'}75%{content:'...'}100%{content:''}",
      "}",
      "#studylens-status .studylens-dots::after{",
      "content:'';animation:studylens-dots 1.2s steps(1,end) infinite;",
      "}",
      "@keyframes studylens-blink{0%,49%{opacity:1}50%,100%{opacity:0}}",
      "#studylens-status .studylens-cursor{",
      "animation:studylens-blink 1s step-end infinite;",
      "}",
    ].join("");
    document.documentElement.appendChild(style);
  };

  const scrollToBottom = () => {
    if (panelEl) panelEl.scrollTop = panelEl.scrollHeight;
  };

  const updatePanelTitle = () => {
    if (!panelEl) return;
    const titleEl = panelEl.querySelector(".studylens-title");
    if (titleEl) {
      titleEl.textContent =
        "StudyLens" + (currentTitle ? " \u00b7 " + currentTitle : "");
    }
  };

  const removeStatus = () => {
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    if (panelEl) panelEl.remove();
    panelEl = null;
    mdEl = null;
    cursorEl = null;
    cancelBtn = null;
    rawText = "";
    streaming = false;
    document.removeEventListener("keydown", onPanelKeyDown, true);
  };

  const makeButton = (label, onClick) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    setImp(btn, {
      "flex": "0 0 auto",
      margin: "0",
      padding: "2px 6px",
      background: "transparent",
      border: "1px solid #555555",
      "border-radius": "4px",
      color: "#dddddd",
      font: "11px/1.2 system-ui, sans-serif",
      cursor: "pointer",
      "pointer-events": "auto",
      "white-space": "nowrap",
    });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  };

  const createPanel = () => {
    removeStatus();
    ensureStatusStyles();

    const box = document.createElement("div");
    box.id = STATUS_ID;
    setImp(box, {
      position: "fixed",
      top: "16px",
      right: "16px",
      left: "auto",
      bottom: "auto",
      "z-index": Z_TOP,
      background: "#1e1e1e",
      color: "#e0e0e0",
      padding: "16px",
      "border-radius": "8px",
      font: "14px/1.6 system-ui, sans-serif",
      "max-width": "480px",
      "min-width": "240px",
      "max-height": "70vh",
      overflow: "auto",
      "box-sizing": "border-box",
      display: "flex",
      "flex-direction": "column",
      gap: "8px",
      "text-align": "left",
      "pointer-events": "auto",
    });

    const header = document.createElement("div");
    setImp(header, {
      display: "flex",
      gap: "6px",
      "align-items": "center",
      "justify-content": "space-between",
      "flex": "0 0 auto",
    });

    const titleEl = document.createElement("div");
    titleEl.className = "studylens-title";
    titleEl.textContent =
      "StudyLens" + (currentTitle ? " \u00b7 " + currentTitle : "");
    setImp(titleEl, {
      "flex": "1 1 auto",
      "min-width": "0",
      font: "12px/1.2 system-ui, sans-serif",
      color: "#999999",
      "white-space": "nowrap",
      overflow: "hidden",
      "text-overflow": "ellipsis",
    });

    const actions = document.createElement("div");
    setImp(actions, {
      display: "flex",
      gap: "6px",
      "align-items": "center",
      "flex": "0 0 auto",
    });

    const helpBtn = makeButton("?", () => openHelp());
    setImp(helpBtn, {
      width: "20px",
      height: "20px",
      padding: "0",
      "line-height": "18px",
      "text-align": "center",
      "font-size": "12px",
      color: "#999999",
    });
    helpBtn.classList.add("studylens-help-btn");
    // цвет задан inline-important, поэтому CSS :hover его не перебьёт - вешаем вручную
    helpBtn.addEventListener("mouseenter", () =>
      setImp(helpBtn, { color: "#ffffff" })
    );
    helpBtn.addEventListener("mouseleave", () =>
      setImp(helpBtn, { color: "#999999" })
    );

    const copyBtn = makeButton("Копировать", () => {
      navigator.clipboard.writeText(rawText).catch(() => {});
    });
    cancelBtn = makeButton("Отмена", () => {
      chrome.runtime.sendMessage({ type: "cancel-analysis" });
    });
    const closeBtn = makeButton("\u00d7", () => removeStatus());
    setImp(closeBtn, {
      "font-size": "14px",
      "font-weight": "700",
      "padding": "1px 7px",
    });

    actions.appendChild(helpBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(cancelBtn);
    actions.appendChild(closeBtn);
    header.appendChild(titleEl);
    header.appendChild(actions);
    box.appendChild(header);

    mdEl = document.createElement("div");
    mdEl.className = "studylens-md";
    setImp(mdEl, { "min-width": "0", "flex": "1 1 auto" });
    box.appendChild(mdEl);

    // курсор отдельным узлом после контейнера: innerHTML-перерендер его
    // не затирает, и он всегда остаётся в конце текста
    cursorEl = document.createElement("span");
    cursorEl.className = "studylens-cursor";
    cursorEl.textContent = "\u258e";
    cursorEl.style.setProperty("display", "none", "important");
    box.appendChild(cursorEl);

    document.documentElement.appendChild(box);
    panelEl = box;
    return box;
  };

  // --- Рендер Markdown + LaTeX -----------------------------------------------

  // Формулы заменяем на маркеры ДО Markdown-парсинга: иначе marked съест
  // подчёркивания и звёздочки внутри формул. В атрибут кладём индекс в store,
  // а не сам текст, чтобы Markdown не попортил содержимое формулы
  const replaceLatex = (text, store) => {
    let out = text.replace(/\$\$([\s\S]+?)\$\$/g, (m, tex) => {
      const idx = store.push({ tex, block: true }) - 1;
      return `<span class="katex-block" data-katex="${idx}"></span>`;
    });
    out = out.replace(/\$([^$\n]+?)\$/g, (m, tex) => {
      // не трогаем "$5 и $10": у настоящей формулы пробелов по краям нет
      if (!tex.trim() || /^\s/.test(tex) || /\s$/.test(tex)) return m;
      const idx = store.push({ tex, block: false }) - 1;
      return `<span class="katex-inline" data-katex="${idx}"></span>`;
    });
    return out;
  };

  const SANITIZE_CONFIG = {
    ALLOWED_TAGS: [
      "h1", "h2", "h3", "h4", "h5", "h6",
      "p", "br", "hr", "strong", "em", "del", "code", "pre",
      "blockquote", "ul", "ol", "li",
      "table", "thead", "tbody", "tr", "th", "td",
      "a", "span", "sup", "sub",
    ],
    ALLOWED_ATTR: ["href", "title", "align", "class", "data-katex", "target", "rel"],
    ALLOW_DATA_ATTR: true,
  };

  const renderMarkdownTo = (container, raw) => {
    const hasLibs = !!globalThis.marked && !!globalThis.DOMPurify;
    if (!hasLibs) {
      // без библиотек показываем как текст: безопасно и не падает
      container.textContent = raw;
      return;
    }

    const store = [];
    const pre = replaceLatex(raw, store);

    let html;
    try {
      html = globalThis.marked.parse(pre);
    } catch (e) {
      container.textContent = raw;
      return;
    }

    const clean = globalThis.DOMPurify.sanitize(html, SANITIZE_CONFIG);
    container.innerHTML = clean;

    container.querySelectorAll("a[href]").forEach((a) => {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    });

    if (globalThis.katex) {
      container.querySelectorAll("[data-katex]").forEach((el) => {
        const item = store[Number(el.getAttribute("data-katex"))];
        if (!item) return;
        try {
          globalThis.katex.render(item.tex, el, {
            displayMode: item.block,
            throwOnError: false,
          });
        } catch (e) {
          el.textContent = item.tex;
        }
      });
    } else {
      container.querySelectorAll("[data-katex]").forEach((el) => {
        const item = store[Number(el.getAttribute("data-katex"))];
        if (item) el.textContent = item.tex;
      });
    }
  };

  const doRender = () => {
    if (!mdEl) return;
    renderMarkdownTo(mdEl, rawText);
    scrollToBottom();
  };

  // Перерендер всего текста на каждый чанк дорогой, поэтому throttle
  // отдельно от throttle sendMessage в background
  const scheduleRender = () => {
    if (renderTimer) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      doRender();
    }, RENDER_THROTTLE_MS);
  };

  // --- События панели --------------------------------------------------------

  const startPanel = () => {
    createPanel();
    streaming = true;
    rawText = "";
    setImp(cancelBtn, { display: "inline-block" });

    mdEl.textContent = "Analyzing";
    const dots = document.createElement("span");
    dots.className = "studylens-dots";
    mdEl.appendChild(dots);
  };

  const appendChunk = (text) => {
    if (!panelEl) createPanel();
    if (!streaming) return;
    rawText += text;
    scheduleRender();
  };

  const endStream = (truncated) => {
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    streaming = false;
    doRender();
    if (cancelBtn) setImp(cancelBtn, { display: "none" });
    if (cursorEl) cursorEl.style.setProperty("display", "none", "important");

    if (truncated) {
      const note = document.createElement("div");
      note.className = "studylens-status-note";
      note.textContent = "(ответ обрезан по лимиту токенов)";
      panelEl.appendChild(note);
      scrollToBottom();
    }
  };

  const showError = (error) => {
    createPanel();
    streaming = false;
    if (cancelBtn) setImp(cancelBtn, { display: "none" });
    mdEl.textContent = error;
    setImp(mdEl, { color: "#f87171" });
  };

  const showCanceled = () => {
    if (!panelEl) return;
    streaming = false;
    if (cancelBtn) setImp(cancelBtn, { display: "none" });
    if (cursorEl) cursorEl.style.setProperty("display", "none", "important");
    const note = document.createElement("div");
    note.className = "studylens-status-note";
    note.textContent = "(отменено)";
    panelEl.appendChild(note);
    scrollToBottom();
  };

  const onPanelKeyDown = (e) => {
    if (e.key === "Escape" && helpEl) {
      closeHelp();
      return;
    }
    if (e.key === "Escape" && panelEl) {
      removeStatus();
    }
  };

  // --- Мини-справка (модальный блок поверх панели) ---------------------------

  const closeHelp = () => {
    if (helpEl) helpEl.remove();
    helpEl = null;
  };

  const openHelp = () => {
    closeHelp();

    const backdrop = document.createElement("div");
    backdrop.id = "studylens-help";
    setImp(backdrop, {
      position: "fixed",
      inset: "0",
      "z-index": Z_TOP,
      background: "rgba(0,0,0,0.5)",
      display: "flex",
      "align-items": "center",
      "justify-content": "center",
      "pointer-events": "auto",
      "font-family": "system-ui, sans-serif",
    });
    // клик по фону вне карточки закрывает справку
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeHelp();
    });

    const card = document.createElement("div");
    setImp(card, {
      background: "#1e1e1e",
      color: "#e0e0e0",
      padding: "16px 18px",
      "border-radius": "10px",
      "max-width": "400px",
      "max-height": "80vh",
      overflow: "auto",
      "box-sizing": "border-box",
      font: "13px/1.5 system-ui, sans-serif",
      "box-shadow": "0 8px 32px rgba(0,0,0,0.5)",
      "text-align": "left",
    });

    const head = document.createElement("div");
    setImp(head, {
      display: "flex",
      "align-items": "center",
      "justify-content": "space-between",
      gap: "12px",
      "margin-bottom": "12px",
    });
    const headTitle = document.createElement("div");
    headTitle.textContent = "Горячие клавиши и справка";
    setImp(headTitle, { font: "14px/1.3 system-ui, sans-serif", color: "#ffffff", "font-weight": "600" });
    const closeX = makeButton("\u00d7", () => closeHelp());
    setImp(closeX, { "font-size": "16px", "font-weight": "700", padding: "0 8px" });
    head.appendChild(headTitle);
    head.appendChild(closeX);
    card.appendChild(head);

    const table = document.createElement("table");
    setImp(table, { "border-collapse": "collapse", width: "100%", "margin-bottom": "12px" });
    for (const [key, label] of HELP_SHORTCUTS) {
      const tr = document.createElement("tr");
      const td1 = document.createElement("td");
      td1.textContent = key;
      setImp(td1, { padding: "3px 8px 3px 0", "font-family": "monospace", color: "#cccccc", "white-space": "nowrap" });
      const td2 = document.createElement("td");
      td2.textContent = label;
      setImp(td2, { padding: "3px 0", color: "#a0a0a0" });
      tr.appendChild(td1);
      tr.appendChild(td2);
      table.appendChild(tr);
    }
    card.appendChild(table);

    const link = document.createElement("a");
    link.textContent = "Настроить горячие клавиши";
    link.href = "chrome://extensions/shortcuts";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    setImp(link, { color: "#4a9eff", "text-decoration": "underline", display: "inline-block", "margin-bottom": "12px" });
    card.appendChild(link);

    const about = document.createElement("div");
    about.textContent =
      "Режимы доступа: «Свой ключ» - запросы идут напрямую в API с вашим ключом. " +
      "«По паролю» - запросы идут через сервер StudyLens, пароль выдаёт администратор. " +
      "Режим по умолчанию выбирается в настройках расширения.";
    setImp(about, { "font-size": "12px", color: "#999999", "line-height": "1.5" });
    card.appendChild(about);

    const findbugNote = document.createElement("div");
    findbugNote.textContent =
      "Найди ошибку (Ctrl+Shift+F) - назначьте вручную в chrome://extensions/shortcuts " +
      "(Chrome ограничивает до 4 автоматических хоткеев на расширение).";
    setImp(findbugNote, {
      margin: "10px 0 0",
      "font-size": "11px",
      color: "#808080",
      "line-height": "1.5",
    });
    card.appendChild(findbugNote);

    backdrop.appendChild(card);
    document.documentElement.appendChild(backdrop);
    helpEl = backdrop;
  };

  const startAnalysis = (base64) => {
    startPanel();
    cursorEl.style.setProperty("display", "inline", "important");
    document.addEventListener("keydown", onPanelKeyDown, true);
    const payload = { type: "analyze-image", base64 };
    if (currentMode) payload.mode = currentMode;
    chrome.runtime.sendMessage(payload);
  };

  // Не снимаем listener по ходу стрима: чанки идут потоком.
  // Снимаем только на терминальном событии, чтобы не копились обработчики
  const onMessage = (msg) => {
    if (!msg) return;

    if (msg.type === "set-mode") {
      currentMode = msg.mode;
      currentTitle = msg.title || null;
      updatePanelTitle();
      return;
    }
    if (msg.type === "captured-image") {
      startAnalysis(msg.base64);
      return;
    }
    if (msg.type === "analysis-start") {
      return;
    }
    if (msg.type === "analysis-chunk") {
      appendChunk(msg.text);
      return;
    }
    if (msg.type === "analysis-end") {
      endStream(msg.truncated);
      chrome.runtime.onMessage.removeListener(onMessage);
      return;
    }
    if (msg.type === "analysis-error") {
      showError(msg.error);
      chrome.runtime.onMessage.removeListener(onMessage);
      return;
    }
    if (msg.type === "analysis-canceled") {
      showCanceled();
      chrome.runtime.onMessage.removeListener(onMessage);
    }
  };
  chrome.runtime.onMessage.addListener(onMessage);

  const updateBox = (x, y) => {
    const left = Math.min(x, startX);
    const top = Math.min(y, startY);
    const width = Math.abs(x - startX);
    const height = Math.abs(y - startY);

    setImp(selection, {
      left: left + "px",
      top: top + "px",
      width: width + "px",
      height: height + "px",
    });

    // индикатор в правом нижнем углу рамки: translate(-100%,-100%)
    // из стилей прижимает его туда этой же точкой
    setImp(indicator, {
      left: left + width + "px",
      top: top + height + "px",
    });
    indicator.textContent = `${Math.round(width)} x ${Math.round(height)}`;

    return { left, top, width, height };
  };

  const cleanup = () => {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    document.removeEventListener("keydown", onKeyDown, true);
    overlay.remove();
  };

  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    updateBox(e.clientX, e.clientY);
  };

  const onMouseMove = (e) => {
    if (!dragging) return;
    updateBox(e.clientX, e.clientY);
  };

  const onMouseUp = (e) => {
    if (!dragging) return;
    dragging = false;

    const { left, top, width, height } = updateBox(e.clientX, e.clientY);

    if (width < MIN_SIZE || height < MIN_SIZE) {
      cleanup();
      return;
    }

    const rect = {
      x: left,
      y: top,
      width,
      height,
      dpr: window.devicePixelRatio,
    };

    cleanup();
    chrome.runtime.sendMessage({ type: "area-selected", rect });
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cleanup();
    }
  };

  overlay.addEventListener("mousedown", onMouseDown);
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);
  document.addEventListener("keydown", onKeyDown, true);
})();