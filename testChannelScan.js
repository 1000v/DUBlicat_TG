require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const UpdatedChannelScanner = require('./updatedChannelScanner');
const imageDatabase = require('./imageDatabase');
const path = require('path');
const fs = require('fs');

// Проверяем, что токен бота указан
if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error('Ошибка: Не указан токен Telegram бота в файле .env');
  process.exit(1);
}

// Проверяем, что ID канала указан
if (!process.env.CHANNEL_ID) {
  console.error('Ошибка: Не указан ID канала в файле .env');
  process.exit(1);
}

// Создаем экземпляр бота
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
const channelScanner = new UpdatedChannelScanner(bot);

// Параметры сканирования из аргументов командной строки
const channelId = process.argv[2] || process.env.CHANNEL_ID;
const limit = process.argv[3] ? parseInt(process.argv[3]) : 100;
const method = process.argv[4] || 'auto';

console.log(`Начинаем тестовое сканирование канала ${channelId}`);
console.log(`Метод: ${method}, лимит: ${limit} сообщений`);

/**
 * Проверка доступа к каналу
 */
async function testChannelAccess() {
  try {
    // Проверяем доступ с помощью Bot API
    console.log('\n1. Проверяем доступ к каналу через Bot API...');
    try {
      const chat = await bot.getChat(channelId);
      console.log(`✅ Успешно получена информация о канале: ${chat.title} (${chat.id})`);
      
      const isAdmin = await channelScanner.directClient.isBotChannelAdmin(channelId);
      if (isAdmin) {
        console.log('✅ Бот является администратором канала');
      } else {
        console.log('⚠️ Предупреждение: Бот НЕ является администратором канала');
      }
    } catch (error) {
      console.error(`❌ Ошибка доступа через Bot API: ${error.message}`);
    }
    
    // Проверяем доступ с помощью MTProto API если есть API_ID и API_HASH
    if (process.env.API_ID && process.env.API_HASH) {
      console.log('\n2. Проверяем доступ к каналу через MTProto API...');
      
      try {
        // Инициализируем клиент, если требуется
        if (!channelScanner.gramjsClient) {
          console.log('Инициализация клиента gramjs...');
          channelScanner.gramjsClient = new (require('./telegramHistoryFetcher'))();
          await channelScanner.gramjsClient.init();
        }
        
        // Пробуем получить несколько сообщений
        const messages = await channelScanner.getChannelHistoryGramJs(channelId, 5);
        console.log(`✅ Успешно получено ${messages.length} сообщений через MTProto API (gramjs)`);
      } catch (error) {
        console.error(`❌ Ошибка доступа через MTProto API (gramjs): ${error.message}`);
      }
    } else {
      console.log('\n2. Пропускаем проверку MTProto API: не указаны API_ID и API_HASH в .env');
    }
  } catch (error) {
    console.error(`Ошибка при проверке доступа к каналу: ${error.message}`);
  }
}

/**
 * Тестирует сканирование канала
 * @param {string} channelId - ID канала
 * @param {number} limit - максимальное количество сообщений
 * @param {string} method - метод получения сообщений
 * @returns {Promise<Object>} - результат сканирования
 */
async function testChannelScan(channelId, limit, method) {
  try {
    console.log(`3. Начинаем сканирование канала ${channelId} методом ${method}...`);
    
    // Загружаем базу данных перед сканированием
    await imageDatabase.load();
    
    const scanner = new UpdatedChannelScanner();
    const startTime = Date.now();
    
    // Сканируем канал
    const result = await scanner.scanChannel(channelId, limit, method);
    
    // Закрываем соединение
    await scanner.close();
    
    const endTime = Date.now();
    const elapsedTime = ((endTime - startTime) / 1000).toFixed(3);
    
    if (result.success) {
      console.log('\n✅ Сканирование успешно завершено!');
      console.log(`Использованный метод: ${result.results.method}`);
      console.log(`Просканировано сообщений: ${result.results.totalMessages}`);
      console.log(`Обработано изображений: ${result.results.processedImages}`);
      console.log(`Найдено похожих изображений: ${result.results.similarImagesFound}`);
      console.log(`Ошибок: ${result.results.errors}`);
      console.log(`Время выполнения: ${elapsedTime} секунд`);
    } else {
      console.log('\n❌ Ошибка при сканировании канала:');
      console.log(result.error);
    }
    
    return result;
  } catch (error) {
    console.error('Ошибка при тестировании сканирования:', error);
    throw error;
  }
}

/**
 * Тестирует полное сканирование канала с автоматическим определением сообщений
 * @param {string} channelId - ID канала
 * @param {number} batchSize - размер одной порции сообщений
 * @param {number} cooldownSeconds - задержка между порциями в секундах
 * @returns {Promise<Object>} - результат сканирования
 */
async function testFullChannelScan(channelId, batchSize = 100, cooldownSeconds = 3) {
  try {
    console.log(`4. Начинаем полное сканирование канала ${channelId} с поиском дубликатов...`);
    console.log(`Размер пакета: ${batchSize}, задержка: ${cooldownSeconds} сек.`);
    
    // Загружаем базу данных перед сканированием
    await imageDatabase.load();
    
    const scanner = new UpdatedChannelScanner();
    const startTime = Date.now();
    
    // Сканируем весь канал
    const result = await scanner.scanEntireChannel(channelId, batchSize, cooldownSeconds);
    
    // Закрываем соединение
    await scanner.close();
    
    const endTime = Date.now();
    const elapsedTime = ((endTime - startTime) / 1000).toFixed(3);
    
    if (result.success) {
      console.log('\n✅ Полное сканирование успешно завершено!');
      console.log(`Просканировано сообщений: ${result.results.totalMessages}`);
      console.log(`Обработано изображений: ${result.results.processedImages}`);
      console.log(`Найдено дубликатов: ${result.results.similarImagesFound}`);
      console.log(`Групп дубликатов: ${result.results.duplicateGroups.length}`);
      console.log(`Ошибок: ${result.results.errors}`);
      console.log(`Время выполнения: ${elapsedTime} секунд`);
      
      // Если были найдены дубликаты, выводим 10 самых крупных групп
      if (result.results.duplicateGroups.length > 0) {
        console.log('\nТоп-10 групп дубликатов:');
        const topGroups = result.results.duplicateGroups.slice(0, 10);
        
        for (let i = 0; i < topGroups.length; i++) {
          const group = topGroups[i];
          console.log(`\nГруппа #${i + 1}: ${group.count} сообщений с одинаковым изображением`);
          console.log(`Хеш: ${group.hash}`);
          console.log('ID сообщений:');
          
          group.images.forEach((img, idx) => {
            console.log(`  ${idx + 1}. Сообщение ID: ${img.messageId}, Дата: ${img.date}`);
          });
        }
        
        // Сохраняем отчет о дубликатах в файл
        const reportPath = path.join(__dirname, 'duplicates_report.json');
        fs.writeFileSync(reportPath, JSON.stringify(result.results.duplicateGroups, null, 2));
        console.log(`\nПолный отчет о дубликатах сохранен в файл: ${reportPath}`);
      }
    } else {
      console.log('\n❌ Ошибка при полном сканировании канала:');
      console.log(result.error);
    }
    
    return result;
  } catch (error) {
    console.error('Ошибка при тестировании полного сканирования:', error);
    throw error;
  }
}

/**
 * Тестирует облегченное сканирование канала без скачивания изображений
 * @param {string} channelId - ID канала
 * @param {number} batchSize - размер одной порции сообщений
 * @param {number} cooldownSeconds - задержка между порциями в секундах
 * @returns {Promise<Object>} - результат сканирования
 */
async function testLightweightChannelScan(channelId, batchSize = 100, cooldownSeconds = 3) {
  try {
    console.log(`4. Начинаем облегченное сканирование канала ${channelId} без скачивания изображений...`);
    console.log(`Размер пакета: ${batchSize}, задержка: ${cooldownSeconds} сек.`);
    
    // Загружаем базу данных перед сканированием
    await imageDatabase.load();
    
    const scanner = new UpdatedChannelScanner();
    const startTime = Date.now();
    
    // Сканируем весь канал
    const result = await scanner.scanEntireChannelWithoutDownload(channelId, batchSize, cooldownSeconds);
    
    // Закрываем соединение
    await scanner.close();
    
    const endTime = Date.now();
    const elapsedTime = ((endTime - startTime) / 1000).toFixed(3);
    
    if (result.success) {
      console.log('\n✅ Облегченное сканирование успешно завершено!');
      console.log(`Просканировано сообщений: ${result.results.totalMessages}`);
      console.log(`Обработано изображений: ${result.results.processedImages}`);
      console.log(`Найдено дубликатов: ${result.results.similarImagesFound}`);
      console.log(`Групп дубликатов: ${result.results.duplicateGroups.length}`);
      console.log(`Ошибок: ${result.results.errors}`);
      console.log(`Время выполнения: ${elapsedTime} секунд`);
      
      // Если были найдены дубликаты, выводим 10 самых крупных групп
      if (result.results.duplicateGroups.length > 0) {
        console.log('\nТоп-10 групп дубликатов:');
        const topGroups = result.results.duplicateGroups.slice(0, 10);
        
        for (let i = 0; i < topGroups.length; i++) {
          const group = topGroups[i];
          console.log(`\nГруппа #${i + 1}: ${group.count} сообщений с одинаковым изображением`);
          console.log(`Сигнатура: ${group.hash}`);
          console.log('ID сообщений:');
          
          group.images.forEach((img, idx) => {
            // Пытаемся получить или сформировать ссылку на сообщение
            let link = 'Ссылка недоступна';
            try {
              if (img.messageLink) {
                link = img.messageLink;
              } else {
                // Если ссылки нет, формируем её
                const pureChannelId = channelId.toString().replace(/^-100/, '');
                link = `https://t.me/c/${pureChannelId}/${img.messageId}`;
              }
            } catch (e) {
              console.log(`Не удалось сформировать ссылку для сообщения ${img.messageId}: ${e.message}`);
            }
            
            // Форматируем дату
            let dateStr = "Неизвестно";
            try {
              if (img.date) {
                dateStr = img.date;
              } else if (img.timestamp) {
                dateStr = new Date(img.timestamp * 1000).toISOString();
              }
            } catch (e) {
              console.log(`Не удалось обработать дату для сообщения ${img.messageId}: ${e.message}`);
            }
            
            console.log(`  ${idx + 1}. Сообщение ID: ${img.messageId}, Дата: ${dateStr}, Ссылка: ${link}`);
          });
        }
        
        // Создаем улучшенный JSON-отчет с сохранением ссылок
        const reportData = result.results.duplicateGroups.map(group => {
          return {
            hash: group.hash,
            count: group.count,
            images: group.images.map(img => {
              // Если ссылка отсутствует, создадим её
              let messageLink = img.messageLink || null;
              let dateStr = "Неизвестно";
              
              try {
                if (!messageLink) {
                  const pureChannelId = channelId.toString().replace(/^-100/, '');
                  messageLink = `https://t.me/c/${pureChannelId}/${img.messageId}`;
                }
                
                if (img.date) {
                  dateStr = img.date;
                } else if (img.timestamp) {
                  dateStr = new Date(img.timestamp * 1000).toISOString();
                }
              } catch (e) {
                console.log(`Ошибка при подготовке данных для отчета: ${e.message}`);
              }
              
              return {
                messageId: img.messageId,
                date: dateStr,
                messageLink: messageLink
              };
            })
          };
        });
        
        // Сохраняем отчет о дубликатах в файл
        const reportPath = path.join(__dirname, 'duplicates_report_light.json');
        fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
        console.log(`\nПолный отчет о дубликатах сохранен в файл: ${reportPath}`);
      }
    } else {
      console.log('\n❌ Ошибка при облегченном сканировании канала:');
      console.log(result.error);
    }
    
    return result;
  } catch (error) {
    console.error('Ошибка при тестировании облегченного сканирования:', error);
    throw error;
  }
}

/**
 * Запуск тестирования
 */
async function runTests() {
  try {
    // Определяем тип теста на основе аргументов
    const testType = process.argv[5] || 'regular';
    
    if (testType === 'full') {
      // Выполняем полное сканирование канала
      const batchSize = process.argv[3] ? parseInt(process.argv[3]) : 100;
      const cooldown = process.argv[4] ? parseInt(process.argv[4]) : 3;
      await testChannelAccess();
      await testFullChannelScan(channelId, batchSize, cooldown);
    } else if (testType === 'light') {
      // Выполняем облегченное сканирование без скачивания
      const batchSize = process.argv[3] ? parseInt(process.argv[3]) : 100;
      const cooldown = process.argv[4] ? parseInt(process.argv[4]) : 3;
      await testChannelAccess();
      await testLightweightChannelScan(channelId, batchSize, cooldown);
    } else {
      // Выполняем обычное сканирование
      await testChannelAccess();
      await testChannelScan(channelId, limit, method);
    }
  } catch (error) {
    console.error(`Ошибка при выполнении тестов: ${error.message}`);
  } finally {
    process.exit(0);
  }
}

// Запускаем тесты
runTests(); 