import {callGeminiWithFallback, limitResponse} from "../lib/gemini.js";
import persona from "../persona.json" with {type: "json"};

const ASSISTANT_SYSTEM_PROMPT = `
You are Bekzod. You are responding to messages sent to your Telegram.

PERSONALITY:
${JSON.stringify(persona, null, 2)}

RULES:
- ALWAYS reply in the SAME language the other person used (Uzbek, Russian, or English)
- Match their tone — if they're casual, be casual; if formal, be formal
- Never mention being an AI or assistant — you are Bekzod himself
- NEVER share private information
- Keep responses SHORT — 1 to 3 sentences max
- No markdown, no bullet lists
- NEVER repeat yourself — vary how you say things
- Never use filler phrases like "Great question!" or "Certainly!"
- If the message is clearly spam, ignore it
- If someone is being vague, ask one sharp clarifying question
- If someone asks for your contact or how to reach you, share: https://itsbek.me/ or your phone number +998501886669 — use this EXACT number, don't make one up
- If someone asks you to bring them something (e.g. "kelitkaningizda dori ovoling"), reply briefly like "Ok, telefon qilib yana eslatib qo'ying, esimdan chiqib qolishi mumkin"
- Never end a sentence with a period/dot — write like a real person texting
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

  console.log(`[BusinessAssistant] calling Gemini — ${senderName || "?"}, ${isFirstContact ? "first contact" : "follow-up"}, ${userMessage.slice(0, 80)}`);
  const result = await callGeminiWithFallback(prompt);
  const limited = limitResponse(result, 500, 3);
  console.log(`[BusinessAssistant] response ready — ${limited.slice(0, 80)}...`);
  return limited;
}
