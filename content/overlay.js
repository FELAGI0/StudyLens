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

  console.log(
    "rect el created:",
    selection.tagName,
    selection.className,
    selection.style.cssText
  );
  console.log("rect el in DOM:", document.contains(selection));
  console.log(
    "rect el computed:",
    JSON.stringify({
      position: getComputedStyle(selection).position,
      display: getComputedStyle(selection).display,
      zIndex: getComputedStyle(selection).zIndex,
      border: getComputedStyle(selection).borderTopWidth,
      background: getComputedStyle(selection).backgroundColor,
      visibility: getComputedStyle(selection).visibility,
      opacity: getComputedStyle(selection).opacity,
    })
  );

  let startX = 0;
  let startY = 0;
  let dragging = false;

  const STATUS_ID = "studylens-status";
  const STATUS_STYLE_ID = "studylens-status-style";

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
      "#studylens-status .studylens-status-text{white-space:pre-wrap;word-break:break-word;}",
    ].join("");
    document.documentElement.appendChild(style);
  };

  const removeStatus = () => {
    const el = document.getElementById(STATUS_ID);
    if (el) el.remove();
  };

  const addCloseButton = (box) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "\u00d7";
    setImp(btn, {
      "flex": "0 0 auto",
      "margin": "0",
      "padding": "0",
      "background": "transparent",
      "border": "none",
      "color": "#bbbbbb",
      "font": "16px/1 system-ui, sans-serif",
      "font-weight": "700",
      "cursor": "pointer",
      "pointer-events": "auto",
    });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeStatus();
    });
    box.appendChild(btn);
  };

  const createStatus = () => {
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
      "box-sizing": "border-box",
      display: "flex",
      gap: "8px",
      "align-items": "flex-start",
      "text-align": "left",
      "pointer-events": "auto",
    });
    document.documentElement.appendChild(box);
    return box;
  };

  const startAnalysis = (base64) => {
    const box = createStatus();
    const text = document.createElement("div");
    text.className = "studylens-status-text";
    text.textContent = "Analyzing";
    const dots = document.createElement("span");
    dots.className = "studylens-dots";
    text.appendChild(dots);
    box.appendChild(text);
    chrome.runtime.sendMessage({ type: "analyze-image", base64 });
  };

  const showResult = (fullText) => {
    const box = document.getElementById(STATUS_ID) || createStatus();
    box.textContent = "";
    const text = document.createElement("div");
    text.className = "studylens-status-text";
    text.textContent =
      fullText.length > 200 ? fullText.slice(0, 200) + "..." : fullText;
    box.appendChild(text);
    addCloseButton(box);
  };

  const showError = (error) => {
    const box = document.getElementById(STATUS_ID) || createStatus();
    box.textContent = "";
    const text = document.createElement("div");
    text.className = "studylens-status-text";
    text.textContent = error;
    setImp(text, { color: "#f87171" });
    box.appendChild(text);
    addCloseButton(box);
  };

  // Listener живёт до первого ответа analysis-*, потом снимается,
  // чтобы не копились при повторных захватах
  const onMessage = (msg) => {
    if (!msg) return;
    if (msg.type === "captured-image") {
      startAnalysis(msg.base64);
      return;
    }
    if (msg.type === "analysis-result") {
      showResult(msg.text);
      chrome.runtime.onMessage.removeListener(onMessage);
      return;
    }
    if (msg.type === "analysis-error") {
      showError(msg.error);
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

    console.log(
      "indicator styles:",
      JSON.stringify({
        width: getComputedStyle(indicator).width,
        height: getComputedStyle(indicator).height,
        position: getComputedStyle(indicator).position,
        display: getComputedStyle(indicator).display,
        left: getComputedStyle(indicator).left,
        top: getComputedStyle(indicator).top,
        transform: getComputedStyle(indicator).transform,
      })
    );

    console.log(
      "updateBox:",
      left,
      top,
      width,
      height,
      selection.style.getPropertyValue("width"),
      selection.style.getPropertyPriority("width")
    );
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