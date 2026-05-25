const MAX_HISTORY = 20;
const MAX_CONTEXT = 6;

interface Entry {
  role: "user" | "assistant";
  text: string;
}

const store = new Map<number, Entry[]>();

export function addMessage(chatId: number, role: Entry["role"], text: string): void {
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

export function getRecentHistory(chatId: number): Entry[] {
  const history = store.get(chatId);
  if (!history) return [];
  return history.slice(-MAX_CONTEXT);
}

export function formatHistory(entries: Entry[]): string {
  if (entries.length === 0) return "";
  return entries
    .map((e) => `${e.role === "user" ? "User" : "You"}: ${e.text}`)
    .join("\n");
}
