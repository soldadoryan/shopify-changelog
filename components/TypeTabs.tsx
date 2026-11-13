import Link from "next/link";
import { changeTypeShortLabel, changeTypeTone, sortChangeTypes } from "./Badge";
import type { Facet, FilterValues } from "./FilterBar";
import { listHref } from "./href";

type TypeTabsProps = {
  types: Facet[];
  values: FilterValues;
  allCount?: number;
};

export default function TypeTabs({ types, values, allCount }: TypeTabsProps) {
  const otherFilters = Boolean(values.q || values.area || values.version);
  const base = { q: values.q, area: values.area, version: values.version };
  const known = types.some((t) => t.value === values.type);
  const tabs = sortChangeTypes(types, (t) => t.value);
  return (
    <nav aria-label="Tipo de mudança">
      <ul className="tabs">
        <li>
          <Link className="tab" href={listHref(base)} aria-current={!values.type || !known ? "page" : undefined}>
            Tudo
            {allCount !== undefined && !otherFilters ? <span className="tab__count">{allCount}</span> : null}
          </Link>
        </li>
        {tabs.map((t) => {
          const tone = changeTypeTone(t.value);
          const dot = tone === "critical" ? "critical" : tone === "warning" ? "warning" : null;
          return (
            <li key={t.value}>
              <Link
                className="tab"
                href={listHref({ ...base, type: t.value })}
                aria-current={values.type === t.value ? "page" : undefined}
              >
                {dot ? <span className={`tab__dot tab__dot--${dot}`} aria-hidden="true" /> : null}
                {changeTypeShortLabel(t.value)}
                {!otherFilters ? <span className="tab__count">{t.n}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
