import Icon from "./Icon";

export type BadgeTone = "critical" | "critical-soft" | "warning" | "success" | "info" | "neutral";

type BadgeProps = {
  tone?: BadgeTone;
  children: React.ReactNode;
};

export function Badge({ tone = "neutral", children }: BadgeProps) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

type ChangeTypeInfo = { tone: BadgeTone; label: string; short: string; critical: boolean };

const CHANGE_TYPES: Record<string, ChangeTypeInfo> = {
  "action required": { tone: "critical", label: "Ação necessária", short: "Ação necessária", critical: true },
  "breaking api change": { tone: "critical", label: "Breaking change", short: "Breaking", critical: true },
  "deprecation announcement": { tone: "warning", label: "Depreciação", short: "Depreciação", critical: false },
  new: { tone: "success", label: "Novo", short: "Novo", critical: false },
  update: { tone: "info", label: "Atualização", short: "Atualização", critical: false },
  platform: { tone: "neutral", label: "Plataforma", short: "Plataforma", critical: false },
};

const TYPE_ORDER = Object.keys(CHANGE_TYPES);

function info(type: string): ChangeTypeInfo | undefined {
  return CHANGE_TYPES[type.toLowerCase()];
}

export function changeTypeTone(type: string): BadgeTone {
  return info(type)?.tone ?? "neutral";
}

export function changeTypeLabel(type: string): string {
  return info(type)?.label ?? type;
}

export function changeTypeShortLabel(type: string): string {
  return info(type)?.short ?? type;
}

export function isCriticalType(type: string): boolean {
  return info(type)?.critical ?? false;
}

export function sortChangeTypes<T>(items: T[], key: (item: T) => string): T[] {
  const rank = (t: string) => {
    const i = TYPE_ORDER.indexOf(t.toLowerCase());
    return i === -1 ? TYPE_ORDER.length : i;
  };
  return [...items].sort((a, b) => rank(key(a)) - rank(key(b)));
}

export function ChangeTypeBadge({ type }: { type: string }) {
  return (
    <Badge tone={changeTypeTone(type)}>
      {isCriticalType(type) ? <Icon name="alert" /> : null}
      {changeTypeLabel(type)}
    </Badge>
  );
}

export function ChangeTypeBadges({ types }: { types: string[] }) {
  if (types.length === 0) return null;
  return (
    <ul className="badge-list" aria-label="Tipo de mudança">
      {sortChangeTypes(types, (t) => t).map((t) => (
        <li key={t}>
          <ChangeTypeBadge type={t} />
        </li>
      ))}
    </ul>
  );
}

export default Badge;
