import {setRuntimeEnv} from "./src/config/env.js";
import {setupKvBindings} from "./src/worker/bootstrap.js";
import {handleScheduled} from "./src/worker/scheduled.js";
import {handleRequest} from "./src/worker/router.js";

type Env = Record<string, unknown>;
type Ctx = {waitUntil(p: Promise<unknown>): void};

export default {
  async scheduled(event: {cron?: string}, env: Env, ctx: Ctx): Promise<void> {
    setRuntimeEnv(env);
    setupKvBindings(env);
    await handleScheduled(event, ctx);
  },

  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    setRuntimeEnv(env);
    setupKvBindings(env);
    return handleRequest(request, env, ctx);
  },
};
