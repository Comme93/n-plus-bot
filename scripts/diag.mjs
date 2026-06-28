import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const botToken = readFileSync('.env', 'utf8').match(/^BOT_TOKEN=(.+)$/m)?.[1]?.trim();
const ghToken = execSync('git credential fill', {
  input: 'protocol=https\nhost=github.com\n\n',
  encoding: 'utf8',
})
  .split('\n')
  .find((l) => l.startsWith('password='))
  ?.slice('password='.length);

// webhook info via GHA-style (from runner we can't reach tg locally - try anyway)
try {
  const wh = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`).then((r) => r.json());
  console.log('webhook:', JSON.stringify(wh, null, 2));
} catch (e) {
  console.log('telegram local blocked:', e.message);
}

// test vercel POST
const body = {
  update_id: 1,
  message: {
    message_id: 1,
    from: { id: 875355522 },
    chat: { id: 875355522, type: 'private' },
    text: '/start',
    date: Math.floor(Date.now() / 1000),
  },
};

const res = await fetch('https://n-plus-bot.vercel.app/api/webhook', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
console.log('vercel POST', res.status, await res.text());

// test github token from vercel perspective - load data.json
const gr = await fetch('https://api.github.com/repos/Comme93/n-plus-bot/contents/data.json', {
  headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' },
});
console.log('github data.json', gr.status);

// trigger GHA for webhook reset
execSync('node scripts/trigger.mjs', { stdio: 'inherit' });
