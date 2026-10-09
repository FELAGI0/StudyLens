# StudyLens

Расширение для Chrome. Выделяешь область экрана с задачей, получаешь объяснение решения.

## Установка

1. Открыть chrome://extensions
2. Включить режим разработчика
3. Load unpacked, выбрать папку проекта

## Использование

Нажми Ctrl+Shift+E на нужной вкладке. Появится затемнение, выдели мышью
область с задачей. После отпускания кнопки ответ появится в панели справа
сверху и будет дописываться по мере генерации. Esc или выделение меньше 5x5
отменяет захват.

Режимы ответа и их горячие клавиши:

- Ctrl+Shift+E - Объясни
- Ctrl+Shift+K - Кратко
- Ctrl+Shift+P - Пошагово
- Ctrl+Shift+T - Переведи
- Ctrl+Shift+F - Найди ошибку (назначается вручную, Chrome ограничивает до 4 автоматических хоткеев)

## Стек

Manifest V3, чистый JS. API совместим с OpenAI Chat Completions. Рендер
Markdown через marked, санитайз через DOMPurify, формулы через KaTeX.

## Лицензия

MIT

## Публикация в Chrome Web Store

Чеклист перед публикацией:

1. Privacy Policy - PRIVACY.md (опубликовать через GitHub Pages)
2. Скриншоты - 1280x800 или 640x400, минимум 3-5 штук
3. Иконки - 16, 32, 48, 128 px
4. Описание - STORE_DESCRIPTION.md
5. Zip-архив расширения
6. Регистрация разработчика Chrome Web Store ($5)
7. Загрузка через Developer Dashboard

Ссылки:
- Chrome Web Store Developer Dashboard: https://chrome.google.com/webstore/devconsole
- Privacy Policy URL: будет после настройки GitHub Pages