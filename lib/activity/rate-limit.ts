export type ActivityLimiter = {
  /** true = pode notificar agora; false = descartado (e contado). */
  tryTake(): boolean;
  /** Quantos foram descartados desde a última chamada; zera o contador. */
  takeDropped(): number;
};

export const VISIT_NOTICES_PER_MINUTE = 10;

/** Janela deslizante em memória (por instância do servidor). */
export function createRateLimiter(max: number, windowMs: number, now: () => number = Date.now): ActivityLimiter {
  let stamps: number[] = [];
  let dropped = 0;
  return {
    tryTake() {
      const t = now();
      stamps = stamps.filter((s) => t - s < windowMs);
      if (stamps.length >= max) {
        dropped += 1;
        return false;
      }
      stamps.push(t);
      return true;
    },
    takeDropped() {
      const n = dropped;
      dropped = 0;
      return n;
    },
  };
}
