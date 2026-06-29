import { checkAvito, tickReminders } from './core.mjs';
import { makeApi, makeSend } from './telegram.mjs';

export async function runWorker(data, token) {
  const api = makeApi(token);
  const send = makeSend(api, data);

  try {
    data = await checkAvito(data, send);
  } catch (e) {
    console.error('[avito]', e.message);
  }
  data = await tickReminders(data, send);
  return data;
}
