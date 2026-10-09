(() => {
  const OVERLAY_ID = "studylens-overlay";
  const MIN_SIZE = 5;

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
  let bodyTextEl = null;
  let cursorEl = null;
  let cancelBtn = null;
  let panelText = "";
  let streaming = false;

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
      "#studylens-status .studylens-status-text{white-space:pre-wrap;word-break:break-word;}",
    ].join("");
    document.documentElement.appendChild(style);
  };

  const scrollToBottom = () => {
    if (panelEl) panelEl.scrollTop = panelEl.scrollHeight;
  };

  const removeStatus = () => {
    if (panelEl) panelEl.remove();
    panelEl = null;
    bodyTextEl = null;
    cursorEl = null;
    cancelBtn = null;
    panelText = "";
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
      background: "rgba(0,0,0,0.85)",
      color: "#ffffff",
      padding: "12px 16px",
      "border-radius": "8px",
      font: "13px/1.4 system-ui, sans-serif",
      "max-width": "320px",
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
      navigator.clipboard.writeText(panelText).catch(() => {});
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

    const body = document.createElement("div");
    setImp(body, { "min-width": "0", "flex": "1 1 auto" });

    bodyTextEl = document.createElement("span");
    bodyTextEl.className = "studylens-status-text";
    body.appendChild(bodyTextEl);

    cursorEl = document.createElement("span");
    cursorEl.className = "studylens-cursor";
    cursorEl.textContent = "\u258e";

    box.appendChild(body);
    document.documentElement.appendChild(box);

    panelEl = box;
    return box;
  };

  const startPanel = () => {
    createPanel();
    streaming = true;
    panelText = "";
    setImp(cancelBtn, { display: "inline-block" });

    bodyTextEl.textContent = "Analyzing";
    const dots = document.createElement("span");
    dots.className = "studylens-dots";
    bodyTextEl.appendChild(dots);
  };

  const appendChunk = (text) => {
    if (!panelEl) createPanel();
    if (!streaming) return;

    // первый чанк приходит после "Analyzing" - затираем его
    if (!panelText) bodyTextEl.textContent = "";

    panelText += text;
    bodyTextEl.textContent = panelText;
    bodyTextEl.appendChild(cursorEl);

    scrollToBottom();
  };

  const endStream = (truncated) => {
    if (!panelEl) return;
    streaming = false;
    if (cancelBtn) setImp(cancelBtn, { display: "none" });
    if (cursorEl) cursorEl.remove();

    if (truncated) {
      const note = document.createElement("div");
      note.className = "studylens-status-note";
      note.textContent = "(ответ обрезан по лимиту токенов)";
      setImp(note, {
        margin: "6px 0 0",
        font: "11px/1.4 system-ui, sans-serif",
        color: "#999999",
      });
      panelEl.appendChild(note);
      scrollToBottom();
    }
  };

  const showError = (error) => {
    createPanel();
    streaming = false;
    if (cancelBtn) setImp(cancelBtn, { display: "none" });
    bodyTextEl.textContent = error;
    setImp(bodyTextEl, { color: "#f87171" });
  };

  const showCanceled = () => {
    if (!panelEl) return;
    streaming = false;
    if (cancelBtn) setImp(cancelBtn, { display: "none" });
    if (cursorEl) cursorEl.remove();
    const note = document.createElement("div");
    note.className = "studylens-status-note";
    note.textContent = "(отменено)";
    setImp(note, {
      margin: "6px 0 0",
      font: "11px/1.4 system-ui, sans-serif",
      color: "#999999",
    });
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