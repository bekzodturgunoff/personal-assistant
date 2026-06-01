export interface IntentSignals {
  isUrgent: boolean;
  isGreeting: boolean;
  isPriceInquiry: boolean;
  isComplaint: boolean;
  detectedLanguage: "uz" | "ru" | "en" | "mixed";
  estimatedUrgency: "low" | "medium" | "high";
}

const URGENT_WORDS = /(tezda|tez|hozir|zarur|urgent|asap|quick|darhol|kechikma|срочно|shoshilinch|zudlik)/i;
const GREETING_WORDS = /(salom|привет|hi|hello|assalomu alaykum|salom alejkum|hayrli kun|hayrli tong|hayrli kech)/i;
const PRICE_WORDS = /(narx|price|qancha|стоимость|цена|сколько|how much|narcxi|baho)/i;
const COMPLAINT_WORDS = /(yomon|ishlamayapti|muammo|problem|жалоба|buzuq|noto'g'ri|nosoz|error|xato|bug)/i;

const UZ_PARTICLES = /\b(va|bu|men|agar|bilan|uchun|biz|siz|ular|kim|nima|qanday|nega|chunki|lekin|ammo|yoki|bir|bor|yo'q|kerak|mumkin)\b/i;
const CYRILLIC_RANGE = /[\u0400-\u04FF]/;
const LATIN_UZ = /[a-zA-Z]/;

export function classifyIntent(text: string): IntentSignals {
  const trimmed = text.trim();
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;

  const isUrgent = URGENT_WORDS.test(trimmed) || trimmed.includes("!!");
  const isGreeting = GREETING_WORDS.test(trimmed);
  const isPriceInquiry = PRICE_WORDS.test(trimmed);
  const isComplaint = COMPLAINT_WORDS.test(trimmed);

  const hasCyrillic = CYRILLIC_RANGE.test(trimmed);
  const hasLatin = LATIN_UZ.test(trimmed);
  const hasUzParticles = UZ_PARTICLES.test(trimmed);

  let detectedLanguage: IntentSignals["detectedLanguage"];
  if (hasCyrillic && !hasLatin) {
    detectedLanguage = "ru";
  } else if (hasLatin && hasUzParticles) {
    detectedLanguage = "uz";
  } else if (hasLatin) {
    detectedLanguage = "en";
  } else {
    detectedLanguage = "mixed";
  }

  let estimatedUrgency: IntentSignals["estimatedUrgency"];
  if (isUrgent) {
    estimatedUrgency = "high";
  } else if (wordCount < 5 && isPriceInquiry) {
    estimatedUrgency = "high";
  } else if (isComplaint) {
    estimatedUrgency = "high";
  } else if (isPriceInquiry) {
    estimatedUrgency = "medium";
  } else {
    estimatedUrgency = "low";
  }

  return {
    isUrgent,
    isGreeting,
    isPriceInquiry,
    isComplaint,
    detectedLanguage,
    estimatedUrgency,
  };
}
