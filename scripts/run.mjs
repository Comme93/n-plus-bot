import { load, save } from '../lib/store.mjs';
import { runBotCycle } from '../lib/core.mjs';

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('BOT_TOKEN missing');
  process.exit(1);
}

let data = load();
data = await runBotCycle(data, token);
save(data);
console.log('done', new Date().toISOString());
