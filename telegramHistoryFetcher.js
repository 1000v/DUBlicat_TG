const { Api, TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

/**
 * Класс для получения истории сообщений из Telegram канала
 * использующий MTProto API через библиотеку gramjs
 */
class TelegramHistoryFetcher {
  constructor() {
    this.apiId = parseInt(process.env.API_ID);
    this.apiHash = process.env.API_HASH;
    this.sessionFilePath = path.join(__dirname, 'session.json');
    this.client = null;
    this.stringSession = null;
  }

  /**
   * Инициализация клиента Telegram
   * @returns {Promise<TelegramClient>} - экземпляр клиента
   */
  async init() {
    try {
      // Проверяем, есть ли сохраненная сессия
      let sessionData = '';
      if (fs.existsSync(this.sessionFilePath)) {
        sessionData = fs.readFileSync(this.sessionFilePath, 'utf8');
      }

      this.stringSession = new StringSession(sessionData);
      this.client = new TelegramClient(this.stringSession, this.apiId, this.apiHash, {
        connectionRetries: 5,
      });

      // Убрана явная установка DC, т.к. gramjs должен сам определять DC
      // await this.client.setDC(2, '149.154.167.50', 443);

      await this.client.connect();
      
      // Если не авторизованы, запускаем процесс авторизации
      if (!await this.client.isUserAuthorized()) {
        console.log('Требуется авторизация...');
        await this.client.start({
          phoneNumber: async () => await this._askQuestion('Введите номер телефона: '),
          password: async () => await this._askQuestion('Введите пароль (если есть): '),
          phoneCode: async () => await this._askQuestion('Введите код из Telegram: '),
          onError: (err) => console.log('Ошибка авторизации:', err),
        });

        // Сохраняем сессию для последующего использования
        const sessionString = this.client.session.save();
        fs.writeFileSync(this.sessionFilePath, sessionString);
        console.log('Сессия сохранена для последующего использования');
      } else {
        console.log('Авторизация успешна');
      }

      return this.client;
    } catch (error) {
      console.error('Ошибка при инициализации клиента:', error);
      throw error;
    }
  }

  /**
   * Получение сообщений из канала
   * @param {string} channelId - ID канала (с префиксом -100 для публичных каналов)
   * @param {number} limit - максимальное количество сообщений для получения
   * @returns {Promise<Array>} - массив сообщений
   */
  async getChannelMessages(channelId, limit = 100) {
    try {
      if (!this.client) {
        await this.init();
      }

      console.log(`Получение сообщений из канала ${channelId}, лимит: ${limit}`);
      
      // Получаем информацию о канале
      const channel = await this.client.getEntity(channelId);
      console.log(`Найден канал: ${channel.title}`);
      
      // Получаем сообщения
      const messages = await this.client.getMessages(channel, {
        limit: limit,
      });
      
      console.log(`Получено ${messages.length} сообщений`);
      return messages;
    } catch (error) {
      console.error('Ошибка при получении сообщений:', error);
      return [];
    }
  }

  /**
   * Получение всех сообщений из канала с поддержкой пагинации
   * @param {string} channelId - ID канала
   * @param {number} batchSize - размер одной порции сообщений
   * @param {number} maxMessages - максимальное общее количество сообщений
   * @returns {Promise<Array>} - массив всех полученных сообщений
   */
  async getAllChannelMessages(channelId, batchSize = 100, maxMessages = 1000) {
    try {
      if (!this.client) {
        await this.init();
      }

      console.log(`Получение всех сообщений из канала ${channelId}...`);
      
      // Получаем информацию о канале
      const channel = await this.client.getEntity(channelId);
      console.log(`Найден канал: ${channel.title}`);
      
      let allMessages = [];
      let offsetId = 0;
      let fetchedMessages;
      
      do {
        console.log(`Получение порции сообщений, смещение ID: ${offsetId}`);
        fetchedMessages = await this.client.getMessages(channel, {
          limit: batchSize,
          offsetId: offsetId,
        });
        
        if (fetchedMessages.length > 0) {
          allMessages = [...allMessages, ...fetchedMessages];
          offsetId = fetchedMessages[fetchedMessages.length - 1].id;
          console.log(`Получено ${fetchedMessages.length} сообщений, всего: ${allMessages.length}`);
          
          // Небольшая задержка, чтобы не перегружать API
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } while (fetchedMessages.length === batchSize && allMessages.length < maxMessages);
      
      console.log(`Всего получено ${allMessages.length} сообщений`);
      return allMessages;
    } catch (error) {
      console.error('Ошибка при получении всех сообщений:', error);
      return [];
    }
  }

  /**
   * Фильтрация сообщений, содержащих изображения
   * @param {Array} messages - массив сообщений
   * @returns {Array} - массив сообщений с изображениями
   */
  filterMessagesWithPhotos(messages) {
    return messages.filter(message => {
      return message.media && (
        message.media.photo || 
        (message.media.document && 
          message.media.document.mimeType && 
          message.media.document.mimeType.startsWith('image/'))
      );
    });
  }

  /**
   * Скачивание изображения из сообщения
   * @param {Object} message - сообщение с изображением
   * @param {string} outputDir - директория для сохранения изображения
   * @returns {Promise<string>} - путь к сохраненному файлу
   */
  async downloadMessagePhoto(message, outputDir = './temp') {
    try {
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      console.log(`Скачивание фото из сообщения ID: ${message.id}`);
      console.log(`Структура сообщения:`, JSON.stringify(message.media).substring(0, 500));

      let fileId;
      let fileExtension = '.jpg';

      // Расширенная проверка типа медиа для извлечения ID файла
      if (message.media && message.media.photo) {
        console.log(`Найдено фото, получаем ID...`);
        fileId = message.media.photo.id;
      } else if (message.media && message.media._ === 'messageMediaPhoto' && message.media.photo) {
        console.log(`Найдено messageMediaPhoto, получаем ID...`);
        fileId = message.media.photo.id;
      } else if (message.media && message.media.document && 
                message.media.document.mimeType && 
                message.media.document.mimeType.startsWith('image/')) {
        console.log(`Найден документ типа изображение, получаем ID...`);
        fileId = message.media.document.id;
        
        // Установка правильного расширения файла на основе MIME-типа
        const mimeType = message.media.document.mimeType;
        if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
          fileExtension = '.jpg';
        } else if (mimeType === 'image/png') {
          fileExtension = '.png';
        } else if (mimeType === 'image/gif') {
          fileExtension = '.gif';
        } else if (mimeType === 'image/webp') {
          fileExtension = '.webp';
        }
      } else {
        // Попробуем найти любой медиа-контент, который может быть изображением
        console.log(`Стандартная структура фото не найдена, ищем альтернативные пути...`);
        
        // Проверяем, есть ли дополнительные поля, которые могут содержать изображение
        if (message.media && message.media.webpage && message.media.webpage.photo) {
          console.log(`Найдено изображение в веб-странице, получаем ID...`);
          fileId = message.media.webpage.photo.id;
        } else if (message.photo) {
          console.log(`Найдено прямое поле photo, получаем ID...`);
          // В Bot API фото представлено массивом разных размеров - берем самый большой
          const photo = Array.isArray(message.photo) ? 
            message.photo[message.photo.length - 1] : message.photo;
          fileId = photo.id || photo.file_id;
        } else {
          // Если не нашли изображение стандартным способом - выводим детальную структуру для отладки
          console.log(`Не удалось определить ID изображения, полная структура сообщения:`, 
            JSON.stringify(message).substring(0, 1000));
          throw new Error('Сообщение не содержит изображения или структура не распознана');
        }
      }

      console.log(`Извлечен ID файла: ${fileId}`);
      const filePath = path.join(outputDir, `${fileId}${fileExtension}`);
      
      console.log(`Скачивание медиа в файл: ${filePath}`);
      
      try {
        // Скачиваем файл
        const buffer = await this.client.downloadMedia(message.media, {
          outputFile: filePath,
        });

        console.log(`Изображение успешно сохранено: ${filePath}`);
        return filePath;
      } catch (downloadError) {
        console.error(`Ошибка при скачивании через downloadMedia:`, downloadError);
        
        // Если стандартный метод не сработал, попробуем альтернативные методы скачивания
        console.log(`Пробуем альтернативные методы скачивания...`);
        
        // Попытка получить фото через getFileHack (если такой метод существует)
        try {
          if (typeof this.client.getFile === 'function') {
            console.log(`Попытка скачивания через getFile...`);
            const file = await this.client.getFile(message.media);
            fs.writeFileSync(filePath, file);
            console.log(`Изображение успешно сохранено через getFile: ${filePath}`);
            return filePath;
          }
        } catch (getFileError) {
          console.error(`Ошибка при скачивании через getFile:`, getFileError);
        }
        
        // Не удалось скачать файл ни одним из методов
        throw new Error('Не удалось скачать изображение ни одним из доступных методов');
      }
    } catch (error) {
      console.error('Ошибка при скачивании изображения:', error);
      return null;
    }
  }

  /**
   * Закрытие соединения с Telegram
   */
  async disconnect() {
    if (this.client) {
      await this.client.disconnect();
      console.log('Соединение с Telegram закрыто');
    }
  }

  /**
   * Вспомогательный метод для запроса ввода
   * @param {string} question - вопрос для пользователя
   * @returns {Promise<string>} - ответ пользователя
   * @private
   */
  _askQuestion(question) {
    return new Promise(resolve => {
      process.stdout.write(question);
      process.stdin.once('data', data => {
        resolve(data.toString().trim());
      });
    });
  }
}

module.exports = TelegramHistoryFetcher; 