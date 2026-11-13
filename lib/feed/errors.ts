// Erros tipados do pipeline do feed. O sync mapeia ambos para `feed_error`.

export type FeedFetchErrorKind = "timeout" | "http" | "network" | "empty";

export class FeedFetchError extends Error {
  readonly kind: FeedFetchErrorKind;
  readonly status?: number;

  constructor(kind: FeedFetchErrorKind, message: string, options?: { status?: number; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "FeedFetchError";
    this.kind = kind;
    this.status = options?.status;
  }
}

/** XML inválido, estrutura RSS ausente ou feed sem nenhum item aproveitável. */
export class FeedParseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "FeedParseError";
  }
}
