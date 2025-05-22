const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const imageHash = require('image-hash');
const config = require('./config');
const util = require('util');

// Промисификация функции вычисления хеша
const imageHashAsync = util.promisify(imageHash.imageHash);

/**
 * Вычисляет расстояние Хэмминга между двумя хешами (количество различающихся битов)
 * @param {string} hash1 - первый хеш
 * @param {string} hash2 - второй хеш
 * @returns {number} - расстояние Хэмминга (0-100, в процентах различия)
 */
function calculateHashDistance(hash1, hash2) {
  if (hash1.length !== hash2.length) {
    throw new Error('Хеши должны быть одинаковой длины');
  }
  
  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) {
      distance++;
    }
  }
  
  // Нормализуем расстояние в процентах (0-100)
  return (distance / hash1.length) * 100;
}

/**
 * Определяет, являются ли изображения похожими
 * @param {string} hash1 - первый хеш
 * @param {string} hash2 - второй хеш
 * @returns {boolean} - true, если изображения похожи
 */
function areImagesSimilar(hash1, hash2) {
  const distance = calculateHashDistance(hash1, hash2);
  return distance <= config.hashDifferenceThreshold;
}

/**
 * Определяет процент сходства между двумя хешами
 * @param {string} hash1 - первый хеш
 * @param {string} hash2 - второй хеш
 * @returns {number} - процент сходства (0-100)
 */
function calculateSimilarityPercentage(hash1, hash2) {
  const distance = calculateHashDistance(hash1, hash2);
  const maxDistance = hash1.length * 4; // Максимально возможное расстояние (каждый символ отличается на 4 бита)
  return 100 - (distance / maxDistance * 100);
}

/**
 * Группирует хеши по схожести
 * @param {Array<Object>} images - массив объектов с хешами
 * @param {number} threshold - порог сходства в процентах (0-100)
 * @returns {Array<Array<Object>>} - массив групп похожих изображений
 */
function groupSimilarImages(images, threshold = 95) {
  // Создаем глубокую копию массива входных изображений
  const imagesCopy = JSON.parse(JSON.stringify(images));
  const groups = [];
  const processedIds = new Set();
  
  for (let i = 0; i < imagesCopy.length; i++) {
    const currentImage = imagesCopy[i];
    
    // Пропускаем уже обработанные изображения
    if (processedIds.has(currentImage.messageId)) {
      continue;
    }
    
    // Создаем новую группу с текущим изображением
    const group = [currentImage];
    processedIds.add(currentImage.messageId);
    
    // Ищем похожие изображения
    for (let j = 0; j < imagesCopy.length; j++) {
      if (i === j) continue;
      
      const compareImage = imagesCopy[j];
      if (processedIds.has(compareImage.messageId)) {
        continue;
      }
      
      // Вычисляем сходство между изображениями
      const similarity = calculateSimilarityPercentage(currentImage.hash, compareImage.hash);
      
      // Если сходство выше порога, добавляем в группу
      if (similarity >= threshold) {
        group.push(compareImage);
        processedIds.add(compareImage.messageId);
      }
    }
    
    // Добавляем группу, только если в ней больше одного изображения
    if (group.length > 1) {
      groups.push(group);
    }
  }
  
  return groups;
}

/**
 * Создает отчет о найденных дубликатах
 * @param {Array<Array<Object>>} groups - группы похожих изображений 
 * @returns {string} - текстовый отчет
 */
function generateDuplicatesReport(groups) {
  if (groups.length === 0) {
    return 'Дубликаты не найдены';
  }
  
  let report = `Найдено ${groups.length} групп дубликатов\n\n`;
  
  groups.forEach((group, groupIndex) => {
    report += `Группа #${groupIndex + 1} (${group.length} изображений):\n`;
    report += `Хеш: ${group[0].hash}\n`;
    
    group.forEach((image, imageIndex) => {
      report += `  ${imageIndex + 1}. ID сообщения: ${image.messageId}, Дата: ${image.date || 'неизвестно'}\n`;
    });
    
    report += '\n';
  });
  
  return report;
}

class ImageHasher {
  constructor() {
    this.hashCache = new Map(); // кэш хешей для уже обработанных изображений
    this.tempDir = path.join(__dirname, 'temp');
    this.hashSettings = config.hashSettings;
    
    // Создаем временную директорию, если её нет
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Вычисляет хеш изображения
   * @param {Buffer|string} imageData - буфер с данными изображения или путь к файлу
   * @returns {Promise<string>} - хеш изображения
   */
  async calculateHash(imageData) {
    try {
      let imagePath;
      
      // Если передан буфер, сохраняем его во временный файл
      if (Buffer.isBuffer(imageData)) {
        const tempFilename = `temp_${Date.now()}.jpg`;
        imagePath = path.join(this.tempDir, tempFilename);
        await sharp(imageData).toFile(imagePath);
      } else {
        imagePath = imageData;
      }
      
      // Вычисляем хеш
      const hash = await imageHashAsync(
        imagePath, 
        this.hashSettings.hashSize, 
        this.hashSettings.hashMethod === 'blockhash'
      );
      
      // Если использовался временный файл, удаляем его
      if (Buffer.isBuffer(imageData)) {
        fs.unlinkSync(imagePath);
      }
      
      return hash;
    } catch (error) {
      console.error('Ошибка при вычислении хеша:', error);
      throw error;
    }
  }

  /**
   * Очищает кэш хешей
   */
  clearCache() {
    this.hashCache.clear();
  }

  /**
   * Очищает временную директорию
   */
  cleanupTempDir() {
    if (fs.existsSync(this.tempDir)) {
      const files = fs.readdirSync(this.tempDir);
      
      for (const file of files) {
        fs.unlinkSync(path.join(this.tempDir, file));
      }
    }
  }

  /**
   * Вычисление хеша изображения из файла
   * @param {string} filePath - путь к файлу
   * @returns {Promise<string>} - хеш изображения
   */
  async calculateHashFromFile(filePath) {
    try {
      const imageBuffer = fs.readFileSync(filePath);
      return await this.calculateHash(imageBuffer);
    } catch (error) {
      console.error('Ошибка при вычислении хеша из файла:', error);
      throw error;
    }
  }
}

const hasher = new ImageHasher();

module.exports = {
  calculateHash: hasher.calculateHash.bind(hasher),
  calculateHashFromFile: hasher.calculateHashFromFile.bind(hasher),
  areImagesSimilar,
  calculateHashDistance,
  calculateSimilarityPercentage,
  groupSimilarImages,
  generateDuplicatesReport,
  cleanupTempDir: hasher.cleanupTempDir.bind(hasher)
}; 