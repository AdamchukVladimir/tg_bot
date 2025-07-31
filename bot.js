import dotenv from 'dotenv';
dotenv.config();
import { Telegraf, Markup } from 'telegraf';
import { google } from 'googleapis';
import fs from 'fs';


const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

let productData = {};

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
  
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: 'A2:C',
    });
  
    const rows = res.data.values;
    const tempData = {}; // временно собираем все уроки
  
    if (rows && rows.length) {
      for (const row of rows) {
        const product = (row[0] || '').trim();
        const lesson = (row[1] || '').trim();
        const link = (row[2] || '').trim();
  
        if (product && lesson && link && isValidUrl(link)) {
          if (!tempData[product]) tempData[product] = [];
          tempData[product].push({ lesson, link });
        } else {
          console.warn('Пропущена неполная или некорректная строка:', row);
        }
      }
    }
  
    const data = {};
    for (const [product, lessons] of Object.entries(tempData)) {
      if (lessons.length > 0) {
        data[product] = lessons;
      }
    }
  
    return data;
  }
  

async function updateData() {
  productData = await loadData();
  console.log('📊 Данные обновлены:', Object.keys(productData));
  console.log('📊 Данные обновлены:', JSON.stringify(productData));
}

// Главное меню
bot.start((ctx) => {
  ctx.reply('👋 Добро пожаловать! Выберите действие:', Markup.keyboard([
    ['🎥 Смотреть обучающее видео'],
    ['👥 Подписаться на группу']
  ]).resize());
});

bot.hears('⬅️ Назад', (ctx) => {
  ctx.reply('🔙 Назад в главное меню', Markup.keyboard([
    ['🎥 Смотреть обучающее видео'],
    ['👥 Подписаться на группу']
  ]).resize());
});

bot.hears('🎥 Смотреть обучающее видео', (ctx) => {
  const buttons = Object.keys(productData).map(name => [Markup.button.text(name)]);
  buttons.push([Markup.button.text('⬅️ Назад')]);
  ctx.reply('Выберите товар:', Markup.keyboard(buttons).resize());
});

bot.hears('👥 Подписаться на группу', (ctx) => {
  ctx.reply('Подпишитесь на наш канал:', Markup.inlineKeyboard([
    Markup.button.url('Перейти в Telegram группу', 'https://t.me/messengerofthepeople')
  ]));
});

bot.hears(/.+/, (ctx) => {
  const text = ctx.message.text;
  if (productData[text]) {
    const lessons = productData[text];
    const buttons = lessons.map(item => [Markup.button.url(item.lesson, item.link)]);
    ctx.reply(`📚 Уроки по товару ${text}:`, Markup.inlineKeyboard(buttons));
  }
});

(async () => {
  await updateData();
  bot.launch();
  console.log('Bot start');

  setInterval(updateData, 5 * 1000);
})();
