import { readFileSync, writeFileSync, existsSync } from 'fs';

const FILE = process.env.DATA_FILE || 'data.json';

export function load() {
  if (!existsSync(FILE)) {
    return { users: [], seen: [], reminders: [], seeded: false, updateOffset: 0 };
  }
  return JSON.parse(readFileSync(FILE, 'utf8'));
}

export function save(data) {
  writeFileSync(FILE, JSON.stringify(data, null, 2));
}
