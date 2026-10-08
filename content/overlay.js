(() => {
  const OVERLAY_ID = "studylens-overlay";
  const MIN_SIZE = 5;

  // Пока оверлей на экране, повторный хоткей - no-op.
  // Удалять старый узел нельзя: его document-листенеры остались бы
  // висеть и mouseup ушёл бы в background дважды
  if (document.getElementById(OVERLAY_ID)) return;

  const Z_BACKDROP = "2147483646";
  const Z_TOP = "2147483647";

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  // Критичные свойства дублируем inline: CSS может не инжектиться,
  // а сайт - перебить его с !important
  overlay.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    "width:100vw",
    "height:100vh",
    "margin:0",
    "padding:0",
    "background:rgba(0,0,0,0.3)",
    "cursor:crosshair",
    "user-select:none",
    "-webkit-user-select:none",
    "pointer-events:auto",
    "z-index:" + Z_BACKDROP,
  ].join(";");

  const selection = document.createElement("div");
  selection.className = "studylens-selection";
  selection.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    "width:0",
    "height:0",
    "box-sizing:border-box",
    "border:1px solid #4a9eff",
    "background:rgba(74,158,255,0.15)",
    "pointer-events:none",
    "z-index:" + Z_TOP,
  ].join(";");

  const indicator = document.createElement("div");
  indicator.className = "studylens-indicator";
  indicator.style.cssText = [
    "position:fixed",
    "padding:1px 4px",
    "font:11px/1.4 monospace",
    "white-space:nowrap",
    "background:#000",
    "color:#fff",
    "pointer-events:none",
    "z-index:" + Z_TOP,
  ].join(";");

  overlay.appendChild(selection);
  overlay.appendChild(indicator);
  document.documentElement.appendChild(overlay);

  console.log("overlay: root created", overlay.id, overlay.className);
  console.log(
    "overlay: rect element",
    selection.id,
    selection.className,
    selection.tagName
  );

  let startX = 0;
  let startY = 0;
  let dragging = false;

  const onMessage = (msg) => {
    if (!msg || msg.type !== "captured-image") return;
    console.log("captured image length:", msg.base64.length);
    chrome.runtime.onMessage.removeListener(onMessage);
  };
  chrome.runtime.onMessage.addListener(onMessage);

  const updateBox = (x, y) => {
    const left = Math.min(x, startX);
    const top = Math.min(y, startY);
    const width = Math.abs(x - startX);
    const height = Math.abs(y - startY);

    // setProperty с important: inline-important бьёт и наш CSS !important,
    // и правила сайта, поэтому рамку не заглушить со стороны страницы
    selection.style.setProperty("left", left + "px", "important");
    selection.style.setProperty("top", top + "px", "important");
    selection.style.setProperty("width", width + "px", "important");
    selection.style.setProperty("height", height + "px", "important");

    indicator.style.setProperty("left", left + width + "px", "important");
    indicator.style.setProperty("top", top + height + "px", "important");
    indicator.textContent = `${Math.round(width)} x ${Math.round(height)}`;

    console.log("overlay: mousemove rect=", left, top, width, height);
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