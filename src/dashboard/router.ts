import {json} from "./helpers.js";
import {getDashboardData} from "./data.js";
import {
  getFullConversationsList, getConversationDetail, handleConversationMuteGet,
  handleConversationMute, handleConversationInject, handleCancelPending,
  handleConversationBrainReset, handleConversationBrainRun, handleConversationMetaPatch,
  getConversationsList, getPendingQuestionsList, getReplyQueue, getHealthStatus,
  handleConversationAction,
} from "./conversations.js";
import {
  handleCommandGenerate, handleCommandTest, handleCommandCreate,
  handleCommandUpdate, handleCommandDelete, handleCommandRegister,
  getDashboardCommands,
} from "./commands.js";
import {getBrainOverview, getBrainLowConfidence, getBrainForChat, handleBrainPatch, handleBrainDelete} from "./brain.js";
import {handlePersonaTest, handlePersonaRevert} from "./persona.js";
import type {BotSettings} from "../lib/bot-settings/index.js";
import {getBotSettings, saveBotSettings, getDefaultSettings, getPersonaHistory} from "../lib/bot-settings/index.js";
import {getGeminiModels, setGeminiModels, getGroqModels, setGroqModels, DEFAULT_GEMINI_MODELS, DEFAULT_GROQ_CHAT_MODELS, DEFAULT_GROQ_JSON_MODELS} from "../lib/model-config.js";
import {resetUsageStats} from "../lib/usage-stats.js";
import {getConversationsKv} from "../memory/index.js";
import {HTML_HEAD} from "./page-head.js";
import {HTML_TAB_OVERVIEW_CONV_BRAIN_CMD} from "./page-tab-overview-conv-brain-cmd.js";
import {HTML_TAB_PERSONA, HTML_TAB_MODELS, HTML_TAB_USAGE} from "./page-tab-persona-models-usage.js";
import {HTML_TAB_SETTINGS} from "./page-tab-settings.js";
import {PAGE_SCRIPT} from "./page-script.js";

export async function handleDashboardApi(pathname: string, method: string, body: string | null): Promise<Response | null> {
  try {
    if (pathname === "/api/dashboard/data" && method === "GET") return getDashboardData();

    if (pathname === "/api/dashboard/models/gemini" && method === "GET") {
      return json({models: await getGeminiModels()});
    }
    if (pathname === "/api/dashboard/models/gemini" && method === "PUT") {
      if (!body) return json({error: "no body"}, 400);
      const {models} = JSON.parse(body) as {models?: string[]};
      if (!Array.isArray(models) || models.length === 0) return json({error: "models must be a non-empty array"}, 400);
      await setGeminiModels(models);
      return json({ok: true, models});
    }

    if (pathname === "/api/dashboard/models/groq" && method === "GET") {
      return json(await getGroqModels());
    }
    if (pathname === "/api/dashboard/models/groq" && method === "PUT") {
      if (!body) return json({error: "no body"}, 400);
      const mc = JSON.parse(body) as {chatModels?: string[]; jsonModels?: string[]};
      if (!Array.isArray(mc.chatModels) || mc.chatModels.length === 0) return json({error: "chatModels must be a non-empty array"}, 400);
      if (!Array.isArray(mc.jsonModels) || mc.jsonModels.length === 0) return json({error: "jsonModels must be a non-empty array"}, 400);
      await setGroqModels({chatModels: mc.chatModels, jsonModels: mc.jsonModels});
      return json({ok: true, chatModels: mc.chatModels, jsonModels: mc.jsonModels});
    }

    if (pathname === "/api/dashboard/usage/reset" && method === "POST") {
      await resetUsageStats();
      return json({ok: true});
    }

    if (pathname === "/api/dashboard/models/gemini/reset" && method === "POST") {
      await setGeminiModels(DEFAULT_GEMINI_MODELS);
      return json({ok: true, models: DEFAULT_GEMINI_MODELS});
    }

    if (pathname === "/api/dashboard/models/groq/reset" && method === "POST") {
      await setGroqModels({chatModels: DEFAULT_GROQ_CHAT_MODELS, jsonModels: DEFAULT_GROQ_JSON_MODELS});
      return json({ok: true, chatModels: DEFAULT_GROQ_CHAT_MODELS, jsonModels: DEFAULT_GROQ_JSON_MODELS});
    }

    if (pathname === "/api/dashboard/conversations" && method === "GET") return getConversationsList();
    if (pathname === "/api/dashboard/pending" && method === "GET") return getPendingQuestionsList();
    if (pathname === "/api/dashboard/queue" && method === "GET") return getReplyQueue();
    if (pathname === "/api/dashboard/health" && method === "GET") return getHealthStatus();

    const actionMatch = pathname.match(/^\/api\/dashboard\/conversations\/(\d+)\/action$/);
    if (actionMatch && method === "POST") {
      if (!body) return json({error: "no body"}, 400);
      return handleConversationAction(actionMatch[1], body);
    }

    if (pathname === "/api/dashboard/settings" && method === "GET") {
      return json(await getBotSettings());
    }
    if (pathname === "/api/dashboard/settings" && method === "PUT") {
      if (!body) return json({error: "no body"}, 400);
      const partial = JSON.parse(body) as Partial<BotSettings>;
      const current = await getBotSettings();
      await saveBotSettings({...current, ...partial});
      return json({ok: true});
    }

    if (pathname === "/api/dashboard/models/cooldowns" && method === "GET") {
      const convKv = getConversationsKv();
      if (!convKv || !convKv.list) return json([]);
      const cdResult = await convKv.list({prefix: "cooldown:"});
      const now = Date.now();
      const list = await Promise.all(cdResult.keys.map(async (key) => {
        const model = key.name.replace("cooldown:", "");
        const raw = await convKv.get(key.name);
        const until = raw ? Number(raw) || 0 : 0;
        return {model, coolingDown: until > now, expiresAt: until > now ? until : null};
      }));
      return json(list);
    }

    const clearCdMatch = pathname.match(/^\/api\/dashboard\/models\/cooldown\/(.+)$/);
    if (clearCdMatch && method === "POST") {
      const convKv = getConversationsKv();
      if (!convKv) return json({error: "KV not available"}, 500);
      await convKv.delete?.(`cooldown:${clearCdMatch[1]}`);
      return json({ok: true});
    }

    if (pathname === "/api/dashboard/settings/reset" && method === "POST") {
      await saveBotSettings(getDefaultSettings());
      return json({ok: true});
    }

    return null;
  } catch (e) {
    return json({error: String(e)}, 500);
  }
}

export async function handleNonDashboardApi(pathname: string, method: string, body: string | null): Promise<Response | null> {
  try {
    if (pathname === "/api/conversations" && method === "GET") return getFullConversationsList();

    const convChatMatch = pathname.match(/^\/api\/conversations\/(\d+)$/);
    if (convChatMatch && method === "GET") return getConversationDetail(convChatMatch[1]);

    const convMuteMatch = pathname.match(/^\/api\/conversations\/(.+)\/mute$/);
    if (convMuteMatch && method === "GET") return handleConversationMuteGet(convMuteMatch[1]);
    if (convMuteMatch && method === "POST") {
      if (!body) return json({error: "no body"}, 400);
      return handleConversationMute(convMuteMatch[1], body);
    }

    const convInjectMatch = pathname.match(/^\/api\/conversations\/(\d+)\/inject$/);
    if (convInjectMatch && method === "POST") {
      if (!body) return json({error: "no body"}, 400);
      return handleConversationInject(convInjectMatch[1], body);
    }

    const convCancelMatch = pathname.match(/^\/api\/conversations\/(\d+)\/cancel-pending$/);
    if (convCancelMatch && method === "POST") return handleCancelPending(convCancelMatch[1]);

    const convBrainResetMatch = pathname.match(/^\/api\/conversations\/(\d+)\/brain-reset$/);
    if (convBrainResetMatch && method === "POST") return handleConversationBrainReset(convBrainResetMatch[1]);

    const convBrainRunMatch = pathname.match(/^\/api\/conversations\/(\d+)\/brain-run$/);
    if (convBrainRunMatch && method === "POST") return handleConversationBrainRun(convBrainRunMatch[1]);

    const convMetaMatch = pathname.match(/^\/api\/conversations\/(\d+)\/meta$/);
    if (convMetaMatch && method === "PATCH") {
      if (!body) return json({error: "no body"}, 400);
      return handleConversationMetaPatch(convMetaMatch[1], body);
    }

    if (pathname === "/api/commands/generate" && method === "POST") {
      if (!body) return json({error: "no body"}, 400);
      return handleCommandGenerate(body);
    }
    if (pathname === "/api/commands/test" && method === "POST") {
      if (!body) return json({error: "no body"}, 400);
      return handleCommandTest(body);
    }
    if (pathname === "/api/commands" && method === "GET") {
      return json(await getDashboardCommands());
    }
    if (pathname === "/api/commands" && method === "POST") {
      if (!body) return json({error: "no body"}, 400);
      return handleCommandCreate(body);
    }

    const cmdPatchMatch = pathname.match(/^\/api\/commands\/([a-zA-Z0-9]+)$/);
    if (cmdPatchMatch && method === "PATCH") {
      if (!body) return json({error: "no body"}, 400);
      return handleCommandUpdate(cmdPatchMatch[1], body);
    }
    if (cmdPatchMatch && method === "DELETE") return handleCommandDelete(cmdPatchMatch[1]);

    if (pathname.match(/^\/api\/commands\/([a-zA-Z0-9]+)\/register$/) && method === "POST") {
      return handleCommandRegister();
    }

    if (pathname === "/api/brain/overview" && method === "GET") return getBrainOverview();
    if (pathname === "/api/brain/low-confidence" && method === "GET") return getBrainLowConfidence();

    const brainChatMatch = pathname.match(/^\/api\/brain\/(\d+)$/);
    if (brainChatMatch && method === "GET") return getBrainForChat(brainChatMatch[1]);
    if (brainChatMatch && method === "PATCH") {
      if (!body) return json({error: "no body"}, 400);
      return handleBrainPatch(brainChatMatch[1], body);
    }
    if (brainChatMatch && method === "DELETE") return handleBrainDelete(brainChatMatch[1]);

    const brainRunMatch = pathname.match(/^\/api\/brain\/(\d+)\/run$/);
    if (brainRunMatch && method === "POST") return handleConversationBrainRun(brainRunMatch[1]);

    if (pathname === "/api/persona/test" && method === "POST") {
      if (!body) return json({error: "no body"}, 400);
      return handlePersonaTest(body);
    }
    if (pathname === "/api/persona/history" && method === "GET") {
      return json(await getPersonaHistory());
    }

    const personaRevertMatch = pathname.match(/^\/api\/persona\/revert\/(\d+)$/);
    if (personaRevertMatch && method === "POST") return handlePersonaRevert(personaRevertMatch[1]);

    return null;
  } catch (e) {
    return json({error: String(e)}, 500);
  }
}

export function renderDashboardPage(): Response {
  const html = HTML_HEAD + HTML_TAB_OVERVIEW_CONV_BRAIN_CMD + HTML_TAB_PERSONA + HTML_TAB_MODELS + HTML_TAB_USAGE + HTML_TAB_SETTINGS + PAGE_SCRIPT;

  return new Response(html, {
    headers: {"content-type": "text/html; charset=utf-8"},
  });
}
