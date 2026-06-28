import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { createServer } from 'http';
import { dirname } from 'path';
import { Telegraf, Markup } from 'telegraf';

// ─── Настройки ───────────────────────────────────────────────
const AVITO_URL =
  'https://www.avito.ru/moskva/vakansii/format_raboty/udalenno-ASgBAgICAUSejBW~lZED/tag/udalennaya-rabota?cd=1&context=H4sIAAAAAAAA_wEmANn_YToxOntzOjE6InkiO3M6MTY6IjcxQ1FBbkNXb0F6SzlVb3kiO32ZrD1SJgAAAA&f=ASgBAgICA0T2DIC6AZTND9Lq9AKejBW~lZED&localPriority=1&s=104';

const CHECK_EVERY_MS = 15_000;
const DATA_FILE = process.env.DATA_FILE || 'data.json';
const PORT = process.env.PORT || 3000;

// ─── Данные ──────────────────────────────────────────────────
function load() {
  if (!existsSync(DATA_FILE)) {
    return { users: [], seen: [], reminders: [], seeded: false };
  }
  return JSON.parse(readFileSync(DATA_FILE, 'utf8'));
}

function save(data) {
  mkdirSync(dirname(DATA_FILE), { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let data = load();

// ─── Токен ───────────────────────────────────────────────────
function getToken() {
  if (process.env.BOT_TOKEN) return process.env.BOT_TOKEN;
  if (existsSync('.env')) {
    const line = readFileSync('.env', 'utf8').match(/^BOT_TOKEN=(.+)$/m);
    if (line) return line[1].trim();
  }
  throw new Error('Нет BOT_TOKEN в .env');
}

const bot = new Telegraf(getToken());

// ─── Московское время ───────────────────────────────────────
function mskNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
}

function mskStr() {
  return mskNow().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
}

// ─── Авито ──────────────────────────────────────────────────
async function fetchVacancyIds() {
  const res = await fetch(AVITO_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'ru-RU,ru;q=0.9',
    },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Avito ${res.status}`);
  const html = await res.text();
  return [...new Set([...html.matchAll(/data-item-id="(\d+)"/g)].map((m) => m[1]))];
}

async function checkAvito() {
  try {
    const ids = await fetchVacancyIds();
    if (!ids.length) return;

    if (!data.seeded) {
      data.seen = ids;
      data.seeded = true;
      save(data);
      console.log(`[avito] база: ${ids.length} вакансий (без уведомлений)`);
      return;
    }

    const fresh = ids.filter((id) => !data.seen.includes(id));
    if (!fresh.length) return;

    data.seen = [...new Set([...fresh, ...data.seen])].slice(0, 500);
    save(data);

    for (const chatId of data.users) {
      for (const _ of fresh) {
        await bot.telegram.sendMessage(chatId, '+1').catch(() => {});
      }
    }
    console.log(`[avito] +${fresh.length} новых → уведомлено`);
  } catch (e) {
    console.error('[avito]', e.message);
  }
}

// ─── Напоминания ────────────────────────────────────────────
function parseReminder(text) {
  const m = text.trim().match(/^(\d+)\s*ч(?:ас(?:а|ов)?)?\s+(.+)$/i);
  if (!m) return null;
  const hours = parseInt(m[1], 10);
  if (hours < 1 || hours > 168) return null;
  return { hours, text: m[2].trim() };
}

async function tickReminders() {
  const now = Date.now();
  let changed = false;

  for (const r of data.reminders) {
    const interval = r.hours * 3_600_000;
    if (now - r.last < interval) continue;

    await bot.telegram.sendMessage(r.chatId, `⏰ ${r.text}`).catch(() => {});
    r.last = now;
    changed = true;
    console.log(`[напоминание] ${r.text} → ${r.chatId}`);
  }

  if (changed) save(data);
}

// ─── Бот ────────────────────────────────────────────────────
bot.start(async (ctx) => {
  const id = ctx.chat.id;
  if (!data.users.includes(id)) {
    data.users.push(id);
    save(data);
  }
  await ctx.reply(
    '✅ Готово!\n\n' +
      '🔔 Новые вакансии с Авито → сразу «+1»\n\n' +
      '⏰ Напоминание — одной строкой:\n' +
      '4ч купить наушники\n\n' +
      '/list — твои напоминания',
    Markup.keyboard([['📋 Мои напоминания']]).resize()
  );
});

bot.command('list', showReminders);
bot.hears('📋 Мои напоминания', showReminders);

async function showReminders(ctx) {
  const mine = data.reminders.filter((r) => r.chatId === ctx.chat.id);
  if (!mine.length) {
    return ctx.reply('Пока пусто.\n\nПример: 4ч купить наушники');
  }

  const rows = mine.map((r) => [
    Markup.button.callback(`❌ ${r.hours}ч — ${r.text}`, `del:${r.id}`),
  ]);
  await ctx.reply('Тапни чтобы удалить:', Markup.inlineKeyboard(rows));
}

bot.action(/^del:(.+)$/, async (ctx) => {
  const id = ctx.match[1];
  data.reminders = data.reminders.filter((r) => r.id !== id);
  save(data);
  await ctx.answerCbQuery('Удалено');
  await ctx.editMessageText('🗑 Удалено');
});

bot.on('text', async (ctx) => {
  const parsed = parseReminder(ctx.message.text);
  if (!parsed) return;

  if (!data.users.includes(ctx.chat.id)) {
    data.users.push(ctx.chat.id);
  }

  const reminder = {
    id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
    chatId: ctx.chat.id,
    text: parsed.text,
    hours: parsed.hours,
    last: Date.now(),
  };
  data.reminders.push(reminder);
  save(data);

  await ctx.reply(`⏰ ${parsed.text}`);
  await ctx.reply(`✅ Ок! Каждые ${parsed.hours} ч (МСК): «${parsed.text}»`);
});

// ─── Запуск 24/7 ────────────────────────────────────────────
bot.catch((err) => console.error('[bot]', err));

process.on('uncaughtException', (e) => console.error('[crash]', e));
process.on('unhandledRejection', (e) => console.error('[reject]', e));

function startHealthServer() {
  createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  }).listen(PORT, () => console.log(`[http] :${PORT}`));
}

function keepAlive() {
  const url = process.env.RENDER_EXTERNAL_URL;
  if (!url) return;
  setInterval(() => fetch(url).catch(() => {}), 4 * 60_000);
  console.log('[keepalive] Render 24/7');
}

async function main() {
  startHealthServer();
  keepAlive();

  console.log('🚀 Бот запущен (МСК:', mskStr(), ')');
  await bot.launch();
  console.log('✅ Telegram подключён — облако 24/7');

  checkAvito();
  setInterval(checkAvito, CHECK_EVERY_MS);
  setInterval(tickReminders, 30_000);
}

main().catch((e) => {
  console.error('❌ Не запустился:', e.message);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
