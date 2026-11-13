import { clip, neutralizeMentions } from "@/lib/discord/embed";

/** Texto vindo de fora (URL, referer, UA): sem controle/crase, sem menções, cortado. */
export function safeText(input: string, max: number): string {
  const cleaned = input
    .replace(/[\u0000-\u001f\u007f`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clip(neutralizeMentions(cleaned), max);
}

/** Emoji de bandeira para um código ISO de 2 letras; vazio se inválido. */
export function countryFlag(code: string | null | undefined): string {
  const upper = (code ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper) || upper === "XX") return "";
  return String.fromCodePoint(...[...upper].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
