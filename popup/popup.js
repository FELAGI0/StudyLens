const DEFAULT_BASE_URL = "https://tokify.sale/v1";
const DEFAULT_MODEL = "gpt-6-sol";
const DEFAULT_BACKEND_URL = "https://study-lens-backend.onrender.com";

// 1x1 прозрачный PNG для проверки ключа
const TEST_IMAGE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const $tabOwnKey = document.getElementById("tab-own-key");
const $tabPassword = document.getElementById("tab-password");
const $formOwnKey = document.getElementById("form-own-key");
const $formPassword = document.getElementById("form-password");

const $apiKey = document.getElementById("apiKey");
const $baseUrl = document.getElementById("baseUrl");
const $model = document.getElementById("model");
const $saveOwnKey = document.getElementById("save-own-key");
const $testOwnKey = document.getElementById("test-own-key");

const $backendPassword = document.getElementById("backendPassword");
const $savePassword = document.getElementById("save-password");
const $testPassword = document.getElementById("test-password");

const $result = document.getElementById("result");
const $defaultMode = document.getElementById("defaultMode");

let mode = "own-key";

function setResult(text, kind) {
  $result.textContent = text;
  $result.className = kind || "";
}

function applyMode(next) {
  mode = next;
  $tabOwnKey.classList.toggle("active", mode === "own-key");
  $tabPassword.classList.toggle("active", mode === "password");
  $formOwnKey.classList.toggle("hidden", mode !== "own-key");
  $formPassword.classList.toggle("hidden", mode !== "password");
  setResult("", "");
}

async function loadSettings() {
  const stored = await chrome.storage.local.get([
    "mode",
    "apiKey",
    "baseUrl",
    "model",
    "backendPassword",
    "backendUrl",
    "defaultMode",
  ]);
  $apiKey.value = stored.apiKey || "";
  $baseUrl.value = stored.baseUrl || DEFAULT_BASE_URL;
  $model.value = stored.model || DEFAULT_MODEL;
  $backendPassword.value = stored.backendPassword || "";
  $defaultMode.value = stored.defaultMode || "explain";
  applyMode(stored.mode === "password" ? "password" : "own-key");
}

$defaultMode.addEventListener("change", async () => {
  await chrome.storage.local.set({ defaultMode: $defaultMode.value });
  setResult("Режим сохранён", "ok");
});

$tabOwnKey.addEventListener("click", async () => {
  applyMode("own-key");
  await chrome.storage.local.set({ mode: "own-key" });
});

$tabPassword.addEventListener("click", async () => {
  applyMode("password");
  await chrome.storage.local.set({ mode: "password" });
});

$saveOwnKey.addEventListener("click", async () => {
  await chrome.storage.local.set({
    mode: "own-key",
    apiKey: $apiKey.value.trim(),
    baseUrl: $baseUrl.value.trim() || DEFAULT_BASE_URL,
    model: $model.value.trim() || DEFAULT_MODEL,
  });
  setResult("Сохранено", "ok");
});

$savePassword.addEventListener("click", async () => {
  await chrome.storage.local.set({
    mode: "password",
    backendPassword: $backendPassword.value.trim(),
    backendUrl: DEFAULT_BACKEND_URL,
  });
  setResult("Сохранено", "ok");
});

// Проверка идёт по текущим значениям полей, чтобы можно было
// проверить до сохранения
$testOwnKey.addEventListener("click", async () => {
  const apiKey = $apiKey.value.trim();
  const baseUrl = $baseUrl.value.trim() || DEFAULT_BASE_URL;
  const model = $model.value.trim() || DEFAULT_MODEL;

  if (!apiKey) {
    setResult("Ошибка: введите API key", "err");
    return;
  }

  setResult("Проверка...", "");

  try {
    const text = await testKey(apiKey, baseUrl, model);
    setResult("OK: " + text.slice(0, 200), "ok");
  } catch (err) {
    setResult("Ошибка: " + err.message, "err");
  }
});

$testPassword.addEventListener("click", async () => {
  const password = $backendPassword.value.trim();

  if (!password) {
    setResult("Ошибка: введите пароль", "err");
    return;
  }

  setResult("Проверка...", "");

  try {
    await testPasswordBackend(password);
    setResult("Пароль принят", "ok");
  } catch (err) {
    setResult(err.message, "err");
  }
});

async function testKey(apiKey, baseUrl, model) {
  const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

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
              { type: "text", text: "Reply with one word: OK" },
              {
                type: "image_url",
                image_url: {
                  url: "data:image/png;base64," + TEST_IMAGE_BASE64,
                },
              },
            ],
          },
        ],
        max_tokens: 64,
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
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error("Empty response from API");
    return text;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function testPasswordBackend(password) {
  const url = DEFAULT_BACKEND_URL.replace(/\/+$/, "") + "/api/verify";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password }),
        signal: controller.signal,
      });
    } catch (netErr) {
      throw new Error("Сервер недоступен");
    }

    if (response.status === 401) throw new Error("Неверный пароль");
    if (!response.ok) throw new Error("Сервер недоступен");

    const data = await response.json();
    if (!data || data.ok !== true) throw new Error("Неверный пароль");
    return true;
  } finally {
    clearTimeout(timeoutId);
  }
}

loadSettings();