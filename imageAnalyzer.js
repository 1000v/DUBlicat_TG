const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const imageHasher = require('./imageHasher');
const imageDatabase = require('./imageDatabase');
const config = require('./config');

/**
 * Класс для расширенного анализа изображений
 */
class ImageAnalyzer {
  constructor() {
    this.logDir = path.join(__dirname, 'logs');
    
    // Создаем директорию для логов, если её нет
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }
  
  /**
   * Создает корректную ссылку на сообщение в Telegram
   * @param {Object} image - информация об изображении
   * @returns {string} - URL ссылка на сообщение
   */
  createMessageLink(image) {
    const chatId = image.chatId ? image.chatId.toString() : '';
    const messageId = image.messageId;
    
    // Если chatId начинается с -100, это закрытый канал
    if (chatId && chatId.startsWith('-100')) {
      // Для закрытых каналов формат ссылки: https://t.me/c/{channel_id_without_-100}/{message_id}
      const channelId = chatId.substring(4); // Убираем префикс -100
      return `https://t.me/c/${channelId}/${messageId}`;
    } else if (chatId) {
      // Для открытых каналов формат ссылки: https://t.me/{username}/{message_id}
      // Если есть channelUsername, используем его, иначе используем chatId
      const channelName = image.channelUsername || chatId;
      return `https://t.me/${channelName}/${messageId}`;
    }
    
    // Если невозможно создать ссылку, возвращаем пустую строку
    return '';
  }
  
  /**
   * Анализирует все изображения в базе данных и ищет группы похожих изображений
   * @returns {Promise<Array>} - массив групп похожих изображений
   */
  async findSimilarGroups() {
    const images = imageDatabase.getAllImages();
    const groups = [];
    const processedIds = new Set();
    
    for (const image of images) {
      // Пропускаем уже обработанные изображения
      if (processedIds.has(image.fileId)) {
        continue;
      }
      
      const similarImages = imageDatabase.findSimilarImages(image.hash, (hash1, hash2) => {
        return imageHasher.areImagesSimilar(hash1, hash2);
      });
      
      // Если найдено более одного похожего изображения (включая текущее)
      if (similarImages.length > 1) {
        const group = {
          baseImage: image,
          similarImages: similarImages.filter(img => img.fileId !== image.fileId)
        };
        
        groups.push(group);
        
        // Добавляем все ID из группы в обработанные
        similarImages.forEach(img => processedIds.add(img.fileId));
      }
    }
    
    return groups;
  }
  
  /**
   * Генерирует HTML-отчет о группах похожих изображений
   * @param {Array} groups - массив групп похожих изображений
   * @returns {Promise<string>} - путь к созданному HTML-файлу
   */
  async generateHtmlReport(groups) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(this.logDir, `similar_images_${timestamp}.html`);
    
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Отчет о похожих изображениях</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          .group { margin-bottom: 30px; border: 1px solid #ccc; padding: 15px; border-radius: 5px; }
          .group-header { font-weight: bold; margin-bottom: 10px; }
          .image-list { display: flex; flex-wrap: wrap; }
          .image-item { margin: 10px; text-align: center; }
          .image-info { margin-top: 5px; font-size: 0.8em; }
          table { border-collapse: collapse; width: 100%; margin-top: 20px; }
          th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
          th { background-color: #f2f2f2; }
          .link { color: #0366d6; text-decoration: none; }
          .link:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <h1>Отчет о похожих изображениях</h1>
        <p>Дата создания: ${new Date().toLocaleString()}</p>
        <p>Всего групп похожих изображений: ${groups.length}</p>
        
        <table>
          <tr>
            <th>Группа</th>
            <th>Базовое изображение</th>
            <th>Количество похожих</th>
            <th>Минимальное сходство</th>
            <th>Максимальное сходство</th>
            <th>Ссылка</th>
          </tr>
    `;
    
    groups.forEach((group, index) => {
      const similarities = group.similarImages.map(img => {
        const distance = imageHasher.calculateHashDistance(group.baseImage.hash, img.hash);
        return 100 - distance;
      });
      
      const minSimilarity = Math.min(...similarities).toFixed(2);
      const maxSimilarity = Math.max(...similarities).toFixed(2);
      const baseImageLink = this.createMessageLink(group.baseImage);
      
      html += `
        <tr>
          <td>${index + 1}</td>
          <td>ID: ${group.baseImage.messageId}</td>
          <td>${group.similarImages.length}</td>
          <td>${minSimilarity}%</td>
          <td>${maxSimilarity}%</td>
          <td>${baseImageLink ? `<a href="${baseImageLink}" class="link" target="_blank">Открыть</a>` : 'Нет ссылки'}</td>
        </tr>
      `;
    });
    
    html += `
        </table>
        
        <h2>Детальная информация по группам</h2>
    `;
    
    groups.forEach((group, index) => {
      const baseImageLink = this.createMessageLink(group.baseImage);
      
      html += `
        <div class="group">
          <div class="group-header">
            Группа ${index + 1} - Базовое изображение (ID: ${group.baseImage.messageId})
            ${baseImageLink ? `<a href="${baseImageLink}" class="link" target="_blank">${baseImageLink}</a>` : ''}
          </div>
          <div class="image-list">
      `;
      
      // Добавляем информацию о похожих изображениях
      group.similarImages.forEach(img => {
        const distance = imageHasher.calculateHashDistance(group.baseImage.hash, img.hash);
        const similarity = (100 - distance).toFixed(2);
        const imageLink = this.createMessageLink(img);
        
        html += `
          <div class="image-item">
            <div class="image-info">
              ID: ${img.messageId}<br>
              Сходство: ${similarity}%<br>
              Размер: ${img.width}x${img.height}<br>
              Дата: ${img.timestamp ? new Date(img.timestamp * 1000).toLocaleString() : 'неизвестно'}<br>
              ${imageLink ? `<a href="${imageLink}" class="link" target="_blank">Открыть сообщение</a>` : ''}
            </div>
          </div>
        `;
      });
      
      html += `
          </div>
        </div>
      `;
    });
    
    html += `
      </body>
      </html>
    `;
    
    await fs.promises.writeFile(reportPath, html, 'utf8');
    return reportPath;
  }
  
  /**
   * Генерирует текстовый журнал о группах похожих изображений
   * @param {Array} groups - массив групп похожих изображений
   * @returns {Promise<string>} - путь к созданному текстовому файлу
   */
  async generateTextLog(groups) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logPath = path.join(this.logDir, `similar_images_${timestamp}.txt`);
    
    let logContent = `Отчет о похожих изображениях\n`;
    logContent += `Дата создания: ${new Date().toLocaleString()}\n`;
    logContent += `Всего групп похожих изображений: ${groups.length}\n\n`;
    
    groups.forEach((group, index) => {
      const baseImageLink = this.createMessageLink(group.baseImage);
      
      logContent += `Группа ${index + 1}:\n`;
      logContent += `  Базовое изображение: ID ${group.baseImage.messageId}\n`;
      if (baseImageLink) {
        logContent += `  Ссылка: ${baseImageLink}\n`;
      }
      logContent += `  Количество похожих изображений: ${group.similarImages.length}\n`;
      
      group.similarImages.forEach((img, imgIndex) => {
        const distance = imageHasher.calculateHashDistance(group.baseImage.hash, img.hash);
        const similarity = (100 - distance).toFixed(2);
        const imageLink = this.createMessageLink(img);
        
        logContent += `  ${imgIndex + 1}. ID: ${img.messageId}, Сходство: ${similarity}%\n`;
        if (imageLink) {
          logContent += `     Ссылка: ${imageLink}\n`;
        }
      });
      
      logContent += '\n';
    });
    
    await fs.promises.writeFile(logPath, logContent, 'utf8');
    return logPath;
  }
  
  /**
   * Создает полный отчет о похожих изображениях в различных форматах
   * @returns {Promise<Object>} - пути к созданным файлам отчетов
   */
  async createSimilarityReport() {
    const groups = await this.findSimilarGroups();
    
    const htmlReportPath = await this.generateHtmlReport(groups);
    const textLogPath = await this.generateTextLog(groups);
    
    return {
      groups,
      htmlReportPath,
      textLogPath
    };
  }
}

module.exports = new ImageAnalyzer(); 