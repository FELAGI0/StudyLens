console.log("StudyLens background loaded");

const PROMPTS = {
  explain: {
    title: "Объясни",
    shortcut: "Ctrl+Shift+E",
    system: `Ты образовательный ассистент. Пользователь присылает скриншот учебного материала (задача, код, текст, схема, график). Разбери материал пошагово, объясни решение. Если это задача - дай ответ. Если тест с вариантами - обоснуй выбор. Отвечай на языке материала. Используй Markdown и LaTeX где уместно. Будь подробным, но если чувствуешь что приближаешься к лимиту - заверши текущую мысль и дай финальный ответ.`,
  },
  short: {
    title: "Кратко",
    shortcut: "Ctrl+Shift+K",
    system: `Ты образовательный ассистент. Пользователь присылает скриншот. Дай ТОЛЬКО краткий ответ без объяснений, без шагов решения, без воды. Одна-две строки максимум. Если это тест - просто буква правильного варианта. Если задача - только финальный ответ.`,
  },
  detailed: {
    title: "Пошагово",
    shortcut: "Ctrl+Shift+P",
    system: `Ты образовательный ассистент. Пользователь присылает скриншот. Разбери МАКСИМАЛЬНО ПОДРОБНО: каждый шаг, каждое правило, с примерами и аналогиями. Объясняй так, как будто ученик видит тему впервые. Используй Markdown и LaTeX. Не торопись, разворачивай мысль.`,
  },
  translate: {
    title: "Переведи",
    shortcut: "Ctrl+Shift+T",
    system: `Ты переводчик. Пользователь присылает скриншот с текстом. Определи язык текста. Если текст не на русском - переведи на русский. Если на русском - переведи на английский. Сохрани структуру и форматирование. Если в тексте есть незнакомые термины - добавь краткое пояснение в скобках.`,
  },
  findbug: {
    title: "Найди ошибку",
    shortcut: "Ctrl+Shift+F",
    system: `Ты эксперт по поиску ошибок. Пользователь присылает скриншот кода, решения или текста. Найди все ошибки: синтаксические, логические, стилистические. Для каждой ошибки укажи:
1. Где именно (строка, фрагмент)
2. Что не так
3. Как исправить
Если ошибок нет - скажи об этом явно. Используй Markdown для форматирования.`,
  },
};

const DEFAULT_MODE = "explain";

const MAX_TOKENS = 8000;
const REQUEST_TIMEOUT_MS = 300000;
const CHUNK_FLUSH_MS = 90;

const DEFAULT_BASE_URL = "https://tokify.sale/v1";
const DEFAULT_MODEL = "gpt-6-sol";
const DEFAULT_BACKEND_URL = "https://study-lens-backend.onrender.com";

// Активные стримы по вкладке: нужны, чтобы отменять запрос и не запускать
// два параллельно на одной и той же странице
const activeStreams = new Map();

// Режим, выбранный хоткеем для конкретной вкладки, до момента отправки запроса
const pendingModes = new Map();

chrome.commands.onCommand.addListener((command, tab) => {
  const mode = command.replace(/^capture-/, "");
  if (!PROMPTS[mode]) return;
  startCapture(tab, mode);
});

async function startCapture(tab, mode) {
  // onCommand не гарантирует tab и не даёт url без host-доступа, поэтому тянем сами
  if (!tab || !tab.id) {
    tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  }
  if (!tab || !tab.id) return;
  const tabId = tab.id;

  pendingModes.set(tabId, mode);

  await injectLibraries(tabId);

  // CSS и JS инжектим независимо: сбой стилей не должен блокировать оверлей
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content/overlay.css"],
    });
  } catch (err) {
    console.error("insertCSS failed:", err.message);
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/overlay.js"],
    });
  } catch (err) {
    console.error("cannot inject here:", err.message);
  }

  // сообщаем оверлею режим для заголовка; если оверлей уже висит с прошлого
  // хоткея, его живой listener обновит режим
  chrome.tabs
    .sendMessage(tabId, { type: "set-mode", mode, title: PROMPTS[mode].title })
    .catch(() => {});
}

// Библиотеки грузим через executeScript, а не <script src>: <script> попал бы
// в main world страницы, а оверлей живёт в изолированном мире со своим
// globalThis и библиотек бы не увидел
async function injectLibraries(tabId) {
  const files = [
    "lib/marked.min.js",
    "lib/purify.min.js",
    "lib/katex/katex.min.js",
  ];
  for (const file of files) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: [file],
      });
    } catch (err) {
      console.error("lib inject failed:", file, err.message);
    }
  }

  try {
    const fontsBase = chrome.runtime.getURL("lib/katex/fonts/");
    const raw = await (
      await fetch(chrome.runtime.getURL("lib/katex/katex.min.css"))
    ).text();
    // url(fonts/...) в CSS резолвятся от корня расширения, а не от самого
    // файла css, поэтому переписываем пути на абсолютные
    const css = raw.replace(/url\(fonts\//g, "url(" + fontsBase);
    await chrome.scripting.insertCSS({ target: { tabId }, css });
  } catch (err) {
    console.error("katex css inject failed:", err.message);
  }
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg) return;

  if (msg.type === "analyze-image") {
    const tabId = sender.tab && sender.tab.id;
    const explicit =
      msg.mode && PROMPTS[msg.mode]
        ? msg.mode
        : tabId && pendingModes.get(tabId);
    if (tabId) pendingModes.delete(tabId);
    handleAnalyze(msg.base64, sender.tab, explicit);
    return;
  }

  if (msg.type === "cancel-analysis") {
    const controller = activeStreams.get(sender.tab && sender.tab.id);
    if (controller) controller.abort();
    return;
  }

  if (msg.type === "area-selected") {
    handleSelection(msg.rect, sender.tab);
  }
});

// Приоритет: явный режим от оверлея, затем режим хоткея, затем defaultMode из настроек
async function resolveMode(explicitMode) {
  if (explicitMode && PROMPTS[explicitMode]) return explicitMode;
  const stored = await chrome.storage.local.get("defaultMode");
  if (stored.defaultMode && PROMPTS[stored.defaultMode]) return stored.defaultMode;
  return DEFAULT_MODE;
}

async function handleAnalyze(base64Image, tab, explicitMode) {
  if (!tab || !tab.id) return;
  const tabId = tab.id;
  const mode = await resolveMode(explicitMode);
  const prompt = (PROMPTS[mode] || PROMPTS[DEFAULT_MODE]).system;

  if (activeStreams.has(tabId)) activeStreams.get(tabId).abort();
  const controller = new AbortController();
  activeStreams.set(tabId, controller);

  const send = (payload) => chrome.tabs.sendMessage(tabId, payload).catch(() => {});

  // Каналу вредно гонять по букве: копим чанки и отдаём пачками раз в CHUNK_FLUSH_MS,
  // хвост принудительно досылаем на конце стрима
  let buffer = "";
  let timer = null;
  let closed = false;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!buffer) return;
    const text = buffer;
    buffer = "";
    send({ type: "analysis-chunk", text });
  };

  const scheduleFlush = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, CHUNK_FLUSH_MS);
  };

  const finishUp = () => {
    if (closed) return;
    closed = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    activeStreams.delete(tabId);
  };

  const onChunk = (text) => {
    if (!text) return;
    buffer += text;
    scheduleFlush();
  };

  const onEnd = (finishReason) => {
    flush();
    finishUp();
    send({
      type: "analysis-end",
      truncated: finishReason === "length" || finishReason === "max_tokens",
    });
  };

  const onError = (message) => {
    finishUp();
    send({ type: "analysis-error", error: message });
  };

  await send({ type: "analysis-start" });
  await callAPIStream(base64Image, prompt, onChunk, onEnd, onError, controller);

  if (controller.signal.aborted && !closed) {
    buffer = "";
    finishUp();
    send({ type: "analysis-canceled" });
  }
}

async function callAPIStream(
  base64Image,
  userPrompt,
  onChunk,
  onEnd,
  onError,
  externalController
) {
  const stored = await chrome.storage.local.get([
    "mode",
    "apiKey",
    "baseUrl",
    "model",
    "backendPassword",
    "backendUrl",
  ]);
  const mode = stored.mode || "own-key";

  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: userPrompt },
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64," + base64Image },
        },
      ],
    },
  ];

  let url;
  let headers;
  let body;

  if (mode === "password") {
    const password = stored.backendPassword;
    const backendUrl = stored.backendUrl || DEFAULT_BACKEND_URL;
    if (!password) {
      onError("Пароль не задан. Откройте настройки расширения.");
      return;
    }
    url = backendUrl.replace(/\/+$/, "") + "/api/analyze";
    headers = { "Content-Type": "application/json" };
    body = JSON.stringify({ password: password, messages: messages });
  } else {
    const apiKey = stored.apiKey;
    const baseUrl = stored.baseUrl || DEFAULT_BASE_URL;
    const model = stored.model || DEFAULT_MODEL;
    if (!apiKey) {
      onError("API key not set. Open extension popup and enter it.");
      return;
    }
    url = baseUrl.replace(/\/+$/, "") + "/chat/completions";
    headers = {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
    };
    body = JSON.stringify({
      model: model,
      messages: messages,
      max_tokens: MAX_TOKENS,
      stream: true,
    });
  }

  const controller = externalController || new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: headers,
      body: body,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (timedOut) onError("Превышено время ожидания ответа.");
    else if (!controller.signal.aborted) onError(connectionErrorMessage(mode));
    return;
  }

  if (!response.ok) {
    clearTimeout(timeoutId);
    const errText = await response.text().catch(() => "");
    onError(httpErrorMessage(response.status, errText, mode));
    return;
  }

  if (!response.body) {
    clearTimeout(timeoutId);
    onError("Пустой ответ от сервера.");
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let finishReason;
  let streamError;

  const processEvent = (rawEvent) => {
    for (const line of rawEvent.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (!payload) continue;
      if (payload === "[DONE]") return true;

      let obj;
      try {
        obj = JSON.parse(payload);
      } catch (e) {
        continue;
      }

      if (obj && obj.error) {
        streamError =
          typeof obj.error === "string" ? obj.error : JSON.stringify(obj.error);
        return true;
      }

      const { text, finish } = extractContent(obj);
      if (finish) finishReason = finish;
      if (text) onChunk(text);
    }
    return false;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      pending += decoder.decode(value, { stream: true });
      pending = pending.replace(/\r\n/g, "\n");

      let idx;
      while ((idx = pending.indexOf("\n\n")) !== -1) {
        const rawEvent = pending.slice(0, idx);
        pending = pending.slice(idx + 2);
        if (processEvent(rawEvent)) {
          clearTimeout(timeoutId);
          if (streamError) onError(streamError);
          else onEnd(finishReason);
          return;
        }
      }
    }

    // хвост без завершающего \n\n
    if (pending.trim()) {
      if (processEvent(pending)) {
        clearTimeout(timeoutId);
        if (streamError) onError(streamError);
        else onEnd(finishReason);
        return;
      }
    }

    clearTimeout(timeoutId);
    onEnd(finishReason);
  } catch (err) {
    clearTimeout(timeoutId);
    if (timedOut) onError("Превышено время ожидания ответа.");
    else if (!controller.signal.aborted) onError(connectionErrorMessage(mode));
  }
}

// Поддерживаем оба формата: OpenAI (choices[].delta.content) и
// Anthropic (content_block_delta.delta.text), backend может вернуть любой
function extractContent(obj) {
  const choice = obj && obj.choices && obj.choices[0];
  if (choice) {
    if (typeof choice.delta?.content === "string") {
      return { text: choice.delta.content, finish: choice.finish_reason };
    }
    if (typeof choice.message?.content === "string") {
      return { text: choice.message.content, finish: choice.finish_reason };
    }
    if (choice.finish_reason) return { text: "", finish: choice.finish_reason };
  }

  if (obj && obj.type === "content_block_delta" && typeof obj.delta?.text === "string") {
    return { text: obj.delta.text };
  }
  if (obj && typeof obj.delta?.text === "string") {
    return { text: obj.delta.text };
  }
  if (obj && obj.type === "message_delta" && obj.delta?.stop_reason) {
    return { text: "", finish: obj.delta.stop_reason };
  }

  return { text: "" };
}

function httpErrorMessage(status, errText, mode) {
  if (mode === "password") {
    if (status === 401) return "Неверный пароль. Откройте настройки расширения.";
    if (status === 429) return "Слишком много запросов. Подождите минуту.";
    if (status >= 500) return "Ошибка сервера StudyLens. Попробуйте позже.";
    return "Ошибка StudyLens " + status + ": " + errText.slice(0, 200);
  }
  if (status === 401) return "Invalid API key (401)";
  if (status === 429) return "Rate limit (429)";
  return "API error " + status + ": " + errText.slice(0, 200);
}

function connectionErrorMessage(mode) {
  if (mode === "password") {
    return "Сервер StudyLens недоступен. Проверьте подключение.";
  }
  return "Не удалось подключиться к API. Проверьте подключение.";
}

async function handleSelection(rect, tab) {
  if (!tab || !tab.id) return;

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "png" });
    const base64 = await cropDataUrl(dataUrl, rect);
    await chrome.tabs.sendMessage(tab.id, { type: "captured-image", base64 });
  } catch (err) {
    console.error("capture failed:", err.message);
  }
}

async function cropDataUrl(dataUrl, rect) {
  const dpr = rect.dpr || 1;
  const sx = Math.round(rect.x * dpr);
  const sy = Math.round(rect.y * dpr);
  const sw = Math.round(rect.width * dpr);
  const sh = Math.round(rect.height * dpr);

  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close();

  const outBlob = await canvas.convertToBlob({ type: "image/png" });
  return arrayBufferToBase64(await outBlob.arrayBuffer());
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}