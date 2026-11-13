// Tipos compartilhados entre os módulos (contrato).
// Mudar uma assinatura exige atualizar todos os consumidores.

export type FeedItem = {
  guid: string;
  link: string;
  slug: string;
  title: string;
  publishedAt: string;
  updatedAt: string;
  categories: string[];
  changeTypes: string[];
  areas: string[];
  apiVersions: string[];
  descriptionHtml: string;
  descriptionText: string;
  contentHash: string;
};

export type StoredItem = FeedItem & {
  summaryPt: string | null;
  notifyStatus: NotifyStatus;
  notifyAttempts: number;
  notifiedAt: string | null;
};

export type NotifyStatus = "pending" | "sending" | "sent" | "failed" | "skipped";

export type SyncResult = {
  status: "ok" | "locked" | "feed_error";
  seeded: boolean;
  inserted: number;
  updated: number;
  posted: number;
  failed: number;
  remaining: number;
};
