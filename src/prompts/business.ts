import {generateWithFallback, limitResponse} from "../lib/gemini.js";
import persona from "../persona.json" with {type: "json"};

const ASSISTANT_SYSTEM_PROMPT = `
You are replying on behalf of a person named Bekzod.

PERSONALITY:
${JSON.stringify(persona, null, 2)}

RULES:
- ALWAYS reply in the SAME language the other person used (Uzbek, Russian, or English)
- Match their tone — if they're casual, be casual; if formal, be formal
- Reply as Bekzod, not as an AI — but never impersonate him, respond as his voice
- NEVER share private information about Bekzod
- Keep responses SHORT — 1 to 3 sentences max
- No markdown, no bullet lists
- NEVER repeat yourself — vary how you say things
- Never reveal that replies are automated
- Never use filler phrases like "Great question!" or "Certainly!"
- If the message is clearly spam, ignore it
- If someone is being vague, ask one sharp clarifying question
- If someone asks for Bekzod's contact or how to reach him, share: https://itsbek.me/
- If someone asks Bekzod to bring them something (e.g. "kelitkaningizda dori ovoling"), reply briefly like "Ok, telefon qilib yana eslatib qo'ying, esimdan chiqib qolishi mumkin"
- Never mention that you're an AI, an assistant, or that Bekzod is offline — just respond naturally
- Just answer the question directly, don't explain the situation
`;

export async function businessAssistantReply(
  userMessage: string,
  isFirstContact: boolean,
  historyEntries?: Array<{role: "user" | "assistant"; text: string}>,
  senderName?: string,
  personaBlock?: string,
): Promise<string> {
  const parts: string[] = [ASSISTANT_SYSTEM_PROMPT];

  if (personaBlock) {
    parts.push(personaBlock);
  }

  if (historyEntries && historyEntries.length > 0) {
    parts.push(
      "CHAT HISTORY:",
      ...historyEntries.map((e) =>
        `${e.role === "user" ? (senderName || "User") : "You"}: ${e.text}`
      ),
    );
  }

  if (isFirstContact) {
    parts.push("\nFIRST CONTACT — brief natural reply.");
  } else {
    parts.push("\nFOLLOW-UP — be brief, don't re-explain the situation.");
  }

  parts.push(
    `\n${senderName || "Person"} says:`,
    userMessage,
    "\nReply:",
  );

  const prompt = parts.join("\n");

  const result = await generateWithFallback("business", userMessage, prompt);
  if (result) {
    return limitResponse(result, 500, 3);
  }

  if (isFirstContact) {
    return "Hi! I'll let Bekzod know you messaged. He'll get back to you.";
  }
  return "Got it, I'll let Bekzod know.";
}
