const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const config = require('./config');
const _ = require('lodash');
const sqlite3 = require('sqlite3').verbose();

const writeFileAsync = promisify(fs.writeFile);
const readFileAsync = promisify(fs.readFile);

/**
 * Класс для хранения и управления базой данных изображений
 * с поддержкой SQLite для более эффективного хранения
 */
class ImageDatabase {
  constructor() {
    this.images = []; // Временный кэш изображений в памяти
    this.dbPath = path.join(__dirname, 'image_database.json'); // Путь для совместимости со старой версией
    this.sqliteDbPath = path.join(__dirname, 'image_database.sqlite'); // Путь к файлу SQLite БД
    this.db = null; // Экземпляр SQLite базы данных
    this.loaded = false;
    this.useSqlite = true; // Флаг использования SQLite
  }

  /**
   * Инициализирует SQLite базу данных
   * @private
   */
  async _initSqliteDb() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.sqliteDbPath, (err) => {
        if (err) {
          console.error('Ошибка при открытии SQLite базы данных:', err);
          reject(err);
          return;
        }
        
        // Создаем таблицу, если она не существует
        this.db.run(`CREATE TABLE IF NOT EXISTS images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          fileId TEXT,
          hash TEXT,
          messageId INTEGER,
          chatId TEXT,
          userId TEXT,
          fileSize INTEGER,
          width INTEGER,
          height INTEGER,
          timestamp INTEGER,
          source TEXT,
          addedAt TEXT,
          UNIQUE(fileId)
        )`, (err) => {
          if (err) {
            console.error('Ошибка при создании таблицы:', err);
            reject(err);
            return;
          }
          
          // Создаем индекс для ускорения поиска по хешу
          this.db.run(`CREATE INDEX IF NOT EXISTS idx_hash ON images(hash)`, (err) => {
            if (err) {
              console.error('Ошибка при создании индекса:', err);
              reject(err);
              return;
            }
            
            console.log('SQLite база данных инициализирована успешно');
            resolve();
          });
        });
      });
    });
  }

  /**
   * Загружает все изображения из SQLite в память
   * @private
   */
  async _loadImagesFromSqlite() {
    return new Promise((resolve, reject) => {
      this.db.all(`SELECT * FROM images`, (err, rows) => {
        if (err) {
          console.error('Ошибка при загрузке данных из SQLite:', err);
          reject(err);
          return;
        }
        
        this.images = rows;
        console.log(`Загружено ${this.images.length} изображений из SQLite базы данных`);
        resolve(rows);
      });
    });
  }

  /**
   * Загружает базу данных
   * (Автоматически использует SQLite если доступно, иначе использует JSON)
   */
  async load() {
    try {
      if (this.useSqlite) {
        try {
          // Инициализируем SQLite
          await this._initSqliteDb();
          
          // Если существует старая JSON база, импортируем её
          if (fs.existsSync(this.dbPath) && !fs.existsSync(this.sqliteDbPath)) {
            console.log('Обнаружена старая JSON база данных, импортируем в SQLite...');
            const data = await readFileAsync(this.dbPath, 'utf8');
            const jsonImages = JSON.parse(data);
            
            // Импортируем данные
            for (const img of jsonImages) {
              await this._addImageToSqlite(img);
            }
            
            console.log(`Импортировано ${jsonImages.length} изображений из JSON в SQLite`);
            
            // Переименовываем старый файл в .bak
            fs.renameSync(this.dbPath, `${this.dbPath}.bak`);
          }
          
          // Загружаем данные из SQLite в память
          await this._loadImagesFromSqlite();
          this.loaded = true;
        } catch (sqliteError) {
          console.error('Ошибка при работе с SQLite:', sqliteError);
          console.log('Переключаемся на использование JSON базы данных');
          this.useSqlite = false;
          await this._loadFromJson();
        }
      } else {
        // Используем старый JSON формат
        await this._loadFromJson();
      }
    } catch (error) {
      console.error('Ошибка при загрузке базы данных:', error);
      this.images = [];
    }
  }

  /**
   * Загружает базу данных из JSON формата (старый метод)
   * @private
   */
  async _loadFromJson() {
    try {
      if (fs.existsSync(this.dbPath)) {
        const data = await readFileAsync(this.dbPath, 'utf8');
        this.images = JSON.parse(data);
        console.log(`Загружено ${this.images.length} изображений из JSON базы данных`);
      } else {
        this.images = [];
        console.log('JSON база данных не найдена, создаем новую');
      }
      this.loaded = true;
    } catch (error) {
      console.error('Ошибка при загрузке из JSON:', error);
      this.images = [];
    }
  }

  /**
   * Сохраняет базу данных
   */
  async save() {
    if (this.useSqlite) {
      console.log(`Данные в SQLite уже сохранены автоматически (${this.images.length} изображений)`);
      return;
    }
    
    // Если не используется SQLite, сохраняем в JSON
    try {
      const data = JSON.stringify(this.images, null, 2);
      await writeFileAsync(this.dbPath, data, 'utf8');
      console.log(`Сохранено ${this.images.length} изображений в JSON базу данных`);
    } catch (error) {
      console.error('Ошибка при сохранении JSON базы данных:', error);
    }
  }

  /**
   * Добавляет новое изображение в SQLite базу данных
   * @param {Object} imageInfo - информация об изображении
   * @returns {Promise<boolean>} - успешно ли добавлено изображение
   * @private
   */
  async _addImageToSqlite(imageInfo) {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO images 
        (fileId, hash, messageId, chatId, userId, fileSize, width, height, timestamp, source, addedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run(
        imageInfo.fileId,
        imageInfo.hash,
        imageInfo.messageId,
        imageInfo.chatId,
        imageInfo.userId,
        imageInfo.fileSize || 0,
        imageInfo.width || 0,
        imageInfo.height || 0,
        imageInfo.timestamp || Math.floor(Date.now() / 1000),
        imageInfo.source || 'unknown',
        imageInfo.addedAt || new Date().toISOString(),
        function(err) {
          if (err) {
            console.error('Ошибка при добавлении изображения в SQLite:', err);
            resolve(false);
            return;
          }
          
          // Изображение успешно добавлено
          resolve(this.changes > 0);
        }
      );
      
      stmt.finalize();
    });
  }

  /**
   * Добавляет новое изображение в базу данных
   * @param {Object} imageInfo - информация об изображении
   * @returns {boolean} - true, если изображение успешно добавлено
   */
  async addImage(imageInfo) {
    // Проверяем, загружена ли база данных
    if (!this.loaded) {
      throw new Error('База данных не загружена');
    }

    // Используем SQLite, если доступно
    if (this.useSqlite) {
      const added = await this._addImageToSqlite(imageInfo);
      
      if (added) {
        // Добавляем в кэш в памяти
        this.images.push({
          ...imageInfo,
          addedAt: imageInfo.addedAt || new Date().toISOString()
        });
        
        // Если достигнут лимит изображений в памяти, удаляем самые старые
        if (this.images.length > config.maxImagesInMemory) {
          this.images = _.sortBy(this.images, 'addedAt').slice(-config.maxImagesInMemory);
        }
      }
      
      return added;
    } else {
      // Старый метод с JSON
      const exists = this.images.some(img => img.fileId === imageInfo.fileId);
      
      if (!exists) {
        this.images.push({
          ...imageInfo,
          addedAt: new Date().toISOString()
        });
        
        // Если достигнут лимит изображений, удаляем самые старые
        if (this.images.length > config.maxImagesInMemory) {
          this.images = _.sortBy(this.images, 'addedAt').slice(-config.maxImagesInMemory);
        }
        
        return true;
      }
      
      return false;
    }
  }

  /**
   * Находит похожие изображения на основе хеша
   * @param {string} hash - хеш изображения для поиска
   * @param {Function} similarityFunction - функция для определения схожести
   * @returns {Array} - массив похожих изображений
   */
  findSimilarImages(hash, similarityFunction) {
    return this.images.filter(img => img.hash && similarityFunction(hash, img.hash));
  }

  /**
   * Возвращает все изображения в базе данных
   * @returns {Array} - массив всех изображений
   */
  getAllImages() {
    return [...this.images];
  }

  /**
   * Удаляет изображение из базы данных
   * @param {string} fileId - ID файла для удаления
   * @returns {boolean} - true, если изображение успешно удалено
   */
  async removeImage(fileId) {
    if (this.useSqlite) {
      return new Promise((resolve, reject) => {
        this.db.run(`DELETE FROM images WHERE fileId = ?`, [fileId], function(err) {
          if (err) {
            console.error('Ошибка при удалении изображения из SQLite:', err);
            resolve(false);
            return;
          }
          
          // Удаляем из кэша в памяти
          const initialLength = this.images.length;
          this.images = this.images.filter(img => img.fileId !== fileId);
          
          resolve(this.changes > 0);
        });
      });
    } else {
      // Старый метод с JSON
      const initialLength = this.images.length;
      this.images = this.images.filter(img => img.fileId !== fileId);
      return initialLength !== this.images.length;
    }
  }

  /**
   * Очищает базу данных
   */
  async clear() {
    if (this.useSqlite) {
      return new Promise((resolve, reject) => {
        this.db.run(`DELETE FROM images`, (err) => {
          if (err) {
            console.error('Ошибка при очистке базы данных SQLite:', err);
            resolve(false);
            return;
          }
          
          this.images = [];
          console.log('SQLite база данных очищена');
          resolve(true);
        });
      });
    } else {
      // Старый метод с JSON
      this.images = [];
    }
  }
  
  /**
   * Закрывает соединение с базой данных
   */
  async close() {
    if (this.useSqlite && this.db) {
      return new Promise((resolve, reject) => {
        this.db.close((err) => {
          if (err) {
            console.error('Ошибка при закрытии SQLite базы данных:', err);
            reject(err);
            return;
          }
          
          console.log('SQLite база данных закрыта');
          resolve();
        });
      });
    }
  }
}

module.exports = new ImageDatabase(); 