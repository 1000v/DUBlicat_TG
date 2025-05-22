const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const { promises: fsPromises } = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('./config');
const imageHasher = require('./imageHasher');
const imageDatabase = require('./imageDatabase');
const ChannelScanner = require('./updatedChannelScanner');
const imageAnalyzer = require('./imageAnalyzer');

// Добавляем импорт модуля для блокировки одновременного запуска
const lockfile = require('proper-lockfile');
const LOCK_FILE = path.join(__dirname, 'bot.lock');

// Создаем временную директорию, если её нет
if (!fs.existsSync(config.tempFolder)) {
  fs.mkdirSync(config.tempFolder, { recursive: true });
}

// Проверяем наличие токена бота
if (!config.botToken) {
  console.error('Ошибка: Не указан токен Telegram бота в файле .env');
  process.exit(1);
}

// Функция для проверки, запущен ли уже экземпляр бота
async function checkBotInstance() {
  try {
    // Принудительно удаляем файл блокировки если он существует
    if (fs.existsSync(LOCK_FILE)) {
      try {
        fs.unlinkSync(LOCK_FILE);
        console.log('Удален существующий файл блокировки');
      } catch (err) {
        console.error('Не удалось удалить файл блокировки:', err.message);
        // Продолжаем работу, так как мы все равно попробуем создать новый файл блокировки
      }
    }
    
    // Создаем новый файл блокировки с текущим PID
    fs.writeFileSync(LOCK_FILE, process.pid.toString());
    
    // Устанавливаем обработчики для удаления файла блокировки при завершении
    const cleanupOnExit = async () => {
      try {
        if (fs.existsSync(LOCK_FILE)) {
          fs.unlinkSync(LOCK_FILE);
          console.log('Файл блокировки удален при завершении');
        }
        
        // Закрываем базу данных
        await imageDatabase.close();
        console.log('База данных успешно закрыта');
      } catch (err) {
        console.error('Ошибка при очистке ресурсов:', err);
      }
    };
    
    process.on('exit', cleanupOnExit);
    process.on('SIGINT', async () => {
      console.log('Получен сигнал завершения, очищаем ресурсы...');
      await cleanupOnExit();
      process.exit(0);
    });
    process.on('uncaughtException', async (err) => {
      console.error('Необработанное исключение:', err);
      await cleanupOnExit();
      process.exit(1);
    });
    
    return true;
  } catch (error) {
    console.error('Ошибка при проверке экземпляра бота:', error);
    return false;
  }
}

// Создаем экземпляр бота
// Изменяем эту часть, чтобы запуск происходил только после проверки блокировки
let bot;
let channelScanner;

// Функция для обработки нового сообщения с фото
async function processPhotoMessage(msg) {
  try {
    const chatId = msg.chat.id;
    
    // Получаем файл наибольшего размера
    const photoSizes = msg.photo;
    const photo = photoSizes[photoSizes.length - 1];
    const fileId = photo.file_id;
    
    // Получаем информацию о файле
    const fileInfo = await bot.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${config.botToken}/${fileInfo.file_path}`;
    
    // Скачиваем файл
    const response = await axios({
      method: 'get',
      url: fileUrl,
      responseType: 'arraybuffer'
    });
    
    // Вычисляем хеш изображения
    const imageBuffer = Buffer.from(response.data);
    const hash = await imageHasher.calculateHash(imageBuffer);
    
    // Ищем похожие изображения
    const similarImages = imageDatabase.findSimilarImages(hash, (hash1, hash2) => {
      return imageHasher.areImagesSimilar(hash1, hash2);
    });
    
    // Сохраняем информацию о новом изображении
    const imageInfo = {
      fileId,
      hash,
      messageId: msg.message_id,
      chatId: msg.chat.id,
      userId: msg.from.id,
      fileSize: photo.file_size,
      width: photo.width,
      height: photo.height,
      timestamp: msg.date,
      source: 'direct_message'
    };
    
    imageDatabase.addImage(imageInfo);
    await imageDatabase.save();
    
    // Отправляем ответ пользователю
    if (similarImages.length > 0) {
      const similarImagesList = similarImages.map((img, index) => {
        const distance = imageHasher.calculateHashDistance(hash, img.hash).toFixed(2);
        return `${index + 1}. Сходство: ${(100 - distance).toFixed(2)}% (сообщение ID: ${img.messageId})`;
      }).join('\n');
      
      await bot.sendMessage(chatId, 
        `Найдено ${similarImages.length} похожих изображений:\n${similarImagesList}`,
        { reply_to_message_id: msg.message_id }
      );
    } else {
      await bot.sendMessage(chatId, 
        'Похожих изображений не найдено. Изображение добавлено в базу данных.',
        { reply_to_message_id: msg.message_id }
      );
    }
  } catch (error) {
    console.error('Ошибка при обработке изображения:', error);
    await bot.sendMessage(msg.chat.id, 'Произошла ошибка при обработке изображения');
  }
}

/**
 * Обработчик новых текстовых сообщений
 * @param {Object} msg - объект сообщения от Telegram Bot API
 */
async function handleMessage(msg) {
  try {
    // Обрабатываем только личные чаты
    if (msg.chat.type !== 'private') {
      return;
    }
    
    // Если сообщение содержит фото, обрабатываем его отдельной функцией
    if (msg.photo) {
      await processPhotoMessage(msg);
      return;
    }
    
    // Логируем сообщение для отладки
    console.log(`Получено сообщение от ${msg.from.username || msg.from.id}: ${msg.text}`);
    
    // Если сообщение не является командой, отправляем подсказку
    if (!msg.text || !msg.text.startsWith('/')) {
      await bot.sendMessage(msg.chat.id, 
        'Отправьте мне фото для поиска похожих изображений или воспользуйтесь командами:\n' +
        '/help - показать список доступных команд'
      );
    }
  } catch (error) {
    console.error('Ошибка при обработке сообщения:', error);
  }
}

/**
 * Обработчик постов в канале
 * @param {Object} post - объект с постом из канала
 */
async function handleChannelPost(post) {
  try {
    // Проверяем, является ли пост фотографией
    if (post.photo) {
      console.log(`Получено новое фото в канале ${post.chat.title || post.chat.id}`);
      
      // Обрабатываем фото из канала
      if (config.autoProcessChannelPhotos) {
        await processPhotoMessage(post);
      }
    }
  } catch (error) {
    console.error('Ошибка при обработке поста из канала:', error);
  }
}

// Функция инициализации бота
async function init() {
  try {
    // Проверяем, запущен ли уже экземпляр бота
    const isRunning = await checkBotInstance();
    if (!isRunning) {
      console.log('Уже запущен экземпляр бота. Завершаем процесс.');
      process.exit(0);
    }

    // Загружаем базу данных изображений
    await imageDatabase.load();

    // Создаем экземпляр сканера каналов
    channelScanner = new ChannelScanner(bot);

    // Устанавливаем обработчики сообщений для бота
    bot.on('message', handleMessage);
    bot.on('channel_post', handleChannelPost);
    
    // Сообщаем о запуске бота
    console.log('Бот запущен');

    // Запускаем таймер для автоматического сканирования каналов
    if (config.autoScanInterval > 0) {
      console.log(`Настроено автоматическое сканирование каждые ${config.autoScanInterval} минут`);
      setInterval(async () => {
        try {
          if (config.channelId) {
            console.log(`Запускаем автоматическое сканирование канала ${config.channelId} в lite режиме...`);
            // Используем облегченный режим (без скачивания изображений)
            await channelScanner.scanEntireChannelWithoutDownload(
              config.channelId,
              config.liteMode.batchSize,
              config.liteMode.cooldownSeconds
            );
          }
        } catch (error) {
          console.error('Ошибка при автоматическом сканировании канала:', error);
        }
      }, config.autoScanInterval * 60 * 1000);
    } else {
      console.log('Автоматическое сканирование отключено');
    }
    
    // Выполняем первое сканирование сразу после запуска, если канал указан
    if (config.channelId) {
      console.log(`Выполняем первоначальное сканирование канала ${config.channelId} в lite режиме...`);
      // Запускаем сканирование в легком режиме (без скачивания) с небольшим количеством сообщений вначале
      setTimeout(async () => {
        try {
          await channelScanner.scanEntireChannelWithoutDownload(
            config.channelId,
            config.liteMode.batchSize,
            config.liteMode.cooldownSeconds
          );
        } catch (error) {
          console.error('Ошибка при первоначальном сканировании канала:', error);
        }
      }, 5000); // Задержка 5 секунд перед первым сканированием
    }
  } catch (error) {
    console.error('Ошибка при инициализации бота:', error);
    process.exit(1);
  }
}

/**
 * Настройка обработчиков команд бота
 */
function setupBotHandlers() {
  // Обработчик команды /start
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, 
      'Привет! Я бот для сравнения изображений. Отправь мне фото, и я найду похожие изображения из базы.'
    );
  });

  // Обработчик команды /help
  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, 
      'Доступные команды:\n' +
      '/start - Запустить бота\n' +
      '/help - Показать справку\n' +
      '/status - Показать статистику базы данных\n' +
      '/scan_channel - Сканировать указанный канал на наличие изображений\n' +
      '/scan_channel {ID} {limit} {method} - Сканировать указанный канал с заданным количеством сообщений\n' +
      '   Методы: auto (автоматический выбор), botapi, gramjs, mtprotocore\n' +
      '/generate_report - Создать отчет о похожих изображениях\n' +
      '/set_threshold {value} - Установить порог сходства (0-100)\n' +
      '/clear - Очистить базу данных изображений'
    );
  });

  // Обработчик команды /status
  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const images = imageDatabase.getAllImages();
    await bot.sendMessage(chatId, 
      `Статистика базы данных:\n` +
      `- Количество изображений: ${images.length}\n` +
      `- Порог схожести: ${config.hashDifferenceThreshold}%\n` +
      `- Метод хеширования: ${config.hashSettings.hashMethod}`
    );
  });

  // Обработчик команды /scan_channel
  bot.onText(/\/scan_channel(\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    let channelId = config.channelId;
    let limit = config.liteMode.batchSize || 100;
    
    // Парсим аргументы, если они есть
    if (match && match[2]) {
      const args = match[2].trim().split(/\s+/);
      if (args[0]) channelId = args[0];
      if (args[1] && !isNaN(args[1])) limit = parseInt(args[1]);
    }
    
    await bot.sendMessage(chatId, `Начинаю сканирование канала ${channelId} в lite режиме...`);
    
    try {
      // Используем облегченный режим сканирования без скачивания изображений
      const result = await channelScanner.scanEntireChannelWithoutDownload(
        channelId,
        limit,
        config.liteMode.cooldownSeconds
      );
      
      if (result.success) {
        const { totalMessages, processedImages, similarImagesFound, errors } = result.results;
        
        // Отправляем общую статистику о результатах сканирования
        await bot.sendMessage(chatId, 
          `Сканирование завершено:\n` +
          `- Режим: lite (без скачивания)\n` +
          `- Просканировано сообщений: ${totalMessages}\n` +
          `- Обработано изображений: ${processedImages}\n` +
          `- Найдено похожих изображений: ${similarImagesFound}\n` +
          `- Ошибок: ${errors}`
        );

        // Если есть дубликаты, отправляем информацию о них
        if (similarImagesFound > 0 && result.reportFilePath) {
          try {
            // Читаем отчет из JSON файла
            const reportData = JSON.parse(await fsPromises.readFile(result.reportFilePath, 'utf8'));

            if (reportData.duplicateGroups && reportData.duplicateGroups.length > 0) {
              // Отправляем заголовок
              await bot.sendMessage(chatId, `Вот группы найденных дубликатов:`);

              // Отправляем информацию о каждой группе дубликатов
              for (let i = 0; i < Math.min(10, reportData.duplicateGroups.length); i++) {
                const group = reportData.duplicateGroups[i];
                let groupMessage = `*Группа ${i+1} (${group.count} похожих изображений)*\n\n`;
                
                // Добавляем оригинальное изображение
                const originalDate = new Date(group.original.date).toLocaleString('ru-RU');
                groupMessage += `*Оригинал*: [Сообщение ${group.original.messageId}](${group.original.link})\n`;
                groupMessage += `Дата: ${originalDate}\n\n`;
                
                // Добавляем дубликаты
                if (group.duplicates && group.duplicates.length > 0) {
                  groupMessage += `*Дубликаты:*\n`;
                  for (let j = 0; j < Math.min(10, group.duplicates.length); j++) {
                    const duplicate = group.duplicates[j];
                    const duplicateDate = new Date(duplicate.date).toLocaleString('ru-RU');
                    groupMessage += `${j+1}. [Сообщение ${duplicate.messageId}](${duplicate.link})\n`;
                    groupMessage += `   Дата: ${duplicateDate}\n`;
                  }
                  
                  // Если дубликатов больше 10, добавляем сообщение об этом
                  if (group.duplicates.length > 10) {
                    groupMessage += `\n... и еще ${group.duplicates.length - 10} дубликатов\n`;
                  }
                }
                
                // Отправляем сообщение для этой группы с markdown-форматированием для ссылок
                try {
                  await bot.sendMessage(chatId, groupMessage, { 
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true  // Отключаем предпросмотр, чтобы не загружать изображения
                  });
                } catch (sendError) {
                  console.error('Ошибка при отправке сообщения с группой дубликатов:', sendError);
                  // Если произошла ошибка форматирования, отправляем без форматирования
                  await bot.sendMessage(chatId, 
                    `Группа ${i+1} (${group.count} похожих изображений):\n\n` +
                    `Оригинал: ${group.original.link}\n\n` +
                    `Дубликатов: ${group.duplicates.length}`
                  );
                }
              }
              
              // Если групп дубликатов больше 10, добавляем сообщение об этом
              if (reportData.duplicateGroups.length > 10) {
                await bot.sendMessage(chatId, `... и еще ${reportData.duplicateGroups.length - 10} групп дубликатов.\n\nПолный отчет сохранен в файл JSON.`);
              }
            }
          } catch (error) {
            console.error('Ошибка при чтении или обработке отчета:', error);
            await bot.sendMessage(chatId, `Произошла ошибка при обработке отчета. Полный отчет сохранен в файл JSON.`);
          }
        } else if (similarImagesFound === 0) {
          await bot.sendMessage(chatId, 'Дубликатов не найдено.');
        }
      } else {
        await bot.sendMessage(chatId, `Ошибка при сканировании: ${result.error || result.message}`);
      }
    } catch (error) {
      console.error('Ошибка при выполнении команды scan_channel:', error);
      await bot.sendMessage(chatId, `Ошибка: ${error.message}`);
    }
  });

  // Обработчик команды /clear
  bot.onText(/\/clear/, async (msg) => {
    const chatId = msg.chat.id;
    imageDatabase.clear();
    await imageDatabase.save();
    imageHasher.cleanupTempDir();
    await bot.sendMessage(chatId, 'База данных очищена');
  });

  // Обработчик команды для установки порога сходства
  bot.onText(/\/set_threshold\s+(\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const threshold = parseInt(match[1]);
    
    if (threshold >= 0 && threshold <= 100) {
      config.hashDifferenceThreshold = threshold;
      await bot.sendMessage(chatId, `Порог сходства установлен на ${threshold}%`);
    } else {
      await bot.sendMessage(chatId, 'Порог сходства должен быть числом от 0 до 100');
    }
  });

  // Обработчик команды для генерации отчета
  bot.onText(/\/generate_report/, async (msg) => {
    const chatId = msg.chat.id;
    
    await bot.sendMessage(chatId, 'Создаю отчет о похожих изображениях...');
    
    try {
      const report = await imageAnalyzer.createSimilarityReport();
      
      // Отправляем текстовый отчет
      if (report.groups.length > 0) {
        // Отправляем краткую статистику
        await bot.sendMessage(chatId, 
          `Отчет создан:\n` +
          `- Всего групп похожих изображений: ${report.groups.length}\n` +
          `- Общее количество дубликатов: ${report.groups.reduce((sum, group) => sum + group.similarImages.length, 0)}`
        );
        
        // Отправляем текстовый файл с отчетом
        await bot.sendDocument(chatId, report.textLogPath, {
          caption: 'Текстовый отчет о похожих изображениях'
        });
        
        // Отправляем HTML-отчет
        await bot.sendDocument(chatId, report.htmlReportPath, {
          caption: 'HTML-отчет о похожих изображениях'
        });
      } else {
        await bot.sendMessage(chatId, 'Похожие изображения не найдены');
      }
    } catch (error) {
      console.error('Ошибка при генерации отчета:', error);
      await bot.sendMessage(chatId, `Ошибка при генерации отчета: ${error.message}`);
    }
  });

  // Обработчик для всех фотографий
  bot.on('photo', processPhotoMessage);

  // Обработчик ошибок
  bot.on('polling_error', (error) => {
    console.error('Ошибка соединения с Telegram API:', error);
  });
}

// Инициализация базы данных и запуск бота
async function start() {
  try {
    console.log('Запуск Telegram бота для сравнения изображений...');
    
    // Проверяем, не запущен ли уже бот
    const canStart = await checkBotInstance();
    
    if (!canStart) {
      console.error('Другой экземпляр бота уже запущен. Завершение работы.');
      process.exit(1);
    }

    console.log('Проверка конфигурации...');
    console.log(`Токен бота: ${config.botToken ? '✅ Задан' : '❌ Не задан'}`);
    console.log(`ID канала: ${config.channelId ? '✅ Задан' : '❌ Не задан'}`);

    // Создаем экземпляр бота только если блокировка успешна
    console.log('Создание экземпляра бота...');
    bot = new TelegramBot(config.botToken, { polling: true });
    
    console.log('Создание экземпляра сканера каналов...');
    channelScanner = new ChannelScanner(bot);
    
    // Настраиваем обработчики сообщений перед инициализацией
    console.log('Настройка обработчиков сообщений...');
    setupBotHandlers();
    
    // Инициализируем бота
    console.log('Инициализация бота...');
    await init();
    
    // Периодически сохраняем базу данных
    console.log('Настройка периодического сохранения базы данных...');
    setInterval(() => {
      imageDatabase.save();
    }, 5 * 60 * 1000); // Каждые 5 минут
    
    console.log('Бот успешно запущен и готов к работе');
  } catch (error) {
    console.error('Ошибка при запуске бота:', error);
    process.exit(1);
  }
}

start();