import type {Bot, Context} from "grammy/web";
import {getTasksKv} from "../../memory/index.js";
import {generateWithFallback} from "../../lib/gemini.js";
import type {KvStore} from "../../memory/store.js";
import {Task, makeId, getTasks, saveTasks, formatTaskList, isTaskLike} from "./helpers.js";

async function createTaskFromText(ctx: Context, userId: number, raw: string): Promise<boolean> {
  const kv = getTasksKv() as KvStore | null;
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
    const tasks = await getTasks(kv, userId);
    tasks.push({id: makeId(), text: raw, createdAt: Date.now(), dueAt: null, done: false, userId});
    await saveTasks(kv, userId, tasks);
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
    const tasks = await getTasks(kv, userId);
    tasks.push(task);
    await saveTasks(kv, userId, tasks);

    let reply = `📝 Added: ${task.text}`;
    if (task.dueAt) {
      const mins = Math.round((task.dueAt - Date.now()) / 60000);
      reply += mins > 60 ? ` (due in ~${Math.round(mins / 60)}h)` : ` (due in ~${mins}min)`;
    }
    await ctx.reply(reply);
  } catch {
    const tasks = await getTasks(kv, userId);
    tasks.push({id: makeId(), text: raw, createdAt: Date.now(), dueAt: null, done: false, userId});
    await saveTasks(kv, userId, tasks);
    await ctx.reply(`📝 Added: ${raw}`);
  }
  return true;
}

export async function handleTaskCommand(ctx: Context, text: string): Promise<boolean> {
  if (!ctx.from) return false;
  const kv = getTasksKv() as KvStore | null;
  const userId = ctx.from.id;
  const lower = text.toLowerCase().trim();

  if (lower === "/tasks") {
    const tasks = await getTasks(kv, userId);
    await ctx.reply(formatTaskList(tasks));
    return true;
  }

  const doneMatch = lower.match(/^\/done\s*([a-z0-9]+)/);
  if (doneMatch) {
    const tasks = await getTasks(kv, userId);
    const target = tasks.find((t) => t.id.startsWith(doneMatch[1]));
    if (target) {
      target.done = true;
      await saveTasks(kv, userId, tasks);
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

export async function handleNaturalLanguageTask(ctx: Context, text: string): Promise<boolean> {
  if (!ctx.from || !isTaskLike(text)) return false;
  return await createTaskFromText(ctx, ctx.from.id, text);
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
