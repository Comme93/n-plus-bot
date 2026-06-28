import { runWorker } from '../lib/worker.mjs';
import { load, save } from '../lib/store.mjs';

const token = process.env.BOT_TOKEN;
if (!token) process.exit(1);

let data = load();
data = await runWorker(data, token);
save(data);
