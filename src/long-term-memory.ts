import {getLongTermKv} from "./lib/kv-store.js";

interface UserMemory {
  userId: number;
  facts: string[];
  lastUpdated: number;
}

const MAX_FACTS = 20;

export async function extractAndStoreFact(
  userId: number,
  userMessage: string,
  botReply: string,
): Promise<void> {
  const kv = getLongTermKv();
  if (!kv) return;

  const key = `memory:${userId}`;
  const raw = await kv.get(key);
  const memory: UserMemory = raw ? JSON.parse(raw) : {userId, facts: [], lastUpdated: 0};

  const fact = inferFact(userMessage, botReply);
  if (!fact) return;

  if (!memory.facts.includes(fact)) {
    memory.facts.push(fact);
    memory.lastUpdated = Date.now();
  }

  if (memory.facts.length > MAX_FACTS) {
    memory.facts = compressFacts(memory.facts);
  }

  await kv.put(key, JSON.stringify(memory));
}

function inferFact(userMsg: string, _botReply: string): string | null {
  const lower = userMsg.toLowerCase();

  if (/kechasi|tunda|midnight|kechqurun|sleep|uxla/i.test(lower)) return "usually active at night";
  if (/startup|biznes|loyiha|project|company|kompaniya/i.test(lower)) return "runs a business or project";
  if (/code|app|bot|dastur|program|developer|site|web/i.test(lower)) return "works in tech";
  if (/voice|audio|ovozli/i.test(lower)) return "prefers voice messages";
  if (/erta|early|tong|morning/i.test(lower)) return "active in the morning";
  if (/moto|bike|velo|motor/i.test(lower)) return "interested in bikes/motors";
  if (/trade|savdo|invest|money|pul|bitcoin|kripto/i.test(lower)) return "interested in trading/investing";
  if (/travel|sayohat|safar|trip/i.test(lower)) return "enjoys traveling";
  if (/tezda|quick|fast|tez|shosh/i.test(lower)) return "prefers quick responses";
  if (/batafsil|detailed|batafsilroq/i.test(lower)) return "prefers detailed answers";
  if (/kechir|sorry|uzr/i.test(lower)) return "tends to be polite";

  return null;
}

function compressFacts(facts: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const f of facts) {
    const key = f.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(f);
    }
  }
  return unique.slice(-10);
}

export async function getFactsBlock(userId: number): Promise<string> {
  const kv = getLongTermKv();
  if (!kv) return "";

  const raw = await kv.get(`memory:${userId}`);
  if (!raw) return "";

  const memory: UserMemory = JSON.parse(raw);
  if (memory.facts.length === 0) return "";

  return "What I know about this person:\n- " + memory.facts.join("\n- ");
}

export async function updateOwnerProfile(text: string): Promise<void> {
  const kv = getLongTermKv();
  if (!kv) return;

  const key = "owner_profile";
  const raw = await kv.get(key);
  const profile: UserMemory = raw ? JSON.parse(raw) : {userId: 0, facts: [], lastUpdated: 0};

  const fact = inferFact(text, "");
  if (fact && !profile.facts.includes(fact)) {
    profile.facts.push(fact);
    profile.lastUpdated = Date.now();
    if (profile.facts.length > MAX_FACTS) {
      profile.facts = compressFacts(profile.facts);
    }
    await kv.put(key, JSON.stringify(profile));
  }
}

export async function getOwnerProfileBlock(): Promise<string> {
  const kv = getLongTermKv();
  if (!kv) return "";

  const raw = await kv.get("owner_profile");
  if (!raw) return "";

  const profile: UserMemory = JSON.parse(raw);
  if (profile.facts.length === 0) return "";

  return "About Bekzod:\n- " + profile.facts.join("\n- ");
}
