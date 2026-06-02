import type {KvStore} from "../../memory/store.js";
import {getConversationsKv, getWeeklyAccumulator} from "../../memory/index.js";

export interface Task {
  id: string;
  text: string;
  createdAt: number;
  dueAt: number | null;
  done: boolean;
  userId: number;
}

export function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export async function getTasks(kv: KvStore | null, userId: number): Promise<Task[]> {
  if (!kv) return [];
  const raw = await kv.get(`tasks:${userId}`);
  return raw ? JSON.parse(raw) : [];
}

export async function saveTasks(kv: KvStore | null, userId: number, tasks: Task[]): Promise<void> {
  if (!kv) return;
  await kv.put(`tasks:${userId}`, JSON.stringify(tasks));
}

export function formatTaskList(tasks: Task[]): string {
  if (tasks.length === 0) return "No tasks.";
  const open = tasks.filter((t) => !t.done);
  if (open.length === 0) return "All tasks done! ✅";
  return open
    .map((t, i) => {
      let line = `${i + 1}. ${t.text}`;
      if (t.dueAt) {
        const diff = t.dueAt - Date.now();
        if (diff > 0) {
          const h = Math.round(diff / 3600000);
          line += h > 24 ? ` (${Math.round(h / 24)}d)` : ` (${h}h)`;
        } else {
          line += " ⏰ OVERDUE";
        }
      }
      line += ` — /done${t.id}`;
      return line;
    })
    .join("\n");
}

export function isTaskLike(text: string): boolean {
  const lower = text.toLowerCase();
  return /remind|reminder|task|todo|eslatma|vazifa/i.test(lower);
}

export async function getPendingQuestionsBlock(): Promise<string> {
  const convKv = getConversationsKv();
  if (!convKv || !convKv.list) return "";
  try {
    const prefix = "brain:output:";
    const listResult = await convKv.list({prefix});
    if (!listResult.keys.length) return "";

    const questions: string[] = [];
    for (const key of listResult.keys) {
      const raw = await convKv.get(key.name);
      if (!raw) continue;
      const output = JSON.parse(raw);
      const pqs = output.pending_questions || output.pendingQuestions || [];
      if (pqs.length > 0) {
        const chatId = key.name.replace(prefix, "");
        for (const q of pqs) {
          questions.push(`- From ${chatId}: ${q}`);
        }
      }
    }

    if (questions.length === 0) return "";
    return "\n\nPending questions from conversations:\n" + questions.join("\n");
  } catch {
    return "";
  }
}

export async function computeWeeklyStats(): Promise<string> {
  try {
    const acc = await getWeeklyAccumulator();
    if (acc.totalMessages === 0) return "No conversations yet.";
    return `📊 Weekly Analytics:\n- Active conversations: ${acc.conversationsSeen.length}\n- Total messages: ${acc.totalMessages}\n- Low confidence events: ${acc.lowConfTotal}\n- Unresolved items: ${acc.unresolvedCount}`;
  } catch (e) {
    console.error("[WeeklyStats] Error:", e);
    return "Stats unavailable.";
  }
}
