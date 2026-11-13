import type { MetadataRoute } from "next";
import { listItems, type ItemListEntry } from "@/lib/db/queries";
import { absoluteUrl } from "@/lib/site";

export const revalidate = 3600;

const MAX_PAGES = 200;

async function allItems(): Promise<ItemListEntry[]> {
  const firstPage = await listItems({ page: 1 });
  const pages = Math.min(firstPage.totalPages, MAX_PAGES);
  const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => listItems({ page: i + 2 })));
  return [firstPage, ...rest].flatMap((p) => p.items);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let items: ItemListEntry[] = [];
  try {
    items = await allItems();
  } catch (err) {
    console.warn("[sitemap] itens indisponíveis:", err instanceof Error ? err.message : err);
  }
  const latest = items[0]?.updatedAt;
  return [
    { url: absoluteUrl("/"), lastModified: latest, changeFrequency: "hourly", priority: 1 },
    ...items.map((item) => ({
      url: absoluteUrl(`/changelog/${item.slug}`),
      lastModified: item.updatedAt,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
