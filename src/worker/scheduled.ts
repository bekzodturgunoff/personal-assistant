import {handleMorningBriefing, handleWeeklyAnalytics, checkDueTasks} from "../handlers/tasks/index.js";
import {processDuePendingReplies} from "../handlers/business/index.js";

type Ctx = {waitUntil(p: Promise<unknown>): void};

export async function handleScheduled(event: {cron?: string}, ctx: Ctx): Promise<void> {
  const cron = event.cron ?? "";

  ctx.waitUntil(processDuePendingReplies());

  if (cron !== "* * * * *") {
    await checkDueTasks();
    await handleMorningBriefing();
  }

  if (cron === "0 3 * * *" && new Date().getUTCDay() === 1) {
    ctx.waitUntil(handleWeeklyAnalytics());
  }
}
