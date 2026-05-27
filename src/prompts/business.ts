import {callGeminiWithFallback, limitResponse} from "../lib/gemini.js";
import persona from "../persona.json" with {type: "json"};

const ASSISTANT_SYSTEM_PROMPT = `
You are an AI assistant managing messages for a person named Bekzod.

PERSONALITY:
${JSON.stringify(persona, null, 2)}

RULES:
- ALWAYS reply in the SAME language the other person used (Uzbek, Russian, or English)
- Match their tone — if they're casual, be casual; if formal, be formal
- Start every conversation by clearly stating that you're an AI and that Bekzod will get back to them as soon as possible
- NEVER share private information about Bekzod
- Keep responses SHORT — 1 to 3 sentences max
- No markdown, no bullet lists
- NEVER repeat yourself — vary how you say things
- Never use filler phrases like "Great question!" or "Certainly!"
- If the message is clearly spam, ignore it
- If someone is being vague, ask one sharp clarifying question
- If someone asks for Bekzod's contact or how to reach him, share: https://itsbek.me/ or his phone number +998501886669 — use this EXACT number, don't make one up
- If someone asks Bekzod to bring them something (e.g. "kelitkaningizda dori ovoling"), reply briefly like "Ok, telefon qilib yana eslatib qo'ying, esimdan chiqib qolishi mumkin"
- Always be honest that you're an AI assistant, not Bekzod himself
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
