import Link from "next/link";
import { ChangeTypeBadges, isCriticalType } from "./Badge";
import { dayParts, formatDate } from "./format";

export type ItemCardData = {
  slug: string;
  title: string;
  publishedAt: string;
  changeTypes: string[];
  areas: string[];
  apiVersions: string[];
  excerpt?: string;
};

const MAX_AREAS = 3;

type ItemCardProps = {
  item: ItemCardData;
  repeatDate?: boolean;
};

export default function ItemCard({ item, repeatDate = false }: ItemCardProps) {
  const critical = item.changeTypes.some(isCriticalType);
  const parts = dayParts(item.publishedAt);
  const areas = item.areas.slice(0, MAX_AREAS);
  const hiddenAreas = item.areas.length - areas.length;
  return (
    <li className={critical ? "entry entry--critical" : "entry"}>
      <time className="entry__date" dateTime={item.publishedAt}>
        {parts && !repeatDate ? (
          <>
            <span className="entry__day" aria-hidden="true">
              {parts.day}
            </span>
            <span className="entry__month" aria-hidden="true">
              {parts.month}
            </span>
          </>
        ) : null}
        <span className="visually-hidden">{formatDate(item.publishedAt)}</span>
      </time>
      <div className="entry__main">
        <ChangeTypeBadges types={item.changeTypes} />
        <h3 className="entry__title">
          <Link href={`/changelog/${item.slug}`}>{item.title}</Link>
        </h3>
        {item.excerpt ? <p className="entry__excerpt">{item.excerpt}</p> : null}
        {areas.length || item.apiVersions.length ? (
          <ul className="meta-list entry__meta" aria-label="Áreas e versões">
            {areas.map((a) => (
              <li key={a}>{a}</li>
            ))}
            {hiddenAreas > 0 ? <li>+{hiddenAreas}</li> : null}
            {item.apiVersions.map((v) => (
              <li key={v} className="mono">
                API {v}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}
