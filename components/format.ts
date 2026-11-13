const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const longDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const monthYearFormatter = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const shortMonthFormatter = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" });

function parse(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(iso: string): string {
  const date = parse(iso);
  return date ? dateFormatter.format(date) : iso;
}

export function formatLongDate(iso: string): string {
  const date = parse(iso);
  return date ? longDateFormatter.format(date) : iso;
}

export function dayParts(iso: string): { day: string; month: string } | null {
  const date = parse(iso);
  if (!date) return null;
  return {
    day: String(date.getUTCDate()),
    month: shortMonthFormatter.format(date).replace(".", ""),
  };
}

export function monthOf(iso: string): { key: string; label: string } {
  const date = parse(iso);
  if (!date) return { key: "?", label: "Sem data" };
  const label = monthYearFormatter.format(date);
  return {
    key: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
    label: label.charAt(0).toUpperCase() + label.slice(1),
  };
}

export function sameUtcDay(a: string, b: string): boolean {
  return a.slice(0, 10) === b.slice(0, 10);
}
