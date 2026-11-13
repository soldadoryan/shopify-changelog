export type ListParams = {
  q?: string;
  type?: string;
  area?: string;
  version?: string;
  page?: number;
};

const KEYS = ["q", "type", "area", "version"] as const;

export function listHref(params: ListParams, basePath = "/"): string {
  const sp = new URLSearchParams();
  for (const key of KEYS) {
    const value = params[key];
    if (value) sp.set(key, value);
  }
  if (params.page && params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
