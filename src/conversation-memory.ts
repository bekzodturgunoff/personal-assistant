const MAX_HISTORY = 40;
const MAX_CONTEXT = 15;

interface Entry {
  role: "user" | "assistant";
  text: string;
}

interface KvStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

const store = new Map<number, Entry[]>();
let kvBinding: KvStore | null = null;

export function setKvBinding(kv: KvStore): void {
  kvBinding = kv;
}

export async function addMessage(
  chatId: number,
  role: Entry["role"],
  text: string,
): Promise<void> {
  if (kvBinding) {
    const key = `chat:${chatId}`;
    const raw = await kvBinding.get(key);
    const history: Entry[] = raw ? JSON.parse(raw) : [];
    history.push({role, text});
    if (history.length > MAX_HISTORY) {
      history.splice(0, history.length - MAX_HISTORY);
    }
    await kvBinding.put(key, JSON.stringify(history));
  } else {
    let history = store.get(chatId);
    if (!history) {
      history = [];
      store.set(chatId, history);
    }
    history.push({role, text});
    if (history.length > MAX_HISTORY) {
      history.splice(0, history.length - MAX_HISTORY);
    }
  }
}

export async function getRecentHistory(chatId: number): Promise<Entry[]> {
  if (kvBinding) {
    const key = `chat:${chatId}`;
    const raw = await kvBinding.get(key);
    if (!raw) return [];
    const history: Entry[] = JSON.parse(raw);
    return history.slice(-MAX_CONTEXT);
  } else {
    const history = store.get(chatId);
    if (!history) return [];
    return history.slice(-MAX_CONTEXT);
  }
}
