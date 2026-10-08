console.log("StudyLens background loaded");

const SYSTEM_PROMPT =
  "Ты образовательный ассистент. Пользователь присылает скриншот учебного материала (задача, код, текст, схема, график). Разбери материал пошагово, объясни решение. Если это задача - дай ответ. Если тест с вариантами - обоснуй выбор. Отвечай на языке материала. Используй Markdown и LaTeX где уместно. Будь подробным, но если чувствуешь что приближаешься к лимиту - заверши текущую мысль и дай финальный ответ, не обрывайся на середине.";

const MAX_TOKENS = 8000;
const REQUEST_TIMEOUT_MS = 300000;

const DEFAULT_BASE_URL = "http://185.221.214.224:4100/v1";
const DEFAULT_MODEL = "gpt-5.6-luna";

chrome.commands.onCommand.addListener((command, tab) => {
  console.log("command received:", command);
  if (command !== "capture-area") return;
  startCapture(tab);
});

async function startCapture(tab) {
  // onCommand не гарантирует tab и не даёт url без host-доступа, поэтому тянем сами
  if (!tab || !tab.id) {
    tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  }
  console.log("startCapture for tab:", tab && tab.id, tab && tab.url);
  if (!tab || !tab.id) return;

  console.log("injecting overlay...");
  // CSS и JS инжектим независимо: сбой стилей не должен блокировать оверлей
  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["content/overlay.css"],
    });
  } catch (err) {
    console.log("insertCSS error:", err.message);
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/overlay.js"],
    });
    console.log("inject done");
  } catch (err) {
    console.log("inject error:", err.message, err.stack);
    console.log("cannot inject here");
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "analyze-image") {
    handleAnalyze(msg.base64, sender.tab);
    return;
  }
  if (!msg || msg.type !== "area-selected") return;
  handleSelection(msg.rect, sender.tab);
});

async function handleAnalyze(base64Image, tab) {
  if (!tab || !tab.id) return;
  try {
    const { text, finishReason } = await callAPI(base64Image, SYSTEM_PROMPT);
    await chrome.tabs.sendMessage(tab.id, {
      type: "analysis-result",
      text,
      truncated: finishReason === "length",
    });
  } catch (err) {
    await chrome.tabs.sendMessage(tab.id, {
      type: "analysis-error",
      error: err.message,
    });
  }
}

async function callAPI(base64Image, userPrompt) {
  const stored = await chrome.storage.local.get(["apiKey", "baseUrl", "model"]);
  const apiKey = stored.apiKey;
  const baseUrl = stored.baseUrl || DEFAULT_BASE_URL;
  const model = stored.model || DEFAULT_MODEL;

  if (!apiKey) {
    throw new Error("API key not set. Open extension popup and enter it.");
  }

  const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model: model,
        messages: [
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
        ],
        max_tokens: MAX_TOKENS,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      if (response.status === 401) throw new Error("Invalid API key (401)");
      if (response.status === 429) throw new Error("Rate limit (429)");
      throw new Error(
        "API error " + response.status + ": " + errText.slice(0, 200)
      );
    }

    const data = await response.json();
    const choice = data?.choices?.[0];
    const text = choice?.message?.content;
    if (!text) throw new Error("Empty response from API");
    return { text, finishReason: choice?.finish_reason };
  } finally {
    clearTimeout(timeoutId);
  }
}

// TODO(подэтап B): стриминг ответа через SSE (stream: true)
async function callAPIStream(base64Image, userPrompt) {
  throw new Error("callAPIStream not implemented");
}

async function handleSelection(rect, tab) {
  console.log("capture: rect=" + JSON.stringify(rect));
  if (!tab || !tab.id) return;

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "png" });
    const base64 = await cropDataUrl(dataUrl, rect);
    await chrome.tabs.sendMessage(tab.id, { type: "captured-image", base64 });
  } catch (err) {
    console.log("capture failed", err.message);
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