import {handleMorningBriefing, handleWeeklyAnalytics, checkDueTasks} from "../handlers/tasks/index.js";
import {processDuePendingReplies} from "../handlers/business/index.js";

type Ctx = {waitUntil(p: Promise<unknown>): void};

export async function handleScheduled(event: {cron?: string}, ctx: Ctx): Promise<void> {
  await checkDueTasks();
  await handleMorningBriefing();

  const cron = event.cron ?? "";
  if (cron.includes("0 3 * * 1")) {
    ctx.waitUntil(handleWeeklyAnalytics());
  }

  ctx.waitUntil(processDuePendingReplies());
}
