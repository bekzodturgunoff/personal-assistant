import type {Bot} from "grammy/web";
import {setupRouter} from "./router.js";
import {setupPublicCommands} from "./public-commands.js";
import {setupOwnerInfoCommands} from "./owner-info.js";
import {setupOwnerManageCommands} from "./owner-manage.js";
import {setupOwnerActionCommands} from "./owner-action.js";
import {setupDmHandler} from "./dm-handler.js";

export function setupTelegramHandlers(bot: Bot): void {
  setupRouter(bot);
  setupPublicCommands(bot);
  setupOwnerInfoCommands(bot);
  setupOwnerManageCommands(bot);
  setupOwnerActionCommands(bot);
  setupDmHandler(bot);
}
