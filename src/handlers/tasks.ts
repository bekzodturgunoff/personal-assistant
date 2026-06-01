import type {Bot, Context} from "grammy/web";
import {getTasksKv, getConversationsKv, getWeeklyAccumulator, resetWeeklyAccumulator} from "../lib/kv-store.js";
import {generateWithFallback} from "../lib/gemini.js";
import {config} from "../config.js";

interface Task {
  id: string;
  text: string;
  createdAt: number;
  dueAt: number | null;
  done: boolean;
  userId: number;
}

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function getTasks(userId: number): Promise<Task[]> {
  const kv = getTasksKv();
  if (!kv) return [];
  const raw = await kv.get(`tasks:${userId}`);
  return raw ? JSON.parse(raw) : [];
}

async function saveTasks(userId: number, tasks: Task[]): Promise<void> {
  const kv = getTasksKv();
  if (!kv) return;
  await kv.put(`tasks:${userId}`, JSON.stringify(tasks));
}

function formatTaskList(tasks: Task[]): string {
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

export async function handleTaskCommand(ctx: Context, text: string): Promise<boolean> {
  if (!ctx.from) return false;
  const userId = ctx.from.id;
  const lower = text.toLowerCase().trim();

  if (lower === "/tasks") {
    const tasks = await getTasks(userId);
    await ctx.reply(formatTaskList(tasks));
    return true;
  }

  const doneMatch = lower.match(/^\/done\s*([a-z0-9]+)/);
  if (doneMatch) {
    const tasks = await getTasks(userId);
    const target = tasks.find((t) => t.id.startsWith(doneMatch[1]));
    if (target) {
      target.done = true;
      await saveTasks(userId, tasks);
      await ctx.reply(`✅ Done: ${target.text}`);
    } else {
      await ctx.reply("Task not found.");
    }
    return true;
  }

  const remindMatch = lower.match(/^\/(remind|addtask|task)\s+(.+)/);
  if (remindMatch) {
    const raw = remindMatch[2];
    return await createTaskFromText(ctx, userId, raw);
  }

  return false;
}

async function createTaskFromText(ctx: Context, userId: number, raw: string): Promise<boolean> {
  const prompt = `
Extract task information from this text. Return ONLY a JSON object with fields:
- text: the task description (clean, no date/time words)
- dueAt: relative time in milliseconds from now, or null if no time mentioned

Examples:
"call Akbar tomorrow at 10" → {"text": "call Akbar", "dueAt": 86400000}
"review PR" → {"text": "review PR", "dueAt": null}
"remind me to buy milk in 2 hours" → {"text": "buy milk", "dueAt": 7200000}

Text: ${raw}
`;

  let result: string | null = null;
  try {
    result = await generateWithFallback("task", raw, prompt);
  } catch (e) {
    console.error("Task AI parse failed:", e);
  }

  if (!result) {
    const tasks = await getTasks(userId);
    tasks.push({id: makeId(), text: raw, createdAt: Date.now(), dueAt: null, done: false, userId});
    await saveTasks(userId, tasks);
    await ctx.reply(`📝 Added: ${raw}`);
    return true;
  }

  try {
    const parsed = JSON.parse(result);
    const task: Task = {
      id: makeId(),
      text: parsed.text || raw,
      createdAt: Date.now(),
      dueAt: parsed.dueAt ? Date.now() + parsed.dueAt : null,
      done: false,
      userId,
    };
    const tasks = await getTasks(userId);
    tasks.push(task);
    await saveTasks(userId, tasks);

    let reply = `📝 Added: ${task.text}`;
    if (task.dueAt) {
      const mins = Math.round((task.dueAt - Date.now()) / 60000);
      reply += mins > 60 ? ` (due in ~${Math.round(mins / 60)}h)` : ` (due in ~${mins}min)`;
    }
    await ctx.reply(reply);
  } catch {
    const tasks = await getTasks(userId);
    tasks.push({id: makeId(), text: raw, createdAt: Date.now(), dueAt: null, done: false, userId});
    await saveTasks(userId, tasks);
    await ctx.reply(`📝 Added: ${raw}`);
  }
  return true;
}

export async function checkDueTasks(): Promise<void> {
  const kv = getTasksKv();
  if (!kv) return;

  const ownerId = config.ownerUserId;
  if (!ownerId) return;

  const list = await kv.get("tasks:" + ownerId);
  if (!list) return;
  const tasks: Task[] = JSON.parse(list);
  const now = Date.now();
  const due = tasks.filter((t) => !t.done && t.dueAt && t.dueAt <= now);

  if (due.length === 0) return;

  const msg = due.map((t) => `⏰ ${t.text}`).join("\n");
  try {
    await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({chat_id: Number(ownerId), text: `Overdue tasks:\n${msg}`}),
    });
  } catch (e) {
    console.error("Failed to send task reminder:", e);
  }
}

function isTaskLike(text: string): boolean {
  const lower = text.toLowerCase();
  return /remind|reminder|task|todo|eslatma|vazifa/i.test(lower);
}

export async function handleNaturalLanguageTask(ctx: Context, text: string): Promise<boolean> {
  if (!ctx.from || !isTaskLike(text)) return false;
  return await createTaskFromText(ctx, ctx.from.id, text);
}

async function getPendingQuestionsBlock(): Promise<string> {
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

async function computeWeeklyStats(): Promise<string> {
  try {
    const acc = await getWeeklyAccumulator();
    if (acc.totalMessages === 0) return "No conversations yet.";
    return `📊 Weekly Analytics:\n- Active conversations: ${acc.conversationsSeen.length}\n- Total messages: ${acc.totalMessages}\n- Low confidence events: ${acc.lowConfTotal}\n- Unresolved items: ${acc.unresolvedCount}`;
  } catch (e) {
    console.error("[WeeklyStats] Error:", e);
    return "Stats unavailable.";
  }
}

export async function handleMorningBriefing(): Promise<void> {
  const kv = getTasksKv();
  const ownerId = config.ownerUserId;
  if (!ownerId || !kv) return;

  const list = await kv.get("tasks:" + ownerId);
  if (!list && !await getConversationsKv()) return;

  const now = Date.now();

  let msg = "🌅 Morning briefing";

  if (list) {
    const tasks: Task[] = JSON.parse(list);
    const dayStart = now - (now % 86400000) + 3 * 3600000;
    const dayEnd = dayStart + 86400000;
    const today = tasks.filter((t) => !t.done && t.dueAt && t.dueAt >= dayStart && t.dueAt <= dayEnd);
    const overdue = tasks.filter((t) => !t.done && t.dueAt && t.dueAt < now);

    if (today.length > 0) {
      msg += "\n\n📋 Due today:\n" + today.map((t) => `- ${t.text}`).join("\n");
    }
    if (overdue.length > 0) {
      msg += "\n\n⏰ Overdue:\n" + overdue.map((t) => `- ${t.text}`).join("\n");
    }
  }

  const pendingBlock = await getPendingQuestionsBlock();
  if (pendingBlock) {
    msg += pendingBlock;
  }

  msg += "\n\nLet's get it done. 🚀";

  try {
    await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({chat_id: Number(ownerId), text: msg}),
    });
  } catch (e) {
    console.error("Morning briefing error:", e);
  }
}

export async function handleWeeklyAnalytics(): Promise<void> {
  const ownerId = config.ownerUserId;
  if (!ownerId) return;

  const stats = await computeWeeklyStats();
  const msg = `${stats}\n\nHave a great week! 🚀`;

  try {
    await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({chat_id: Number(ownerId), text: msg}),
    });
  } catch (e) {
    console.error("Weekly analytics error:", e);
  }

  await resetWeeklyAccumulator();
}

export function registerTaskHandlers(bot: Bot): void {
  bot.command(["tasks", "task", "remind", "addtask"], async (ctx) => {
    const text = ctx.message?.text ?? ctx.message?.caption ?? "";
    await handleTaskCommand(ctx, text);
  });

  bot.command("done", async (ctx) => {
    const text = ctx.message?.text ?? "";
    await handleTaskCommand(ctx, text);
  });
}