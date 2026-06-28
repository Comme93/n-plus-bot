import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';

const botToken = readFileSync('.env', 'utf8').match(/^BOT_TOKEN=(.+)$/m)?.[1]?.trim();
const ghToken = spawnSync('git', ['credential', 'fill'], {
  input: 'protocol=https\nhost=github.com\n\n',
  encoding: 'utf8',
})
  .stdout.split('\n')
  .find((l) => l.startsWith('password='))
  ?.slice('password='.length);

function setEnv(name, val) {
  spawnSync('npx', ['vercel', 'env', 'rm', name, 'production', '-y'], { stdio: 'ignore', shell: true });
  const r = spawnSync('npx', ['vercel', 'env', 'add', name, 'production'], {
    input: val,
    encoding: 'utf8',
    shell: true,
  });
  if (r.status !== 0) console.error('env', name, r.stderr?.toString());
}

setEnv('BOT_TOKEN', botToken);
setEnv('GITHUB_TOKEN', ghToken);

spawnSync('npx', ['vercel', 'deploy', '--prod', '--yes'], { stdio: 'inherit', shell: true });

const host = 'https://n-plus-bot.vercel.app';
const webhook = `${host}/api/webhook`;

const r = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: webhook, allowed_updates: ['message', 'callback_query'] }),
});

console.log('webhook:', webhook, await r.json());
