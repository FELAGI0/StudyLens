const DEFAULT_BASE_URL = "http://185.221.214.224:4100/v1";
const DEFAULT_MODEL = "gpt-5.6-luna";

// 1x1 прозрачный PNG для проверки ключа
const TEST_IMAGE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const $apiKey = document.getElementById("apiKey");
const $baseUrl = document.getElementById("baseUrl");
const $model = document.getElementById("model");
const $save = document.getElementById("save");
const $test = document.getElementById("test");
const $result = document.getElementById("result");

async function loadSettings() {
  const stored = await chrome.storage.local.get(["apiKey", "baseUrl", "model"]);
  $apiKey.value = stored.apiKey || "";
  $baseUrl.value = stored.baseUrl || DEFAULT_BASE_URL;
  $model.value = stored.model || DEFAULT_MODEL;
}

function setResult(text, kind) {
  $result.textContent = text;
  $result.className = kind || "";
}

$save.addEventListener("click", async () => {
  await chrome.storage.local.set({
    apiKey: $apiKey.value.trim(),
    baseUrl: $baseUrl.value.trim() || DEFAULT_BASE_URL,
    model: $model.value.trim() || DEFAULT_MODEL,
  });
  setResult("Сохранено", "ok");
});

// Проверка идёт по текущим значениям полей, чтобы можно было
// проверить ключ до сохранения
$test.addEventListener("click", async () => {
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
        max_tokens: 16,
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

loadSettings();