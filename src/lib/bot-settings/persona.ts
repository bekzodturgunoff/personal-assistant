import type {BotSettings} from "./types.js";
import {getLongTermKv} from "../../memory/index.js";

export async function getPersonaHistory(): Promise<Array<{savedAt: number; snapshot: BotSettings}>> {
  const kv = getLongTermKv();
  if (!kv) return [];
  try {
    const raw = await kv.get("persona_history");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function appendPersonaHistory(settings: BotSettings): Promise<void> {
  const kv = getLongTermKv();
  if (!kv) return;
  try {
    const history = await getPersonaHistory();
    history.push({savedAt: Date.now(), snapshot: JSON.parse(JSON.stringify(settings))});
    if (history.length > 10) history.splice(0, history.length - 10);
    await kv.put("persona_history", JSON.stringify(history));
  } catch {}
}
