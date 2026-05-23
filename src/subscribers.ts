import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'subscribers.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify([]));
}

export function getSubscribers(): number[] {
  try {
    ensureDataDir();
    const raw = fs.readFileSync(FILE, 'utf8');
    return JSON.parse(raw) as number[];
  } catch (err) {
    console.error('Failed to read subscribers:', err);
    return [];
  }
}

export function addSubscriber(id: number) {
  const set = new Set(getSubscribers());
  set.add(id);
  ensureDataDir();
  fs.writeFileSync(FILE, JSON.stringify(Array.from(set), null, 2));
}

export function removeSubscriber(id: number) {
  const set = new Set(getSubscribers());
  set.delete(id);
  ensureDataDir();
  fs.writeFileSync(FILE, JSON.stringify(Array.from(set), null, 2));
}
