require('dotenv').config();

module.exports = {
  // Токен Telegram бота, полученный от BotFather
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  
  // ID канала, из которого будут извлекаться изображения
  channelId: process.env.CHANNEL_ID,
  
  // Порог различия хешей, ниже которого изображения считаются похожими (0-100)
  // Чем ниже значение, тем более похожими должны быть изображения
  hashDifferenceThreshold: parseInt(process.env.HASH_DIFFERENCE_THRESHOLD) || 10,
  
  // Настройки для вычисления хеша
  hashSettings: {
    // Размер изображения для вычисления хеша (квадрат)
    hashSize: 16,
    
    // Метод хеширования: 'blockhash', 'phash' или 'dhash'
    hashMethod: 'phash'
  },
  
  // Максимальное количество изображений для сравнения (влияет на использование памяти)
  maxImagesInMemory: 100,
  
  // Папка для временного хранения изображений (если требуется)
  tempFolder: './temp',
  
  // Автоматическая обработка фотографий из каналов
  autoProcessChannelPhotos: process.env.AUTO_PROCESS_CHANNEL_PHOTOS === 'true' || false,
  
  // Интервал автоматического сканирования каналов (в минутах)
  // 0 означает отключение автоматического сканирования
  // По умолчанию: 60 минут (1 час)
  autoScanInterval: parseInt(process.env.AUTO_SCAN_INTERVAL) || 60,
  
  // Настройки облегченного режима сканирования
  liteMode: {
    // Размер пакета сообщений для сканирования за один раз
    batchSize: parseInt(process.env.LITE_MODE_BATCH_SIZE) || 100,
    
    // Задержка между пакетами в секундах
    cooldownSeconds: parseInt(process.env.LITE_MODE_COOLDOWN) || 3
  },
  
  // Директория для хранения логов
  logsFolder: './logs'
}; 