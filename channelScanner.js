const config = require('./config');
const axios = require('axios');
const imageHasher = require('./imageHasher');
const imageDatabase = require('./imageDatabase');

/**
 * Класс для сканирования каналов Telegram
 */
class ChannelScanner {
  constructor(bot) {
    this.bot = bot;
    this.isScanning = false;
    this.processedMessageIds = new Set(); // Для предотвращения повторной обработки
  }

  /**
   * Получение истории сообщений из канала
   * @param {string} channelId - ID канала
   * @param {number} limit - максимальное количество сообщений для получения
   * @param {number} offset - смещение сообщений
   * @returns {Promise<Array>} - массив сообщений
   */
  async getChannelHistory(channelId, limit = 100, offset = 0) {
    try {
      // Здесь мы используем API метод getChat для проверки доступа к каналу
      const chat = await this.bot.getChat(channelId);
      console.log(`Получение истории канала: ${chat.title || channelId}`);
      
      // Используем API метод getUpdates для получения сообщений
      const updates = await this.bot.getUpdates({
        allowed_updates: ['channel_post'],
        offset: -limit - offset,
        limit
      });
      
      // Фильтруем сообщения по ID канала
      return updates
        .filter(update => update.channel_post && 
          update.channel_post.chat.id.toString() === channelId.toString())
        .map(update => update.channel_post);
    } catch (error) {
      console.error('Ошибка при получении истории канала:', error.message);
      return [];
    }
  }

  /**
   * Обработка фотографии из сообщения
   * @param {Object} message - сообщение с фотографией
   * @returns {Promise<Object>} - результат обработки
   */
  async processPhoto(message) {
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
      console.error('Ошибка при обработке фото:', error);
      return { processed: false, error: error.message };
    }
  }

  /**
   * Сканирование канала и обработка всех изображений
   * @param {string} channelId - ID канала
   * @param {number} limit - максимальное количество сообщений для обработки
   * @returns {Promise<Object>} - результаты сканирования
   */
  async scanChannel(channelId, limit = 100) {
    if (this.isScanning) {
      return { success: false, message: 'Сканирование уже выполняется' };
    }
    
    this.isScanning = true;
    const results = {
      totalMessages: 0,
      processedImages: 0,
      similarImagesFound: 0,
      errors: 0
    };
    
    try {
      const channel = channelId || config.channelId;
      
      if (!channel) {
        throw new Error('ID канала не указан');
      }
      
      console.log(`Начинаем сканирование канала ${channel}`);
      
      const messages = await this.getChannelHistory(channel, limit);
      results.totalMessages = messages.length;
      
      console.log(`Получено ${messages.length} сообщений из канала`);
      
      // Проходим по всем сообщениям и обрабатываем фотографии
      for (const message of messages) {
        if (message.photo) {
          const processResult = await this.processPhoto(message);
          
          if (processResult.processed) {
            results.processedImages++;
            
            if (processResult.similarImages && processResult.similarImages.length > 0) {
              results.similarImagesFound += processResult.similarImages.length;
            }
          } else if (processResult.error) {
            results.errors++;
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
}

module.exports = ChannelScanner; 