# DUBlicat

## О проекте

DUBlicat - это мощный инструмент для мониторинга и анализа изображений в Telegram-каналах. Программа автоматически сканирует указанные каналы, выявляет дубликаты изображений и позволяет отслеживать распространение контента между различными источниками.

## Ключевые возможности

- 🔍 **Сканирование каналов Telegram** — мониторинг публикаций в реальном времени или загрузка истории
- 🖼️ **Анализ изображений** — использование хеширования для выявления дубликатов даже при незначительных изменениях
- 📊 **База данных изображений** — хранение и индексация всех обнаруженных изображений для быстрого поиска
- 🔄 **Отслеживание дубликатов** — выявление идентичного контента в разных каналах
- 📱 **Прямой доступ к Telegram API** — работа как через MTProto, так и через прямые API-запросы

## Применение

- Мониторинг распространения контента между Telegram-каналами
- Выявление источников оригинального контента
- Анализ скорости и путей распространения информации
- Обнаружение ботов и автоматических репостеров
- Отслеживание использования авторского контента

## Технологии

Проект разработан на JavaScript/Node.js с использованием:
- Telegram API (MTProto)
- SQLite для хранения данных
- Алгоритмы хеширования изображений
- Асинхронная обработка данных

## Начало работы

1. Клонировать репозиторий
2. Установить зависимости: `npm install`
3. Скопировать `.env.example` в `.env` и настроить параметры
4. Запустить приложение: `node index.js` или использовать `start.bat` (для Windows)

## Требования

- Node.js версии 14 или выше
- Доступ к Telegram API (api_id и api_hash)
- Подключение к интернету для доступа к Telegram

## Лицензия

Проект распространяется под лицензией MIT. См. файл LICENSE для получения подробной информации.

## Особенности

- **Поддержка различных методов хеширования**: pHash, dHash и blockHash
- **Настройка порога схожести**: контроль чувствительности при определении дубликатов
- **Сканирование каналов**: возможность сканирования любого канала Telegram
- **Множественные методы доступа к API**: выбор оптимального способа получения сообщений из каналов
- **Генерация отчетов**: создание подробных отчетов о найденных дубликатах

## Установка

1. Клонируйте репозиторий:
   ```
   git clone https://github.com/yourusername/telegram-image-bot.git
   cd telegram-image-bot
   ```

2. Установите зависимости:
   ```
   npm install
   ```

3. Создайте файл `.env` на основе шаблона `env.example`:
   ```
   cp env.example .env
   ```

4. Заполните файл `.env` своими данными:
   - `TELEGRAM_BOT_TOKEN`: Токен вашего бота (получить у [@BotFather](https://t.me/BotFather))
   - `CHANNEL_ID`: ID канала для сканирования по умолчанию
   - `HASH_DIFFERENCE_THRESHOLD`: Порог различия хешей (от 0 до 100)
   - `API_ID` и `API_HASH`: Данные для доступа к MTProto API (получить в [my.telegram.org/apps](https://my.telegram.org/apps))

## Методы доступа к API Telegram

Бот поддерживает несколько методов для получения истории сообщений из каналов:

1. **Bot API** (botapi): Стандартный метод, но с ограничениями - не может получить старые сообщения, только новые. Требует, чтобы бот был администратором канала.

2. **MTProto API через gramjs** (gramjs): Полный доступ к истории сообщений, включая старые. Требует `API_ID` и `API_HASH`. При первом запуске потребуется авторизация через номер телефона.

3. **MTProto API через @mtproto/core** (mtprotocore): Альтернативная реализация MTProto API. Также требует авторизации и доступа к `API_ID` и `API_HASH`.

Вы можете выбрать метод при вызове команды `/scan_channel`, например:
```
/scan_channel {id канала} 1000 gramjs
```

Или позволить боту автоматически выбрать оптимальный метод:
```
/scan_channel {id канала} 1000 auto
```

## Команды бота

- `/start` - Запуск бота и приветственное сообщение
- `/help` - Показать список доступных команд
- `/status` - Показать статистику базы данных
- `/scan_channel` - Сканировать канал по умолчанию (указанный в .env)
- `/scan_channel {ID} {limit} {method}` - Сканировать указанный канал
  - `{ID}` - ID канала (например, -1001234567890)
  - `{limit}` - Максимальное количество сообщений для обработки
  - `{method}` - Метод доступа к API (auto, botapi, gramjs, mtprotocore)
- `/generate_report` - Создать отчет о похожих изображениях
- `/set_threshold {value}` - Установить порог сходства (от 0 до 100)
- `/clear` - Очистить базу данных изображений

## Запуск

```
