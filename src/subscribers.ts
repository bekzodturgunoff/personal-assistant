import { getBinding } from './runtime-env.js';

type KVLike = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

const SUBSCRIBERS_KEY = 'subscribers';

async function getNodeFs() {
  return import('node:fs/promises');
}

function getKvStore(): KVLike | undefined {
  return getBinding<KVLike>('SUBSCRIBERS_KV');
}

function isNodeRuntime(): boolean {
  return typeof process !== 'undefined' && Boolean(process.versions?.node);
}

async function readNodeSubscribers(): Promise<number[]> {
  const fs = await getNodeFs();
  const file = `${process.cwd()}/data/subscribers.json`;

  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as number[];
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'ENOENT') {
      return [];
    }
    console.error('Failed to read subscribers:', err);
    return [];
  }
}

async function writeNodeSubscribers(subscribers: number[]): Promise<void> {
  const fs = await getNodeFs();
  const dir = `${process.cwd()}/data`;
  const file = `${dir}/subscribers.json`;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(subscribers, null, 2));
}

export async function getSubscribers(): Promise<number[]> {
  const kv = getKvStore();
  if (kv) {
    try {
      const raw = await kv.get(SUBSCRIBERS_KEY);
      if (!raw) return [];
      return JSON.parse(raw) as number[];
    } catch (err) {
      console.error('Failed to read KV subscribers:', err);
      return [];
    }
  }

  if (!isNodeRuntime()) {
    return [];
  }

  return readNodeSubscribers();
}

export async function addSubscriber(id: number): Promise<void> {
  const subscribers = new Set(await getSubscribers());
  subscribers.add(id);
  const list = Array.from(subscribers);

  const kv = getKvStore();
  if (kv) {
    await kv.put(SUBSCRIBERS_KEY, JSON.stringify(list));
    return;
  }

  if (!isNodeRuntime()) {
    console.warn('SUBSCRIBERS_KV is not configured in this Worker, so the subscription was not persisted.');
    return;
  }

  await writeNodeSubscribers(list);
}

export async function removeSubscriber(id: number): Promise<void> {
  const subscribers = new Set(await getSubscribers());
  subscribers.delete(id);
  const list = Array.from(subscribers);

  const kv = getKvStore();
  if (kv) {
    await kv.put(SUBSCRIBERS_KEY, JSON.stringify(list));
    return;
  }

  if (!isNodeRuntime()) {
    console.warn('SUBSCRIBERS_KV is not configured in this Worker, so the unsubscription was not persisted.');
    return;
  }

  await writeNodeSubscribers(list);
}
