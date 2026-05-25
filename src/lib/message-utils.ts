const knownUsers = new Map<string, string>([
  ["azizbek_juraev1", "Aziz"],
  ["jcbbb", "Avaz"],
]);

const knownUserAliases = new Map<string, string>([
  ["azizbek_juraev1", "Aziz"],
  ["@azizbek_juraev1", "Aziz"],
  ["aziz", "Aziz"],
  ["jcbbb", "Avaz"],
  ["@jcbbb", "Avaz"],
  ["avaz", "Avaz"],
]);

export function getDisplayName(username?: string): string | undefined {
  if (!username) return undefined;
  return knownUsers.get(username.toLowerCase());
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^ -~-ÿ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isKnownPersonQuestion(text: string): string | undefined {
  const normalized = normalizeText(text);

  for (const [alias, displayName] of knownUserAliases.entries()) {
    if (normalized.includes(alias)) {
      return displayName;
    }
  }

  if (
    /(?:kim yartgan seni|kim yaratgan seni|do you know|taniysanmi|taniysan|bilasanmi|know this person|who is this)/i.test(
      normalized,
    )
  ) {
    if (/aziz/i.test(normalized)) return "Aziz";
    if (/avaz/i.test(normalized)) return "Avaz";
  }

  return undefined;
}

export function isSimpleLaughRequest(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    /^(kuldichi|kuldir|kul|haha|lol|joke|hazil|kuld|a+ha+)$/.test(
      normalized,
    ) || normalized === "kuldichi"
  );
}

export function isStopRequest(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /(?:stop|mute|quiet|shut up|be quiet|don't message|do not message|dont message|stop messaging|don't text|do not text|dont text)/i.test(
      lower,
    ) || /(?:jim bo'?l|gapirma|yozma|jim tur|tinch tur|sukut)/i.test(lower)
  );
}

export function isResumeRequest(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /(?:resume|unmute|start talking|talk again|wake up|unpause|re-enable)/i.test(
      lower,
    ) || /(?:qayta gapir|yana yoz|yozishni boshl|och|faollashtir)/i.test(lower)
  );
}

export function isPrivateCommandLike(text: string): boolean {
  const lower = text.trim().toLowerCase();
  return (
    lower === "/start" ||
    lower === "/help" ||
    lower === "/roast" ||
    lower === "/stop" ||
    lower === "/mute" ||
    lower === "/resume" ||
    lower === "/unmute" ||
    lower === "/quiet"
  );
}

export function getCommandName(text: string): string | undefined {
  const match = text.trim().match(/^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?:\s|$)/i);
  return match?.[1]?.toLowerCase();
}
