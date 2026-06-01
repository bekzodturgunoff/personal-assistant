const SUMMARY_INTERVAL = 8;

interface Entry {
  role: "user" | "assistant";
  text: string;
}

interface KvStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

interface UserPersona {
  summary: string;
  topics: string[];
  tone: string;
  messageCount: number;
  lastUpdated: number;
  firstContactDate: number;
  relationshipStage: "new" | "familiar" | "regular" | "close";
}

let kvBinding: KvStore | null = null;

export function setKvBinding(kv: KvStore): void {
  kvBinding = kv;
}

const defaultPersona = (): UserPersona => ({
  summary: "",
  topics: [],
  tone: "neutral",
  messageCount: 0,
  lastUpdated: 0,
  firstContactDate: 0,
  relationshipStage: "new",
});

function detectTopics(text: string): string[] {
  const topicKeywords: Record<string, RegExp[]> = {
    tech: [/code|app|bot|tech|site|dastur|program|server|api/i],
    biznes: [/trade|trading|deal|money|pul|biznes|invest|savdo/i],
    transport: [/bike|moto|car|mashina|velo|motor/i],
    hayot: [/life|rejalar|plan|kelajak|future|ish|work/i],
  };
  const found: string[] = [];
  for (const [topic, patterns] of Object.entries(topicKeywords)) {
    if (patterns.some((p) => p.test(text)) && !found.includes(topic)) {
      found.push(topic);
    }
  }
  return found;
}

function detectTone(text: string): string {
  if (/thanks|rahmat|please|iltimos/i.test(text)) return "polite";
  if (/nima|what|why|nega|kim|who/i.test(text)) return "curious";
  if (/bro|aka|opa|do'st/i.test(text)) return "casual";
  return "neutral";
}

function inferRelationshipStage(count: number): UserPersona["relationshipStage"] {
  if (count >= 30) return "close";
  if (count >= 12) return "regular";
  if (count >= 4) return "familiar";
  return "new";
}

export async function recordMessage(
  chatId: number,
  role: Entry["role"],
  text: string,
): Promise<void> {
  const key = `persona:${chatId}`;
  let persona = defaultPersona();

  if (kvBinding) {
    const raw = await kvBinding.get(key);
    if (raw) persona = JSON.parse(raw);
  }

  if (persona.firstContactDate === 0) {
    persona.firstContactDate = Date.now();
  }

  persona.messageCount++;
  persona.relationshipStage = inferRelationshipStage(persona.messageCount);

  const newTopics = detectTopics(text);
  for (const t of newTopics) {
    if (!persona.topics.includes(t)) persona.topics.push(t);
  }
  persona.tone = detectTone(text);

  if (role === "user" && persona.messageCount % SUMMARY_INTERVAL === 0) {
    persona.summary = `Last topics: ${persona.topics.slice(-3).join(", ")}. Tone: ${persona.tone}.`;
    persona.lastUpdated = Date.now();
  }

  if (kvBinding) {
    await kvBinding.put(key, JSON.stringify(persona));
  }
}

export async function getPersona(chatId: number): Promise<UserPersona> {
  if (kvBinding) {
    const raw = await kvBinding.get(`persona:${chatId}`);
    if (raw) return JSON.parse(raw);
  }
  return defaultPersona();
}

export async function buildPersonaBlock(chatId: number): Promise<string> {
  const p = await getPersona(chatId);
  const parts: string[] = [];

  if (p.relationshipStage !== "new") {
    parts.push(`Relationship: ${p.relationshipStage} (${p.messageCount} messages so far).`);
  }

  if (p.topics.length > 0) {
    parts.push(`Topics they discuss: ${p.topics.join(", ")}.`);
  }
  if (p.tone !== "neutral") {
    parts.push(`Their tone is usually: ${p.tone}.`);
  }
  if (p.summary) {
    parts.push(`Summary of past chats: ${p.summary}`);
  }
  return parts.length > 0 ? `\nAbout this person:\n${parts.join("\n")}\n` : "";
}

export async function getRelationshipStage(chatId: number): Promise<UserPersona["relationshipStage"]> {
  const p = await getPersona(chatId);
  return p.relationshipStage;
}
