import dotenv from 'dotenv';
dotenv.config();
import { Telegraf, Markup } from 'telegraf';
import { google } from 'googleapis';
import fs from 'fs';


const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

let videosData = {};
let instructionsData = {};
let catalogData = {};

// Контекст для отслеживания текущего раздела
const userContext = new Map();

// Конфигурации таблиц: каждая возвращает записи формата { product, lesson, link }
const sheetConfigs = [
  {
    name: 'Instructions',
    spreadsheetId: process.env.SPREADSHEET_ID_INSTRUCTIONS,
    range: 'A2:B',
    target: 'instructions',
    mapRow: (row) => {
      const product = (row[0] || '').trim();
      const link = (row[1] || '').trim();
      if (!product || !link) return null;
      return { product, lesson: 'Инструкция', link };
    },
  },
  {
    name: 'VideosMain',
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: 'A2:C',
    target: 'videos',
    mapRow: (row) => {
      const product = (row[0] || '').trim();
      const lesson = (row[1] || '').trim();
      const link = (row[2] || '').trim();
      if (!product || !lesson || !link) return null;
      return { product, lesson, link };
    },
  },
  {
    name: 'Catalog',
    spreadsheetId: process.env.SPREADSHEET_ID_CATALOGUE,
    range: 'A2:H',
    target: 'catalog',
    mapRow: (row) => {
      const product = (row[0] || '').trim();
      const defaultLink = (row[1] || '').trim();
      if (!product) return null;
      const marketplaces = [];
      const pairs = [
        { name: (row[2] || '').trim(), link: (row[3] || '').trim() },
        { name: (row[4] || '').trim(), link: (row[5] || '').trim() },
        { name: (row[6] || '').trim(), link: (row[7] || '').trim() },
      ];
      for (const p of pairs) {
        if (p.name && p.link) {
          marketplaces.push({ name: p.name, link: p.link });
        }
      }
      return { product, defaultLink, marketplaces };
    },
  },
];

function isValidUrl(str) {
    try {
      new URL(str);
      return true;
    } catch {
      return false;
    }
  }

  async function loadData() {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(fs.readFileSync('credentials.json')),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
  
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });
    
    const tempVideos = {};
    const tempInstructions = {};
    const tempCatalog = {};

    for (const cfg of sheetConfigs) {
      if (!cfg.spreadsheetId) {
        console.warn(`Пропущена таблица ${cfg.name}: не задан spreadsheetId`);
        continue;
      }
      try {
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: cfg.spreadsheetId,
          range: cfg.range,
        });
        const rows = res.data.values || [];
        for (const row of rows) {
          const mapped = cfg.mapRow(row);
          if (!mapped) {
            console.warn(`Пропущена неполная строка в ${cfg.name}:`, row);
            continue;
          }
          if (cfg.target === 'catalog') {
            const { product, defaultLink, marketplaces } = mapped;
            tempCatalog[product] = { defaultLink, marketplaces };
          } else {
            const { product, lesson, link } = mapped;
            if (!isValidUrl(link)) {
              console.warn(`Неверная ссылка в ${cfg.name}:`, link);
              continue;
            }
            if (cfg.target === 'instructions') {
              if (!tempInstructions[product]) tempInstructions[product] = [];
              tempInstructions[product].push({ lesson, link });
            } else {
              if (!tempVideos[product]) tempVideos[product] = [];
              tempVideos[product].push({ lesson, link });
            }
          }
        }
      } catch (err) {
        console.error(`Ошибка загрузки ${cfg.name}:`, err.message || err);
      }
    }

    return { videos: tempVideos, instructions: tempInstructions, catalog: tempCatalog };
  }
  

async function updateData() {
  const loaded = await loadData();
  videosData = loaded.videos;
  instructionsData = loaded.instructions;
  catalogData = loaded.catalog;
  console.log('📊 Видео товары:', Object.keys(videosData));
  console.log('📄 Инструкции товары:', Object.keys(instructionsData));
  console.log('🛍 Каталог товары:', Object.keys(catalogData));
}

// Главное меню
bot.start((ctx) => {
  ctx.reply('👋 Добро пожаловать! Выберите действие:', Markup.keyboard([
    ['🎥 Обучающее видео', '📄 Инструкции'],
    ['🛍 Каталог'],
    ['👥 Сообщество', '🆘 Поддержка']
  ]).resize());
});

bot.hears('⬅️ Назад', (ctx) => {
  const userId = ctx.from.id;
  userContext.delete(userId); // Очищаем контекст при возврате в главное меню
  ctx.reply('🔙 Назад в главное меню', Markup.keyboard([
    ['🎥 Обучающее видео', '📄 Инструкции'],
    ['🛍 Каталог'],
    ['👥 Сообщество', '🆘 Поддержка']
  ]).resize());
});

bot.hears('🎥 Обучающее видео', (ctx) => {
  const userId = ctx.from.id;
  userContext.set(userId, 'videos');
  const buttons = Object.keys(videosData).map(name => [Markup.button.text(name)]);
  buttons.push([Markup.button.text('⬅️ Назад')]);
  ctx.reply('Выберите товар:', Markup.keyboard(buttons).resize());
});

bot.hears('📄 Инструкции', (ctx) => {
  const userId = ctx.from.id;
  userContext.set(userId, 'instructions');
  const buttons = Object.keys(instructionsData).map(name => [Markup.button.text(name)]);
  buttons.push([Markup.button.text('⬅️ Назад')]);
  ctx.reply('Выберите товар (инструкции):', Markup.keyboard(buttons).resize());
});

bot.hears('🛍 Каталог', (ctx) => {
  const userId = ctx.from.id;
  userContext.set(userId, 'catalog');
  const buttons = Object.keys(catalogData).map(name => [Markup.button.text(name)]);
  buttons.push([Markup.button.text('⬅️ Назад')]);
  ctx.reply('Выберите товар (каталог):', Markup.keyboard(buttons).resize());
});

bot.hears('👥 Сообщество', (ctx) => {
  ctx.reply('Подпишитесь на наш канал:', Markup.inlineKeyboard([
    Markup.button.url('Перейти в Telegram группу', 'https://t.me/messengerofthepeople')
  ]));
});

bot.hears('🆘 Поддержка', (ctx) => {
  ctx.reply('Для получения поддержки обратитесь к администратору:', Markup.inlineKeyboard([
    Markup.button.url('Написать в поддержку', 'https://t.me/MP_Messenger_of_the_people')
  ]));
});

// Обработчик выбора товара с учетом контекста
bot.hears(/.+/, async (ctx) => {
  const text = ctx.message.text;
  const userId = ctx.from.id;
  const currentContext = userContext.get(userId);

  // Обрабатываем в зависимости от текущего контекста
  if (currentContext === 'catalog' && catalogData[text]) {
    const { defaultLink, marketplaces } = catalogData[text];
    const validPairs = (marketplaces || []).filter(p => p.name && p.link && isValidUrl(p.link));
    if (validPairs.length > 0) {
      const buttons = validPairs.map(p => [Markup.button.url(p.name, p.link)]);
      await ctx.reply('Выберите маркетплейс:', Markup.inlineKeyboard(buttons));
    } else if (defaultLink && isValidUrl(defaultLink)) {
      await ctx.reply(defaultLink);
    } else {
      await ctx.reply('К сожалению, ссылки для этого товара пока недоступны.');
    }
  } else if (currentContext === 'instructions' && instructionsData[text]) {
    const items = instructionsData[text];
    for (const item of items) {
      await ctx.reply(item.link);
    }
  } else if (currentContext === 'videos' && videosData[text]) {
    const lessons = videosData[text];
    const buttons = lessons.map(item => [Markup.button.url(item.lesson, item.link)]);
    ctx.reply(`📚 Уроки по товару ${text}:`, Markup.inlineKeyboard(buttons));
  }
});

(async () => {
  await updateData();
  bot.launch();
  console.log('Bot start');

  setInterval(updateData, 1 * 60 * 1000);
  
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
})();
