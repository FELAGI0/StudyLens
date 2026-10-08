(() => {
  const OVERLAY_ID = "studylens-overlay";
  const MIN_SIZE = 5;

  // Пока оверлей на экране, повторный хоткей - no-op.
  // Удалять старый узел нельзя: его document-листенеры остались бы
  // висеть и mouseup ушёл бы в background дважды
  if (document.getElementById(OVERLAY_ID)) return;

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;

  const selection = document.createElement("div");
  selection.className = "studylens-selection";

  const indicator = document.createElement("div");
  indicator.className = "studylens-indicator";

  selection.appendChild(indicator);
  overlay.appendChild(selection);
  document.documentElement.appendChild(overlay);

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

    selection.style.left = left + "px";
    selection.style.top = top + "px";
    selection.style.width = width + "px";
    selection.style.height = height + "px";

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