const { MTProto } = require('@mtproto/core');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

/**
 * Класс для получения истории сообщений из Telegram канала
 * с использованием библиотеки @mtproto/core для прямого доступа к MTProto API
 */
class MtprotoTelegramClient {
  constructor() {
    this.apiId = parseInt(process.env.API_ID);
    this.apiHash = process.env.API_HASH;
    this.sessionPath = path.join(__dirname, 'mtproto-session.json');
    this.tempFolder = './temp';
    this.client = null;
    
    // Убедимся, что временная папка существует
    if (!fs.existsSync(this.tempFolder)) {
      fs.mkdirSync(this.tempFolder, { recursive: true });
    }
    
    // Читаем сохраненную сессию, если она есть
    let session = {};
    if (fs.existsSync(this.sessionPath)) {
      try {
        const sessionData = fs.readFileSync(this.sessionPath, 'utf8');
        session = JSON.parse(sessionData);
      } catch (error) {
        console.error('Ошибка при чтении файла сессии:', error);
      }
    }
    
    // Создаем клиент MTProto
    this.client = new MTProto({
      api_id: this.apiId,
      api_hash: this.apiHash,
      storageOptions: {
        instance: session
      }
    });
    
    // Настраиваем обработчик для сохранения сессии
    this.client.setStorageUpdateHandler((data) => {
      fs.writeFileSync(this.sessionPath, JSON.stringify(data));
    });
  }

  /**
   * Обработка запроса авторизации
   * @private
   */
  async _handleAuth() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    // Запрашиваем номер телефона
    const phoneNumber = await new Promise(resolve => {
      rl.question('Введите номер телефона (с кодом страны): ', resolve);
    });
    
    try {
      // Запрашиваем код авторизации
      const { phone_code_hash } = await this.client.call('auth.sendCode', {
        phone_number: phoneNumber,
        settings: {
          _: 'codeSettings',
        }
      });
      
      // Запрашиваем код у пользователя
      const phoneCode = await new Promise(resolve => {
        rl.question('Введите код, который вы получили: ', resolve);
      });
      
      // Авторизуемся с полученным кодом
      const signInResult = await this.client.call('auth.signIn', {
        phone_number: phoneNumber,
        phone_code_hash,
        phone_code: phoneCode,
      });
      
      console.log('Авторизация успешна!');
      return signInResult;
    } catch (error) {
      if (error.error_message === 'SESSION_PASSWORD_NEEDED') {
        // Если требуется пароль двухфакторной аутентификации
        console.log('Требуется двухфакторная аутентификация');
        
        // Получаем информацию для двухфакторной аутентификации
        const passwordInfo = await this.client.call('account.getPassword');
        
        // Запрашиваем пароль у пользователя
        const password = await new Promise(resolve => {
          rl.question('Введите пароль двухфакторной аутентификации: ', resolve);
        });
        
        // Для простоты не реализуем полный алгоритм SRP, но в реальном приложении это нужно сделать
        const checkPasswordResult = await this.client.call('auth.checkPassword', {
          password: {
            _: 'inputCheckPasswordSRP',
            // Здесь должны быть правильные параметры SRP
          }
        });
        
        console.log('Авторизация с 2FA успешна!');
        return checkPasswordResult;
      } else {
        console.error('Ошибка авторизации:', error);
        throw error;
      }
    } finally {
      rl.close();
    }
  }

  /**
   * Проверка авторизации и авторизация при необходимости
   * @returns {Promise<Object>} - результат авторизации
   */
  async ensureAuth() {
    try {
      const authResult = await this.client.call('users.getFullUser', {
        id: {
          _: 'inputUserSelf'
        }
      });
      
      console.log('Пользователь уже авторизован');
      return authResult;
    } catch (error) {
      console.log('Требуется авторизация');
      return await this._handleAuth();
    }
  }

  /**
   * Получение информации о канале
   * @param {string} channelUsername - имя канала (без @)
   * @returns {Promise<Object>} - информация о канале
   */
  async resolveChannel(channelUsername) {
    try {
      await this.ensureAuth();
      
      const result = await this.client.call('contacts.resolveUsername', {
        username: channelUsername.replace(/^@/, '') // Удаляем @ в начале, если есть
      });
      
      // Находим канал в списке chats
      const channel = result.chats.find(chat => 
        chat._ === 'channel' || chat._ === 'channelForbidden');
        
      if (!channel) {
        throw new Error('Канал не найден');
      }
      
      console.log(`Канал найден: ${channel.title} (ID: ${channel.id})`);
      return channel;
    } catch (error) {
      console.error('Ошибка при получении информации о канале:', error);
      throw error;
    }
  }

  /**
   * Получение истории сообщений из канала
   * @param {string} channelUsername - имя канала или ID 
   * @param {number} limit - максимальное количество сообщений для получения
   * @param {number} offsetId - ID сообщения, с которого начинать
   * @returns {Promise<Array>} - массив сообщений
   */
  async getChannelHistory(channelUsername, limit = 100, offsetId = 0) {
    try {
      await this.ensureAuth();
      
      // Если передан ID канала
      let channel;
      if (channelUsername.toString().match(/^-?\d+$/)) {
        // Это числовой ID, создаем объект inputChannel
        const channelId = parseInt(channelUsername.toString().replace(/^-100/, ''));
        channel = {
          _: 'inputChannel',
          channel_id: channelId,
          access_hash: 0 // Нужно получить правильный access_hash
        };
      } else {
        // Это имя канала, получаем информацию
        channel = await this.resolveChannel(channelUsername);
      }
      
      // Создаем inputPeer для канала
      const inputPeer = {
        _: 'inputPeerChannel',
        channel_id: channel.id,
        access_hash: channel.access_hash || 0
      };
      
      console.log(`Получение истории канала ${channel.title || channelUsername}, лимит: ${limit}`);
      
      // Запрашиваем историю сообщений
      const history = await this.client.call('messages.getHistory', {
        peer: inputPeer,
        offset_id: offsetId,
        offset_date: 0,
        add_offset: 0,
        limit: limit,
        max_id: 0,
        min_id: 0,
        hash: 0
      });
      
      console.log(`Получено ${history.messages.length} сообщений`);
      return history;
    } catch (error) {
      console.error('Ошибка при получении истории канала:', error);
      throw error;
    }
  }

  /**
   * Получение всех сообщений из канала с поддержкой пагинации
   * @param {string} channelUsername - имя канала или ID
   * @param {number} batchSize - размер одной порции сообщений
   * @param {number} maxMessages - максимальное общее количество сообщений
   * @returns {Promise<Object>} - объект с сообщениями и связанными данными
   */
  async getAllChannelMessages(channelUsername, batchSize = 100, maxMessages = 1000) {
    try {
      await this.ensureAuth();
      
      console.log(`Получение всех сообщений из канала ${channelUsername}...`);
      
      let allMessages = [];
      let users = [];
      let chats = [];
      let offsetId = 0;
      let history;
      
      do {
        console.log(`Получение порции сообщений, смещение ID: ${offsetId}`);
        history = await this.getChannelHistory(channelUsername, batchSize, offsetId);
        
        if (history.messages.length > 0) {
          allMessages = [...allMessages, ...history.messages];
          users = [...users, ...history.users];
          chats = [...chats, ...history.chats];
          
          // Последнее сообщение в этой порции будет смещением для следующего запроса
          offsetId = history.messages[history.messages.length - 1].id;
          
          console.log(`Получено ${history.messages.length} сообщений, всего: ${allMessages.length}`);
          
          // Небольшая задержка, чтобы не перегружать API
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } while (history.messages.length === batchSize && allMessages.length < maxMessages);
      
      console.log(`Всего получено ${allMessages.length} сообщений`);
      
      return {
        messages: allMessages,
        users,
        chats
      };
    } catch (error) {
      console.error('Ошибка при получении всех сообщений:', error);
      return {
        messages: [],
        users: [],
        chats: []
      };
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
        message.media._ === 'messageMediaPhoto' || 
        (message.media._ === 'messageMediaDocument' && 
          message.media.document && 
          message.media.document.mime_type && 
          message.media.document.mime_type.startsWith('image/'))
      );
    });
  }

  /**
   * Скачивание файла с использованием MTProto API
   * @param {Object} inputFileLocation - объект с информацией о местоположении файла
   * @param {number} fileSize - размер файла
   * @param {string} outputPath - путь для сохранения файла
   * @returns {Promise<string>} - путь к сохраненному файлу
   */
  async downloadFile(inputFileLocation, fileSize, outputPath) {
    try {
      const CHUNK_SIZE = 1024 * 1024; // 1 MB
      const fileStream = fs.createWriteStream(outputPath);
      
      for (let offset = 0; offset < fileSize; offset += CHUNK_SIZE) {
        const limit = Math.min(CHUNK_SIZE, fileSize - offset);
        
        console.log(`Скачивание части файла: ${offset}-${offset + limit} из ${fileSize}`);
        
        const result = await this.client.call('upload.getFile', {
          location: inputFileLocation,
          offset: offset,
          limit: limit
        });
        
        if (result._ === 'upload.file') {
          fileStream.write(Buffer.from(result.bytes));
        } else {
          throw new Error('Неожиданный ответ от API');
        }
      }
      
      fileStream.end();
      console.log(`Файл сохранен: ${outputPath}`);
      return outputPath;
    } catch (error) {
      console.error('Ошибка при скачивании файла:', error);
      return null;
    }
  }

  /**
   * Скачивание фотографии из сообщения
   * @param {Object} message - сообщение с фотографией
   * @returns {Promise<string>} - путь к сохраненному файлу
   */
  async downloadMessagePhoto(message) {
    try {
      if (!message.media) {
        throw new Error('Сообщение не содержит медиафайлов');
      }
      
      let photo;
      let fileId;
      let inputFileLocation;
      let fileSize;
      
      if (message.media._ === 'messageMediaPhoto') {
        photo = message.media.photo;
        
        // Выбираем самый большой размер фото
        const photoSize = photo.sizes.reduce((prev, current) => {
          return (prev.w * prev.h > current.w * current.h) ? prev : current;
        });
        
        fileId = `${photo.id}-${photoSize.type}`;
        fileSize = photoSize.size || 1024 * 1024; // предполагаемый размер, если не указан
        
        inputFileLocation = {
          _: 'inputPhotoFileLocation',
          id: photo.id,
          access_hash: photo.access_hash,
          file_reference: photo.file_reference,
          thumb_size: photoSize.type
        };
      } else if (message.media._ === 'messageMediaDocument' && 
                message.media.document && 
                message.media.document.mime_type && 
                message.media.document.mime_type.startsWith('image/')) {
        const document = message.media.document;
        
        fileId = document.id;
        fileSize = document.size;
        
        inputFileLocation = {
          _: 'inputDocumentFileLocation',
          id: document.id,
          access_hash: document.access_hash,
          file_reference: document.file_reference,
          thumb_size: ''
        };
      } else {
        throw new Error('Неподдерживаемый тип медиа');
      }
      
      const outputPath = path.join(this.tempFolder, `${fileId}.jpg`);
      return await this.downloadFile(inputFileLocation, fileSize, outputPath);
    } catch (error) {
      console.error('Ошибка при скачивании фотографии:', error);
      return null;
    }
  }
}

module.exports = MtprotoTelegramClient; 