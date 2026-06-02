import type {Bot, Context} from "grammy/web";

export function setupRouter(bot: Bot): void {
  bot.use(async (ctx, next) => {
    const update = ctx.update as unknown as Record<string, unknown>;
    const hasBusiness = !!(update.business_connection || update.business_message || update.edited_business_message);
    console.log(`[Router] msg="${(ctx.message?.text ?? "").slice(0, 60)}" | business=${hasBusiness} | type=${ctx.chat?.type ?? "?"}`);
    if (hasBusiness) {
      try {
        const {handleBusinessUpdate} = await import("../business/index.js");
        await handleBusinessUpdate(bot, update);
      } catch (e) {
        console.error(`[Router] Business update failed:`, e);
      }
      return;
    }
    await next();
  });
}
