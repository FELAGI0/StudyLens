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
      "justify-content": "flex-end",
      "flex": "0 0 auto",
    });

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

    header.appendChild(copyBtn);
    header.appendChild(cancelBtn);
    header.appendChild(closeBtn);
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

  const escapeHtml = (s) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

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
    if (e.key === "Escape" && panelEl) {
      removeStatus();
    }
  };

  const startAnalysis = (base64) => {
    startPanel();
    cursorEl.style.setProperty("display", "inline", "important");
    document.addEventListener("keydown", onPanelKeyDown, true);
    chrome.runtime.sendMessage({ type: "analyze-image", base64 });
  };

  // Не снимаем listener по ходу стрима: чанки идут потоком.
  // Снимаем только на терминальном событии, чтобы не копились обработчики
  const onMessage = (msg) => {
    if (!msg) return;

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