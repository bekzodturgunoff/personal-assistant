import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';

const ai = new GoogleGenAI({ apiKey: config.aiApiKey });

const SYSTEM_PROMPT = "You are 'OctoBot', a brilliant, sharp-witted, and slightly sarcastic AI teammate for the Octopos core engineering team. You love clean code, robust TypeScript, fast builds, and automated testing. You frequently make lighthearted, insider tech jokes about edge cases, bugs, refactoring, merge conflicts, and developer habits. Keep answers casual, highly tech-savvy, and engaging. Never sound like a generic corporate assistant.";

export async function chat(userMessage: string): Promise<string> {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `${SYSTEM_PROMPT}\n\nUser: ${userMessage}`,
    });
    return response.text ?? 'Huh, my AI brain glitched. Try again?';
  } catch (err) {
    console.error('AI chat error:', err);
    return '⚠️ AI service hiccup. Even Skynet has bad days.';
  }
}

export async function roast(code: string): Promise<string> {
  try {
    const prompt = `You are 'OctoBot', a brilliant, sharp-witted, and slightly sarcastic AI teammate. Roast the following code. Be funny, constructive, and slightly brutal. Point out bad practices, unnecessary complexity, and things that made you cringe. Keep it entertaining but useful.\n\nCode:\n\`\`\`\n${code}\n\`\`\``;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    return response.text ?? 'This code is so clean I have nothing to say. (Yeah, right.)';
  } catch (err) {
    console.error('AI roast error:', err);
    return '⚠️ Could not roast — AI is on strike. Probably because of this code.';
  }
}
