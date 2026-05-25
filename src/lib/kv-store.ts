export interface KvStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete?(key: string): Promise<void>;
  list?<Meta = unknown>(prefix?: {prefix: string}): Promise<{keys: {name: string; metadata?: Meta}[]}>;
}

let conversationsKv: KvStore | null = null;
let tasksKv: KvStore | null = null;
let longTermKv: KvStore | null = null;

export function setConversationsKv(kv: KvStore): void { conversationsKv = kv; }
export function setTasksKv(kv: KvStore): void { tasksKv = kv; }
export function setLongTermKv(kv: KvStore): void { longTermKv = kv; }

export function getConversationsKv(): KvStore | null { return conversationsKv; }
export function getTasksKv(): KvStore | null { return tasksKv; }
export function getLongTermKv(): KvStore | null { return longTermKv; }
