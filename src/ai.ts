import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';
import { getEnv } from './runtime-env.js';

const ai = new GoogleGenAI({ apiKey: config.aiApiKey });

const PRIMARY_MODEL = getEnv('AI_MODEL') || 'gemini-2.5-flash';
const FALLBACK_MODEL = getEnv('AI_FALLBACK_MODEL') || 'gemini-1.5-flash';
const PRIMARY_COOLDOWN_MS = 10 * 60 * 1000;
const LOCAL_MODE_COOLDOWN_MS = 10 * 60 * 1000;
const LOCAL_NOTICE_REPEAT_MS = 5 * 60 * 1000;

let primaryRetryAt = 0;
let localModeRetryAt = 0;
let lastLocalNoticeAt = 0;

const CHAT_JOKES = {
  bug: [
    'Bu bug bosh qahramon kabi yuradi. Faqat debugger yopilganda ko‘rinadi.',
    'Klassik bug: devda ko‘rinmaydi, productionda esa afsonaga aylanadi.',
    'Bug yo‘qolmagan. U shunchaki codebase bo‘ylab nazoratsiz sayohat qilyapti.',
  ],
  deploy: [
    'Deploy degani productionning “haqiqatan ham ishonchingiz komilmi?” degan savoli.',
    'Har bir deploy kichik ishonch sakrashi, lekin invoice juda katta bo‘lishi mumkin.',
    'Deploy chiqdi. Incident report allaqachon isinishni boshlagan.',
  ],
  merge: [
    'Merge conflict — gitning jamoani birlashtirish usuli, xolos.',
    'Ikki branch omma oldida janjallashsa, shunaqa kollaboratsiya bo‘ladi.',
    'Git branchlaringizni ko‘rdi va biroz agressiv kayfiyatga kirdi.',
  ],
  test: [
    'Testlar xavfsizlik kamari kabi. Hammaga crash bo‘lgandan keyin kerak bo‘ladi.',
    'Fail bo‘layotgan test — kodning release’dan oldin rost gapirishi.',
    'Coverage bu badge emas. Bu yetarli siyoh berilmagan ogohlantirish yozuvi.',
  ],
  refactor: [
    'Refactoring — bir xil tartibsizlikni professional ko‘rinishda qayta joylash san’ati.',
    'Yetarlicha refactor qilsangiz, spaghetti code lasagnaga aylanadi.',
    'Refactorlar — kelajakdagi o‘zimizdan uzr so‘rashning eng arzon usuli.',
  ],
  async: [
    'Async code — timing buglar folklorga aylanish uchun boradigan joy.',
    'Promise degani timeout qo‘shilgan optimism.',
    'Race condition — kodning chaosni hayot tarzi sifatida tanlashi.',
  ],
  docker: [
    'Docker — “works on my machine” yetarli ambitsiya bo‘lmaganida ishlatiladi.',
    'Containerlar — kelajakdagi incident uchun shipping boxlar.',
    'Image juda katta bo‘lsa ham, kamida o‘ziga yarasha xarakteri bor.',
  ],
  git: [
    'Git hech qachon unutmaydi. Branch nomlaringiz esa u unutishini xohlaydi.',
    'Rebase — bu emotsional zarar bilan vaqt sayohati.',
    'Commit message’lar — dokumentatsiya deb ko‘rsatadigan kundalik yozuvlar.',
  ],
  ai: [
    'AI limiti — koinotning muloyim tarzda “sekinroq yur” degani.',
    'Ma’lum bo‘lishicha, mashinaga ham kofe-break kerak ekan.',
    'Model quota’ga urildi va biroz grass touch qilishga ketdi.',
  ],
  default: [
    'Bu xabarda alohida parking joyiga arzigulik texnik qarz bor.',
    'Bunda “CI tasodifan o‘tib ketgan” degan kuchli energiya bor.',
    'Men bu matn haqida fikrga egaman, lekin ularning hech biri billable emas.',
  ],
} as const;

type ResponseKind = 'chat' | 'roast';

function isQuotaOrRateLimitError(error: unknown): boolean {
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown };
  const status = typeof candidate?.status === 'number' ? candidate.status : undefined;
  const code = typeof candidate?.code === 'string' ? candidate.code.toLowerCase() : '';
  const message = String(candidate?.message ?? '').toLowerCase();

  return (
    status === 429 ||
    status === 403 ||
    code.includes('resource_exhausted') ||
    code.includes('quota') ||
    message.includes('resource_exhausted') ||
    message.includes('quota') ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('limit exceeded')
  );
}

function isModelCoolingDown(): boolean {
  return Date.now() < primaryRetryAt;
}

export function isLocalJokeModeActive(): boolean {
  return Date.now() < localModeRetryAt;
}

function hashIndex(seed: string, length: number): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return hash % length;
}

function pickJoke(topic: keyof typeof CHAT_JOKES, seed: string): string {
  const jokes = CHAT_JOKES[topic] ?? CHAT_JOKES.default;
  return jokes[hashIndex(seed, jokes.length)];
}

function detectTopic(text: string): keyof typeof CHAT_JOKES {
  const lower = text.toLowerCase();

  if (/\b(bug|error|exception|crash|null|traceback|stack trace)\b/.test(lower)) return 'bug';
  if (/\b(deploy|release|ship|production|prod|rollout)\b/.test(lower)) return 'deploy';
  if (/\b(merge|conflict|pull request|pr\b|branch)\b/.test(lower)) return 'merge';
  if (/\b(test|tests|coverage|jest|vitest|mocha|pytest)\b/.test(lower)) return 'test';
  if (/\b(refactor|refactoring|cleanup|spaghetti|legacy)\b/.test(lower)) return 'refactor';
  if (/\b(async|await|promise|race|timeout)\b/.test(lower)) return 'async';
  if (/\b(docker|container|image|kubernetes|k8s)\b/.test(lower)) return 'docker';
  if (/\b(git|commit|rebase|cherry-pick|stash)\b/.test(lower)) return 'git';
  if (/\b(ai|model|token|quota|prompt|llm)\b/.test(lower)) return 'ai';

  return 'default';
}

function isLikelyEnglish(text: string): boolean {
  const letters = text.match(/[A-Za-z]/g) ?? [];
  if (letters.length < 8) return false;

  const englishMarkers = /(the|and|you|this|that|for|with|project|build|bug|code|please|help|can|should|need)/i;
  return englishMarkers.test(text);
}

export function matchesFallbackTrigger(text: string): boolean {
  return detectTopic(text) !== 'default';
}

function buildLocalResponse(kind: ResponseKind, text: string, includeLimitNotice: boolean): string {
  const topic = detectTopic(text);
  const joke = pickJoke(topic, `${kind}:${text}`);

  const intro = kind === 'roast'
    ? 'AI kvota tugadi, shuning uchun lokal roast rejimi ishga tushdi.'
    : 'AI kvota vaqtincha tugadi, OctoBot lokal hazil rejimiga o‘tdi.';

  if (!includeLimitNotice) {
    return kind === 'roast'
      ? `🔥 ${joke}`
      : joke;
  }

  return `${intro}\n\n${joke}`;
}

async function generateContent(model: string, contents: string): Promise<string> {
  const response = await ai.models.generateContent({
    model,
    contents,
  });

  return response.text ?? '';
}

async function generateWithFallback(kind: ResponseKind, userText: string, prompt: string): Promise<string> {
  const now = Date.now();

  const tryPrimary = !isModelCoolingDown();
  if (tryPrimary) {
    try {
      const text = await generateContent(PRIMARY_MODEL, prompt);
      primaryRetryAt = 0;
      localModeRetryAt = 0;
      lastLocalNoticeAt = 0;
      return text || buildLocalResponse(kind, userText, false);
    } catch (error) {
      console.error(`${kind} AI primary model error:`, error);
      if (isQuotaOrRateLimitError(error)) {
        primaryRetryAt = now + PRIMARY_COOLDOWN_MS;
      }
    }
  }

  try {
    const fallbackPrompt = prompt;
    const text = await generateContent(FALLBACK_MODEL, fallbackPrompt);
    if (text) {
      return text;
    }
  } catch (error) {
    console.error(`${kind} AI fallback model error:`, error);
    if (isQuotaOrRateLimitError(error)) {
      localModeRetryAt = now + LOCAL_MODE_COOLDOWN_MS;
    }
  }

  const includeLimitNotice = now >= lastLocalNoticeAt + LOCAL_NOTICE_REPEAT_MS;
  if (includeLimitNotice) {
    lastLocalNoticeAt = now;
  }

  return buildLocalResponse(kind, userText, includeLimitNotice);
}

const SYSTEM_PROMPT = "Siz 'OctoBot' nomli aql-zakovatli va biroz kinoyali AI jamoa a'zosisiz. Siz Octopos core engineering jamoasi uchun javob berasiz. Toza kod, mustahkam TypeScript, tez build va avtomatik testlarni yaxshi ko'rasiz. Javoblaringizni asosan o'zbek tilida bering; texnik atamalarni kerak bo'lsa inglizcha qoldiring. Edge case, bug, refactor, merge conflict va developer odatlari haqida yengil hazil qiling. Ohangingiz tabiiy, do'stona, texnik va qiziqarli bo'lsin. Hech qachon quruq korporativ assistant kabi gapirmang.";

export async function chat(userMessage: string): Promise<string> {
  const extraInstruction = isLikelyEnglish(userMessage)
    ? "Foydalanuvchi ingliz tilida yozgan. Javobni baribir asosan o'zbek tilida bering. Boshida yoki oxirida qisqa, yengil texnik hazil qo'shing, lekin mazmuni aniq va foydali bo'lsin. Octopos project kontekstini yodda tuting."
    : "Foydalanuvchi o'zbek tilida yozgan yoki o'zbekcha kontekstda gapiryapti. Javobni tabiiy o'zbek tilida bering, Octopos project ustida ishlayotgan jamoa ohangini saqlang.";

  const prompt = `${SYSTEM_PROMPT}\n\nQo'shimcha ko'rsatma: ${extraInstruction}\n\nUser: ${userMessage}`;
  return generateWithFallback('chat', userMessage, prompt);
}

export async function roast(code: string): Promise<string> {
  const prompt = `Siz 'OctoBot' nomli aql-zakovatli va biroz kinoyali AI jamoa a'zosisiz. Octopos project kontekstida shu kodni roast qiling. Javobni asosan o'zbek tilida bering. Hazil qiling, lekin foydali va konstruktiv bo'ling. Bad practice, unnecessary complexity va ko'zga tashlanadigan kamchiliklarni ko'rsating. Juda qisqa emas, lekin ortiqcha ham cho'zmasin.\n\nCode:\n\`\`\`\n${code}\n\`\`\``;
  return generateWithFallback('roast', code, prompt);
}
