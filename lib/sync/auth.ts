import { createHash, timingSafeEqual } from "node:crypto";

// Autorização da rota de sync: `Authorization: Bearer ${CRON_SECRET}`.

const BEARER_PREFIX = "Bearer ";

/**
 * Compara o header com o segredo em tempo constante. Ambos os lados passam por sha256 antes do
 * `timingSafeEqual`, então os buffers têm sempre 32 bytes (a guarda de tamanho nunca dispara e o
 * tempo não depende do tamanho do token enviado).
 */
export function isAuthorizedBearer(header: string | null, secret: string): boolean {
  if (secret === "") return false;
  const token = header !== null && header.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : "";
  const a = createHash("sha256").update(token, "utf8").digest();
  const b = createHash("sha256").update(secret, "utf8").digest();
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b) && token !== "";
}
