const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

/**
 * Класс для получения истории сообщений из Telegram канала
 * с использованием прямых HTTP запросов к API Telegram
 */
class DirectTelegramApiFetcher {
  constructor() {
    this.apiId = process.env.API_ID;
    this.apiHash = process.env.API_HASH;
    this.botToken = process.env.TELEGRAM_BOT_TOKEN;
    this.baseUrl = `https://api.telegram.org/bot${this.botToken}`;
    this.tempFolder = './temp';
    
    // Убедимся, что временная папка существует
    if (!fs.existsSync(this.tempFolder)) {
      fs.mkdirSync(this.tempFolder, { recursive: true });
    }
  }

  /**
   * Получение информации о канале
   * @param {string} channelId - ID канала или username
   * @returns {Promise<Object>} - информация о канале
   */
  async getChannelInfo(channelId) {
    try {
      const response = await axios.get(`${this.baseUrl}/getChat`, {
        params: {
          chat_id: channelId
        }
      });
      
      if (response.data.ok) {
        return response.data.result;
      } else {
        throw new Error(`Ошибка при получении информации о канале: ${response.data.description}`);
      }
    } catch (error) {
      console.error('Ошибка при получении информации о канале:', error.message);
      return null;
    }
  }

  /**
   * Получение истории сообщений из канала 
   * (эта функция использует метод getUpdates, который имеет ограничения)
   * @param {string} channelId - ID канала
   * @param {number} limit - максимальное количество сообщений для получения
   * @returns {Promise<Array>} - массив сообщений
   */
  async getChannelMessages(channelId, limit = 100) {
    try {
      // Для getUpdates нужно убедиться, что бот подписан на канал
      // и имеет права администратора
      const response = await axios.get(`${this.baseUrl}/getUpdates`, {
        params: {
          allowed_updates: ['channel_post'],
          limit: limit
        }
      });
      
      if (response.data.ok) {
        // Фильтруем сообщения по ID канала
        const channelMessages = response.data.result
          .filter(update => update.channel_post && 
                update.channel_post.chat.id.toString() === channelId.toString())
          .map(update => update.channel_post);
          
        console.log(`Получено ${channelMessages.length} сообщений из канала с ID ${channelId}`);
        return channelMessages;
      } else {
        throw new Error(`Ошибка при получении сообщений: ${response.data.description}`);
      }
    } catch (error) {
      console.error('Ошибка при получении сообщений из канала:', error.message);
      return [];
    }
  }

  /**
   * Прямой запрос к методу messages.getHistory через HTTP 
   * (требует авторизации пользователя, а не бота)
   * @param {string} channelId - ID канала (с префиксом -100 для публичных каналов)
   * @param {number} limit - максимальное количество сообщений для получения
   * @param {number} offsetId - ID сообщения, с которого начинать
   * @returns {Promise<Array>} - массив сообщений
   */
  async getChannelHistoryRaw(channelId, limit = 100, offsetId = 0) {
    try {
      // Для этого метода требуется пользовательская авторизация
      // Поэтому вместо этого используется API из telegramHistoryFetcher.js
      console.log('Этот метод требует полных данных аутентификации пользователя.');
      console.log('Рекомендуется использовать telegramHistoryFetcher.js вместо этого метода.');
      return [];
    } catch (error) {
      console.error('Ошибка при прямом запросе к API:', error.message);
      return [];
    }
  }

  /**
   * Получение сообщений из канала с использованием метода getMessages
   * (бот должен быть администратором канала)
   * @param {string} channelId - ID канала
   * @param {Array<number>} messageIds - массив ID сообщений для получения
   * @returns {Promise<Array>} - массив сообщений
   */
  async getChannelSpecificMessages(channelId, messageIds) {
    try {
      // Для метода channels.getMessages требуется ID канала без префикса -100
      const channelNumericId = channelId.toString().startsWith('-100') ? 
        channelId.toString().substring(4) : channelId;
      
      const response = await axios.get(`${this.baseUrl}/getMessages`, {
        params: {
          chat_id: channelId,
          message_ids: JSON.stringify(messageIds)
        }
      });
      
      if (response.data.ok) {
        console.log(`Получено ${response.data.result.length} сообщений из ${messageIds.length} запрошенных`);
        return response.data.result;
      } else {
        throw new Error(`Ошибка при получении конкретных сообщений: ${response.data.description}`);
      }
    } catch (error) {
      // Если метод не поддерживается Bot API, предложим альтернативу
      if (error.response && error.response.data && error.response.data.description === 'Bad Request: method not found') {
        console.log('Метод getMessages не поддерживается Bot API. Используйте MTProto API вместо этого.');
      } else {
        console.error('Ошибка при получении конкретных сообщений:', error.message);
      }
      return [];
    }
  }

  /**
   * Скачивание фотографии из сообщения
   * @param {string} fileId - ID файла в Telegram
   * @returns {Promise<string>} - путь к сохраненному файлу
   */
  async downloadPhoto(fileId) {
    try {
      // Получаем информацию о файле
      const fileInfoResponse = await axios.get(`${this.baseUrl}/getFile`, {
        params: {
          file_id: fileId
        }
      });
      
      if (!fileInfoResponse.data.ok) {
        throw new Error(`Ошибка при получении информации о файле: ${fileInfoResponse.data.description}`);
      }
      
      const filePath = fileInfoResponse.data.result.file_path;
      const fileUrl = `https://api.telegram.org/file/bot${this.botToken}/${filePath}`;
      
      // Скачиваем файл
      const response = await axios({
        method: 'get',
        url: fileUrl,
        responseType: 'arraybuffer'
      });
      
      const downloadPath = path.join(this.tempFolder, `${fileId}.jpg`);
      fs.writeFileSync(downloadPath, Buffer.from(response.data));
      
      console.log(`Изображение сохранено: ${downloadPath}`);
      return downloadPath;
    } catch (error) {
      console.error('Ошибка при скачивании фотографии:', error.message);
      return null;
    }
  }

  /**
   * Проверка, является ли бот администратором канала
   * @param {string} channelId - ID канала
   * @returns {Promise<boolean>} - true, если бот является администратором
   */
  async isBotChannelAdmin(channelId) {
    try {
      // Получаем информацию о боте
      const botInfoResponse = await axios.get(`${this.baseUrl}/getMe`);
      
      if (!botInfoResponse.data.ok) {
        throw new Error(`Ошибка при получении информации о боте: ${botInfoResponse.data.description}`);
      }
      
      const botId = botInfoResponse.data.result.id;
      
      // Получаем администраторов канала
      const adminsResponse = await axios.get(`${this.baseUrl}/getChatAdministrators`, {
        params: {
          chat_id: channelId
        }
      });
      
      if (!adminsResponse.data.ok) {
        throw new Error(`Ошибка при получении списка администраторов: ${adminsResponse.data.description}`);
      }
      
      // Проверяем, есть ли наш бот среди администраторов
      const isAdmin = adminsResponse.data.result.some(admin => admin.user.id === botId);
      
      console.log(isAdmin ? 
        'Бот является администратором канала' : 
        'Бот НЕ является администратором канала');
        
      return isAdmin;
    } catch (error) {
      console.error('Ошибка при проверке прав администратора:', error.message);
      return false;
    }
  }

  /**
   * Получение ID всех сообщений в канале (эмуляция)
   * @param {string} channelId - ID канала
   * @param {number} estimatedCount - примерное количество сообщений в канале
   * @returns {Array<number>} - массив ID сообщений
   */
  generateMessageIds(channelId, estimatedCount = 1000) {
    // В Bot API нет прямого способа получить все ID сообщений в канале
    // Поэтому мы можем только предположить диапазон ID
    console.log(`Генерирую примерный список ID сообщений для канала ${channelId}`);
    
    // Предполагаем, что ID сообщений последовательны и начинаются с 1
    const messageIds = Array.from({ length: estimatedCount }, (_, i) => i + 1);
    
    console.log(`Сгенерировано ${messageIds.length} ID сообщений`);
    return messageIds;
  }
}

module.exports = DirectTelegramApiFetcher; 