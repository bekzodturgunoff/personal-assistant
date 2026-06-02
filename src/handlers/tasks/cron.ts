import {getTasksKv, getConversationsKv, getWeeklyAccumulator, saveWeeklyAccumulator, resetWeeklyAccumulator} from "../../memory/index.js";
import {config} from "../../config/env.js";
import {Task, getTasks, getPendingQuestionsBlock, computeWeeklyStats} from "./helpers.js";

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
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    console.error("Failed to send task reminder:", e);
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

  const dailyAcc = await getWeeklyAccumulator();
  dailyAcc.lastDailyCronAt = new Date().toISOString();
  await saveWeeklyAccumulator(dailyAcc);

  try {
    await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({chat_id: Number(ownerId), text: msg}),
      signal: AbortSignal.timeout(10000),
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

  const weeklyAcc = await getWeeklyAccumulator();
  weeklyAcc.lastWeeklyCronAt = new Date().toISOString();
  await saveWeeklyAccumulator(weeklyAcc);

  try {
    await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({chat_id: Number(ownerId), text: msg}),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    console.error("Weekly analytics error:", e);
  }

  await resetWeeklyAccumulator();
}
