const config = require('./config');
const axios = require('axios');
const path = require('path');
const imageHasher = require('./imageHasher');
const imageDatabase = require('./imageDatabase');
const TelegramHistoryFetcher = require('./telegramHistoryFetcher');
const DirectTelegramApiFetcher = require('./directTelegramApiFetcher');
const MtprotoTelegramClient = require('./mtprotoTelegramClient');
const fs = require('fs');

/**
 * Класс для сканирования каналов Telegram с поддержкой
 * разных методов получения истории сообщений
 */
class UpdatedChannelScanner {
  constructor(bot) {
    this.bot = bot;
    this.isScanning = false;
    this.processedMessageIds = new Set(); // Для предотвращения повторной обработки
    
    // Инициализация различных API клиентов
    this.gramjsClient = null; // Будет создан при необходимости
    this.directClient = new DirectTelegramApiFetcher();
    this.mtprotoClient = null; // Будет создан при необходимости
  }

  /**
   * Получение истории сообщений из канала с использованиемBot API
   * (ограниченная функциональность, работает только для новых сообщений)
   * @param {string} channelId - ID канала
   * @param {number} limit - максимальное количество сообщений
   * @param {number} offset - смещение сообщений
   * @returns {Promise<Array>} - массив сообщений
   */
  async getChannelHistoryBotApi(channelId, limit = 100, offset = 0) {
    try {
      // Получаем информацию о канале
      const chat = await this.bot.getChat(channelId);
      console.log(`Получение истории канала: ${chat.title || channelId}`);
      
      // Проверяем, является ли бот администратором
      const isAdmin = await this.directClient.isBotChannelAdmin(channelId);
      
      if (!isAdmin) {
        console.log('Предупреждение: Бот не является администратором канала. Это может ограничить доступ к сообщениям.');
      }
      
      // Пытаемся получить сообщения с помощью getUpdates
      const updates = await this.bot.getUpdates({
        allowed_updates: ['channel_post'],
        offset: -limit - offset,
        limit
      });
      
      // Фильтруем сообщения по ID канала
      const filteredMessages = updates
        .filter(update => update.channel_post && 
          update.channel_post.chat.id.toString() === channelId.toString())
        .map(update => update.channel_post);
      
      console.log(`Получено ${filteredMessages.length} сообщений методом Bot API`);
      
      if (filteredMessages.length === 0) {
        console.log('Bot API не вернул сообщений. Это ожидаемо, так как getUpdates возвращает только новые сообщения.');
      }
      
      return filteredMessages;
    } catch (error) {
      console.error('Ошибка при получении истории канала через Bot API:', error.message);
      return [];
    }
  }

  /**
   * Получение истории сообщений из канала с использованием MTProto API через gramjs
   * @param {string} channelId - ID канала
   * @param {number} limit - максимальное количество сообщений
   * @returns {Promise<Array>} - массив сообщений
   */
  async getChannelHistoryGramJs(channelId, limit = 100) {
    try {
      // Инициализируем клиент gramjs, если он еще не создан
      if (!this.gramjsClient) {
        this.gramjsClient = new TelegramHistoryFetcher();
        await this.gramjsClient.init();
      }
      
      // Получаем сообщения
      console.log(`Получение истории канала ${channelId} с помощью MTProto API (gramjs)...`);
      const messages = await this.gramjsClient.getChannelMessages(channelId, limit);
      
      console.log(`Получено ${messages.length} сообщений методом MTProto API (gramjs)`);
      return messages;
    } catch (error) {
      console.error('Ошибка при получении истории канала через MTProto API (gramjs):', error.message);
      return [];
    }
  }

  /**
   * Получение всех сообщений из канала с использованием MTProto API через gramjs
   * (с поддержкой пагинации)
   * @param {string} channelId - ID канала
   * @param {number} maxMessages - максимальное количество сообщений
   * @returns {Promise<Array>} - массив сообщений
   */
  async getAllChannelMessagesGramJs(channelId, maxMessages = 1000) {
    try {
      // Инициализируем клиент gramjs, если он еще не создан
      if (!this.gramjsClient) {
        this.gramjsClient = new TelegramHistoryFetcher();
        await this.gramjsClient.init();
      }
      
      // Получаем все сообщения
      console.log(`Получение всех сообщений канала ${channelId} с помощью MTProto API (gramjs)...`);
      const messages = await this.gramjsClient.getAllChannelMessages(channelId, 100, maxMessages);
      
      console.log(`Получено ${messages.length} сообщений методом MTProto API (gramjs)`);
      return messages;
    } catch (error) {
      console.error('Ошибка при получении всех сообщений канала через MTProto API (gramjs):', error.message);
      return [];
    }
  }

  /**
   * Получение истории сообщений из канала с использованием MTProto API через @mtproto/core
   * @param {string} channelIdOrUsername - ID канала или имя пользователя
   * @param {number} limit - максимальное количество сообщений
   * @returns {Promise<Array>} - массив сообщений
   */
  async getChannelHistoryMtprotoCore(channelIdOrUsername, limit = 100) {
    try {
      // Инициализируем клиент @mtproto/core, если он еще не создан
      if (!this.mtprotoClient) {
        this.mtprotoClient = new MtprotoTelegramClient();
      }
      
      // Получаем сообщения
      console.log(`Получение истории канала ${channelIdOrUsername} с помощью MTProto API (@mtproto/core)...`);
      const history = await this.mtprotoClient.getChannelHistory(channelIdOrUsername, limit);
      
      console.log(`Получено ${history.messages.length} сообщений методом MTProto API (@mtproto/core)`);
      return history.messages;
    } catch (error) {
      console.error('Ошибка при получении истории канала через MTProto API (@mtproto/core):', error.message);
      return [];
    }
  }

  /**
   * Получение всех сообщений из канала с использованием MTProto API через @mtproto/core
   * (с поддержкой пагинации)
   * @param {string} channelIdOrUsername - ID канала или имя пользователя
   * @param {number} maxMessages - максимальное количество сообщений
   * @returns {Promise<Array>} - массив сообщений
   */
  async getAllChannelMessagesMtprotoCore(channelIdOrUsername, maxMessages = 1000) {
    try {
      // Инициализируем клиент @mtproto/core, если он еще не создан
      if (!this.mtprotoClient) {
        this.mtprotoClient = new MtprotoTelegramClient();
      }
      
      // Получаем все сообщения
      console.log(`Получение всех сообщений канала ${channelIdOrUsername} с помощью MTProto API (@mtproto/core)...`);
      const result = await this.mtprotoClient.getAllChannelMessages(channelIdOrUsername, 100, maxMessages);
      
      console.log(`Получено ${result.messages.length} сообщений методом MTProto API (@mtproto/core)`);
      return result.messages;
    } catch (error) {
      console.error('Ошибка при получении всех сообщений канала через MTProto API (@mtproto/core):', error.message);
      return [];
    }
  }

  /**
   * Обработка фотографии из сообщения Bot API
   * @param {Object} message - сообщение с фотографией
   * @returns {Promise<Object>} - результат обработки
   */
  async processPhotoFromBotApi(message) {
    try {
      // Проверяем, обрабатывали ли мы уже это сообщение
      if (this.processedMessageIds.has(message.message_id)) {
        return { processed: false, reason: 'duplicate' };
      }
      
      // Получаем файл наибольшего размера
      const photoSizes = message.photo;
      const photo = photoSizes[photoSizes.length - 1];
      const fileId = photo.file_id;
      
      // Получаем информацию о файле
      const fileInfo = await this.bot.getFile(fileId);
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
        messageId: message.message_id,
        chatId: message.chat.id,
        userId: message.from?.id,
        fileSize: photo.file_size,
        width: photo.width,
        height: photo.height,
        timestamp: message.date,
        source: 'channel_scan'
      };
      
      imageDatabase.addImage(imageInfo);
      
      // Добавляем ID сообщения в обработанные
      this.processedMessageIds.add(message.message_id);
      
      return {
        processed: true,
        imageInfo,
        similarImages
      };
    } catch (error) {
      console.error('Ошибка при обработке фото из Bot API:', error);
      return { processed: false, error: error.message };
    }
  }

  /**
   * Обработка фотографии из сообщения MTProto API
   * @param {Object} message - сообщение с фотографией
   * @param {string} clientType - тип клиента ('gramjs' или 'mtprotocore')
   * @returns {Promise<Object>} - результат обработки
   */
  async processPhotoFromMtprotoApi(message, clientType = 'gramjs') {
    try {
      // Проверяем, обрабатывали ли мы уже это сообщение
      if (this.processedMessageIds.has(message.id)) {
        return { processed: false, reason: 'duplicate' };
      }
      
      console.log(`Начинаем обработку фото из сообщения ID: ${message.id}, клиент: ${clientType}`);
      console.log(`Структура message.media:`, JSON.stringify(message.media).substring(0, 500));
      
      // Путь к временному файлу
      let filePath;
      
      if (clientType === 'gramjs') {
        // Скачиваем фото с помощью gramjs
        if (!this.gramjsClient) {
          this.gramjsClient = new TelegramHistoryFetcher();
          await this.gramjsClient.init();
        }
        filePath = await this.gramjsClient.downloadMessagePhoto(message);
      } else if (clientType === 'mtprotocore') {
        // Скачиваем фото с помощью @mtproto/core
        if (!this.mtprotoClient) {
          this.mtprotoClient = new MtprotoTelegramClient();
        }
        filePath = await this.mtprotoClient.downloadMessagePhoto(message);
      } else {
        throw new Error(`Неизвестный тип клиента: ${clientType}`);
      }
      
      if (!filePath) {
        throw new Error('Не удалось скачать изображение');
      }
      
      console.log(`Изображение скачано: ${filePath}`);
      
      // Вычисляем хеш изображения
      const hash = await imageHasher.calculateHashFromFile(filePath);
      console.log(`Вычислен хеш изображения: ${hash}`);
      
      // Ищем похожие изображения
      const similarImages = imageDatabase.findSimilarImages(hash, (hash1, hash2) => {
        return imageHasher.areImagesSimilar(hash1, hash2);
      });
      
      // Получаем размеры изображения
      // В данном случае не можем определить точные размеры, поэтому используем примерные
      const width = message.media && message.media.photo ? 
        message.media.photo.sizes[message.media.photo.sizes.length - 1].w : 0;
      const height = message.media && message.media.photo ? 
        message.media.photo.sizes[message.media.photo.sizes.length - 1].h : 0;
      
      // Сохраняем информацию о новом изображении
      const imageInfo = {
        fileId: path.basename(filePath, '.jpg'),
        hash,
        messageId: message.id,
        chatId: message.peer_id ? message.peer_id.channel_id : (message.chat_id || 0),
        userId: message.from_id ? message.from_id.user_id : 0,
        fileSize: 0, // Точный размер неизвестен
        width,
        height,
        timestamp: message.date,
        source: `channel_scan_${clientType}`
      };
      
      imageDatabase.addImage(imageInfo);
      
      // Добавляем ID сообщения в обработанные
      this.processedMessageIds.add(message.id);
      
      return {
        processed: true,
        imageInfo,
        similarImages
      };
    } catch (error) {
      console.error(`Ошибка при обработке фото из MTProto API (${clientType}):`, error);
      return { processed: false, error: error.message };
    }
  }

  /**
   * Определение оптимального метода для получения истории канала
   * @param {string} channelId - ID канала
   * @returns {Promise<string>} - рекомендуемый метод ('botapi', 'gramjs', 'mtprotocore')
   */
  async determineOptimalMethod(channelId) {
    try {
      // Проверяем права бота в канале
      const isAdmin = await this.directClient.isBotChannelAdmin(channelId);
      
      if (!isAdmin) {
        console.log('Бот не является администратором канала. Рекомендуется использовать MTProto API.');
        
        // Проверяем, установлены ли API_ID и API_HASH
        if (process.env.API_ID && process.env.API_HASH) {
          // Предпочитаем gramjs, так как он более стабилен
          return 'gramjs';
        } else {
          console.log('API_ID и API_HASH не установлены. Невозможно использовать MTProto API.');
          return 'botapi';
        }
      }
      
      // Пробуем получить несколько сообщений через Bot API
      const botApiMessages = await this.getChannelHistoryBotApi(channelId, 10);
      
      if (botApiMessages.length > 0) {
        console.log('Bot API работает. Используем его для простоты.');
        return 'botapi';
      } else {
        console.log('Bot API не вернул сообщений. Пробуем MTProto API.');
        
        // Проверяем, установлены ли API_ID и API_HASH
        if (process.env.API_ID && process.env.API_HASH) {
          // Предпочитаем gramjs, так как он более стабилен
          return 'gramjs';
        } else {
          console.log('API_ID и API_HASH не установлены. Придется использовать Bot API, хотя он может не работать.');
          return 'botapi';
        }
      }
    } catch (error) {
      console.error('Ошибка при определении оптимального метода:', error);
      
      // В случае ошибки, проверяем доступность MTProto API
      if (process.env.API_ID && process.env.API_HASH) {
        return 'gramjs';
      } else {
        return 'botapi';
      }
    }
  }

  /**
   * Сканирование канала и обработка всех изображений
   * @param {string} channelId - ID канала
   * @param {number} limit - максимальное количество сообщений для обработки
   * @param {string} method - метод получения сообщений ('auto', 'botapi', 'gramjs', 'mtprotocore')
   * @returns {Promise<Object>} - результаты сканирования
   */
  async scanChannel(channelId, limit = 100, method = 'auto') {
    if (this.isScanning) {
      return { success: false, message: 'Сканирование уже выполняется' };
    }
    
    this.isScanning = true;
    const results = {
      totalMessages: 0,
      processedImages: 0,
      similarImagesFound: 0,
      errors: 0,
      method: method
    };
    
    try {
      const channel = channelId || config.channelId;
      
      if (!channel) {
        throw new Error('ID канала не указан');
      }
      
      console.log(`Начинаем сканирование канала ${channel}, метод: ${method}`);
      
      // Если метод автоматический, определяем оптимальный метод
      let actualMethod = method;
      if (method === 'auto') {
        actualMethod = await this.determineOptimalMethod(channel);
        results.method = actualMethod;
        console.log(`Выбран метод: ${actualMethod}`);
      }
      
      // Получаем сообщения выбранным методом
      let messages = [];
      
      switch (actualMethod) {
        case 'botapi':
          messages = await this.getChannelHistoryBotApi(channel, limit);
          break;
        case 'gramjs':
          if (limit > 100) {
            messages = await this.getAllChannelMessagesGramJs(channel, limit);
          } else {
            messages = await this.getChannelHistoryGramJs(channel, limit);
          }
          break;
        case 'mtprotocore':
          if (limit > 100) {
            messages = await this.getAllChannelMessagesMtprotoCore(channel, limit);
          } else {
            messages = await this.getChannelHistoryMtprotoCore(channel, limit);
          }
          break;
        default:
          throw new Error(`Неизвестный метод: ${actualMethod}`);
      }
      
      results.totalMessages = messages.length;
      console.log(`Получено ${messages.length} сообщений из канала`);
      
      // Проходим по всем сообщениям и обрабатываем фотографии
      for (const message of messages) {
        // Добавляем логирование для анализа структуры сообщения
        console.log(`Анализ сообщения ID: ${message.id || 'unknown'}`);
        console.log(`Тип сообщения: ${message._ || 'unknown'}`);
        console.log(`Есть ли media: ${message.media ? 'да' : 'нет'}`);
        
        if (message.media) {
          console.log(`Тип медиа: ${message.media._ || 'unknown'}`);
          if (message.media.document) {
            console.log(`Тип документа: ${message.media.document.mime_type || 'unknown'}`);
          }
        }

        // Улучшенная проверка, содержит ли сообщение фотографию
        let hasPhoto = false;
        
        if (actualMethod === 'botapi' && message.photo) {
          hasPhoto = true;
        } else if (actualMethod !== 'botapi' && message.media) {
          if (message.media._ === 'messageMediaPhoto') {
            hasPhoto = true;
          } else if (message.media._ === 'messageMediaDocument' && 
                    message.media.document && 
                    message.media.document.mime_type && 
                    message.media.document.mime_type.startsWith('image/')) {
            hasPhoto = true;
          } else if (message.media.photo) {
            // Альтернативная структура для фото
            hasPhoto = true;
          } else if (message.media._ === 'Photo') {
            // Еще одна возможная структура
            hasPhoto = true;
          }
        }
        
        console.log(`Содержит фото: ${hasPhoto ? 'да' : 'нет'}`);
        
        if (hasPhoto) {
          let processResult;
          
          if (actualMethod === 'botapi') {
            processResult = await this.processPhotoFromBotApi(message);
          } else if (actualMethod === 'gramjs') {
            processResult = await this.processPhotoFromMtprotoApi(message, 'gramjs');
          } else if (actualMethod === 'mtprotocore') {
            processResult = await this.processPhotoFromMtprotoApi(message, 'mtprotocore');
          }
          
          if (processResult && processResult.processed) {
            results.processedImages++;
            console.log(`Успешно обработано изображение, ID сообщения: ${message.id}`);
            
            if (processResult.similarImages && processResult.similarImages.length > 0) {
              results.similarImagesFound += processResult.similarImages.length;
              console.log(`Найдено ${processResult.similarImages.length} похожих изображений`);
            }
          } else if (processResult && processResult.error) {
            results.errors++;
            console.error(`Ошибка при обработке изображения, ID сообщения: ${message.id}`, processResult.error);
          } else if (processResult && processResult.reason) {
            console.log(`Пропущено изображение, причина: ${processResult.reason}`);
          } else {
            console.error(`Неизвестный результат обработки для ID сообщения: ${message.id}`);
          }
        }
      }
      
      // Сохраняем базу данных
      await imageDatabase.save();
      
      return {
        success: true,
        results
      };
    } catch (error) {
      console.error('Ошибка при сканировании канала:', error);
      return {
        success: false,
        error: error.message
      };
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Определение общего количества сообщений в канале
   * @param {string} channelId - ID канала
   * @returns {Promise<number>} - количество сообщений в канале
   */
  async getChannelMessagesCount(channelId) {
    try {
      // Инициализируем клиент MTProto, если требуется
      if (!this.gramjsClient) {
        this.gramjsClient = new TelegramHistoryFetcher();
        await this.gramjsClient.init();
      }

      // Пытаемся получить информацию о канале
      console.log(`Получение информации о канале ${channelId}...`);
      const channel = await this.gramjsClient.client.getEntity(channelId);
      
      // Получаем информацию о количестве сообщений
      const fullChannel = await this.gramjsClient.client.invoke({
        _: 'channels.getFullChannel',
        channel: {
          _: 'inputChannel',
          channel_id: channel.id,
          access_hash: channel.access_hash
        }
      });
      
      // Получаем количество сообщений из ответа
      const messageCount = fullChannel.full_chat.read_inbox_max_id || 10000; // Примерная оценка, если точное количество недоступно
      console.log(`Приблизительное количество сообщений в канале: ${messageCount}`);
      
      return messageCount;
    } catch (error) {
      console.error('Ошибка при определении количества сообщений в канале:', error);
      // Возвращаем значение по умолчанию, если не удалось определить точное количество
      return 10000; 
    }
  }

  /**
   * Проверяет, содержит ли сообщение изображение
   * @param {Object} message - сообщение Telegram
   * @returns {boolean} - содержит ли сообщение фото
   * @private
   */
  _hasPhoto(message) {
    if (!message || !message.media) {
      return false;
    }
    
    // Явно проверяем все возможные структуры медиа данных
    if (message.media._ === 'messageMediaPhoto' || 
        message.media._ === 'MessageMediaPhoto' || 
        message.media.photo) {
      return true;
    }
    
    // Проверяем документы с MIME-типом изображений
    if ((message.media._ === 'messageMediaDocument' || 
         message.media._ === 'MessageMediaDocument') && 
        message.media.document && 
        message.media.document.mime_type && 
        message.media.document.mime_type.startsWith('image/')) {
      return true;
    }
    
    // Проверка наличия фото по типу media._
    if (message.media._ === 'Photo') {
      return true;
    }
    
    // Если это обычный Bot API формат, проверим наличие поля photo
    if (message.photo && Array.isArray(message.photo)) {
      return true;
    }
    
    return false;
  }

  /**
   * Создает ссылку на сообщение в Telegram
   * @param {string} channelId - ID канала (с префиксом -100) или юзернейм
   * @param {number} messageId - ID сообщения
   * @returns {string} - ссылка на сообщение
   * @private
   */
  _createMessageLink(channelId, messageId) {
    // Проверяем, является ли это числовым ID (закрытый канал) или юзернеймом (открытый канал)
    if (channelId.toString().startsWith('-100') || /^\d+$/.test(channelId.toString())) {
      // Закрытый канал - формат: https://t.me/c/CHANNEL_ID/MESSAGE_ID
      // Преобразуем ID канала к формату для ссылки (без -100)
      const pureChannelId = channelId.toString().replace(/^-100/, '');
      return `https://t.me/c/${pureChannelId}/${messageId}`;
    } else {
      // Открытый канал - формат: https://t.me/CHANNEL_NAME/MESSAGE_ID
      // Убираем @ из юзернейма, если он есть
      const channelName = channelId.toString().replace(/^@/, '');
      return `https://t.me/${channelName}/${messageId}`;
    }
  }

  /**
   * Создаёт сигнатуру изображения из сообщения
   * @param {Object} message - сообщение Telegram
   * @returns {string|null} - сигнатура изображения или null
   * @private
   */
  _createPhotoSignature(message) {
    try {
      let photoSignature = '';
      
      if (message.media && message.media.photo) {
        // Используем ID фото и размеры как сигнатуру
        const photo = message.media.photo;
        const sizes = photo.sizes || [];
        const largestSize = sizes.length > 0 ? sizes[sizes.length - 1] : null;
        
        photoSignature = `photo_${photo.id}_${largestSize ? `${largestSize.w}x${largestSize.h}` : 'unknown'}`;
      } else if (message.media && message.media.document) {
        // Используем ID документа, тип и размер как сигнатуру
        const doc = message.media.document;
        photoSignature = `doc_${doc.id}_${doc.mime_type}_${doc.size}`;
      } else if (message.photo && Array.isArray(message.photo)) {
        // Для Bot API формата
        const photoSizes = message.photo;
        const largestPhoto = photoSizes[photoSizes.length - 1];
        photoSignature = `botapi_${largestPhoto.file_id}_${largestPhoto.width}x${largestPhoto.height}`;
      }
      
      return photoSignature || null;
    } catch (error) {
      console.error('Ошибка при создании сигнатуры:', error);
      return null;
    }
  }

  /**
   * Сканирование всего канала с автоматическим определением количества сообщений
   * и обработка дубликатов изображений без скачивания
   * @param {string} channelId - ID канала
   * @param {number} batchSize - размер одной порции сообщений
   * @param {number} cooldownSeconds - задержка между порциями в секундах
   * @returns {Promise<Object>} - результаты сканирования
   */
  async scanEntireChannelWithoutDownload(channelId, batchSize = 100, cooldownSeconds = 3) {
    if (this.isScanning) {
      return { success: false, message: 'Сканирование уже выполняется' };
    }
    
    this.isScanning = true;
    const results = {
      totalMessages: 0,
      processedImages: 0,
      similarImagesFound: 0,
      duplicateGroups: [],
      errors: 0,
      method: 'gramjs'
    };
    
    try {
      const channelTarget = channelId || config.channelId;
      
      if (!channelTarget) {
        throw new Error('ID канала не указан');
      }
      
      console.log(`Начинаем облегченное сканирование канала ${channelTarget} БЕЗ скачивания изображений`);
      
      // Определяем общее количество сообщений в канале
      const estimatedMessageCount = await this.getChannelMessagesCount(channelTarget);
      console.log(`Оценочное количество сообщений в канале: ${estimatedMessageCount}`);
      
      // Определяем количество порций для обработки
      const batchCount = Math.ceil(estimatedMessageCount / batchSize);
      console.log(`Разбиваем на ${batchCount} порций по ${batchSize} сообщений с кулдауном ${cooldownSeconds} секунд`);
      
      // Обработка сообщений порциями с паузами
      let offsetId = 0;
      let photoHashes = new Map(); // messageId -> hash signature
      
      // Инициализируем клиент, если требуется
      if (!this.gramjsClient) {
        this.gramjsClient = new TelegramHistoryFetcher();
        await this.gramjsClient.init();
      }
      
      // Получаем информацию о канале
      const channelInfo = await this.gramjsClient.client.getEntity(channelTarget);
      console.log(`Найден канал: ${channelInfo.title}`);
      
      for (let batch = 0; batch < batchCount; batch++) {
        console.log(`Обработка порции ${batch + 1}/${batchCount}, offsetId: ${offsetId}`);
        
        // Получаем порцию сообщений
        const messages = await this.gramjsClient.client.getMessages(channelTarget, {
          limit: batchSize,
          offsetId: offsetId
        });
        
        if (messages.length === 0) {
          console.log(`Порция ${batch + 1} не содержит сообщений, завершаем сканирование`);
          break;
        }
        
        console.log(`Получено ${messages.length} сообщений в порции ${batch + 1}`);
        results.totalMessages += messages.length;
        
        // Обновляем offsetId для следующей порции
        if (messages.length > 0) {
          offsetId = messages[messages.length - 1].id;
        }
        
        // Проходим по всем сообщениям и находим изображения
        for (const message of messages) {
          // Проверяем, содержит ли сообщение фотографию
          const hasPhoto = this._hasPhoto(message);
          
          // Добавляем отладочную информацию
          if (batch === 0 && results.processedImages < 5) {
            console.log(`Анализ сообщения ID: ${message.id}, тип: ${message._ || 'unknown'}`);
            console.log(`Содержит медиа: ${message.media ? 'да' : 'нет'}`);
            if (message.media) {
              console.log(`Тип медиа: ${message.media._ || 'unknown'}`);
            }
            console.log(`Определено как фото: ${hasPhoto ? 'да' : 'нет'}`);
            console.log(`Дата сообщения: ${message.date}, форматированная: ${new Date(message.date * 1000).toISOString()}`);
          }
          
          if (hasPhoto) {
            try {
              // Создаем уникальную сигнатуру для фото без его скачивания
              const photoSignature = this._createPhotoSignature(message);
              
              if (photoSignature) {
                // Создаем ссылку на сообщение в Telegram
                const messageLink = this._createMessageLink(channelTarget, message.id);
                
                // Форматируем дату и время
                let dateFormatted;
                try {
                  dateFormatted = new Date(message.date * 1000).toISOString();
                } catch (e) {
                  console.error(`Не удалось отформатировать дату для сообщения ${message.id}:`, e);
                  dateFormatted = 'Неизвестно';
                }
                
                // Сохраняем информацию об изображении
                const imageInfo = {
                  fileId: `virtual_${message.id}`,
                  hash: photoSignature,
                  messageId: message.id,
                  chatId: channelInfo.id,
                  channelUsername: channelInfo.username || null, // Добавляем имя канала для открытых каналов
                  timestamp: message.date,
                  date: dateFormatted,
                  source: 'channel_scan_lightweight',
                  messageLink: messageLink // Добавляем ссылку на сообщение
                };
                
                // Добавляем в отслеживание фото
                photoHashes.set(message.id, photoSignature);
                
                // Добавляем в базу данных
                await imageDatabase.addImage(imageInfo);
                
                results.processedImages++;
                
                // Добавляем отладочную информацию для первых 5 изображений
                if (results.processedImages <= 5) {
                  console.log(`Обработано изображение (${results.processedImages}): ID ${message.id}, сигнатура: ${photoSignature}`);
                  console.log(`Дата: ${dateFormatted}`);
                  console.log(`Ссылка на сообщение: ${messageLink}`);
                }
              }
            } catch (error) {
              console.error(`Ошибка при обработке фото в сообщении ID ${message.id}:`, error);
              results.errors++;
            }
          }
        }
        
        // Сохраняем промежуточный результат в базу данных
        await imageDatabase.save();
        
        // Если это не последняя порция, делаем паузу чтобы не перегрузить API
        if (batch < batchCount - 1 && messages.length === batchSize) {
          console.log(`Пауза ${cooldownSeconds} секунд перед следующей порцией...`);
          await new Promise(resolve => setTimeout(resolve, cooldownSeconds * 1000));
        }
      }
      
      // Поиск дубликатов на основе сигнатур
      console.log('Анализ дубликатов на основе сигнатур...');
      const allImages = imageDatabase.getAllImages().filter(img => img.source === 'channel_scan_lightweight');
      
      // Группируем изображения по хешу (сигнатуре)
      const hashGroups = new Map();
      allImages.forEach(img => {
        if (!hashGroups.has(img.hash)) {
          hashGroups.set(img.hash, []);
        }
        hashGroups.get(img.hash).push(img);
      });
      
      // Находим группы с дубликатами
      let duplicateGroupsData = [];
      hashGroups.forEach((images, hash) => {
        if (images.length > 1) {
          // Сортируем изображения по дате (от более ранних к поздним)
          images.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
          
          // Создаем группу дубликатов с дополнительной информацией
          const duplicateGroup = {
            hash,
            count: images.length,
            original: {
              messageId: images[0].messageId,
              date: images[0].date || 'Неизвестно',
              link: images[0].messageLink || this._createMessageLink(channelTarget, images[0].messageId)
            },
            duplicates: images.slice(1).map(img => ({
              messageId: img.messageId,
              date: img.date || 'Неизвестно',
              link: img.messageLink || this._createMessageLink(channelTarget, img.messageId)
            }))
          };
          
          duplicateGroupsData.push(duplicateGroup);
          results.duplicateGroups.push({
            hash,
            images,
            count: images.length
          });
          
          results.similarImagesFound += images.length - 1; // Один оригинал и остальные дубликаты
        }
      });
      
      // Сортируем группы по количеству дубликатов (от большего к меньшему)
      duplicateGroupsData.sort((a, b) => b.count - a.count);
      results.duplicateGroups.sort((a, b) => b.count - a.count);
      
      // Сохраняем отчет в JSON файл
      const reportFilePath = path.join(config.logsFolder, 'duplicates_report_light.json');
      await fs.promises.writeFile(
        reportFilePath, 
        JSON.stringify({
          scanDate: new Date().toISOString(),
          channelInfo: {
            id: channelInfo.id,
            title: channelInfo.title,
            username: channelInfo.username || null
          },
          stats: {
            totalMessages: results.totalMessages,
            processedImages: results.processedImages,
            duplicateGroups: duplicateGroupsData.length,
            totalDuplicates: results.similarImagesFound
          },
          duplicateGroups: duplicateGroupsData
        }, null, 2),
        'utf8'
      );
      
      console.log(`Обработка завершена. Найдено групп дубликатов: ${results.duplicateGroups.length}`);
      console.log(`Отчет сохранен в файл: ${reportFilePath}`);
      
      return {
        success: true,
        results,
        reportFilePath
      };
    } catch (error) {
      console.error('Ошибка при сканировании канала:', error);
      return {
        success: false,
        error: error.message
      };
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Закрытие клиентов и освобождение ресурсов
   */
  async close() {
    try {
      if (this.gramjsClient) {
        await this.gramjsClient.disconnect();
      }
      
      console.log('Ресурсы scanner освобождены');
    } catch (error) {
      console.error('Ошибка при закрытии клиентов:', error);
    }
  }
}

module.exports = UpdatedChannelScanner;