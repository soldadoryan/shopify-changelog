const BOT_RE =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|discord|whatsapp|telegram|slack|headless|lighthouse|curl|wget|python|node-fetch|undici|axios|go-http|java\/|okhttp|libwww|httpclient|vercel-screenshot|pingdom|uptime|monitor|embedly/i;

/** UA vazio ou de robô/preview/ferramenta de linha de comando. */
export function isBotUserAgent(ua: string | null | undefined): boolean {
  const value = (ua ?? "").trim();
  return value === "" || BOT_RE.test(value);
}

function major(version: string | undefined): string {
  return version ? version.split(".")[0] : "";
}

/** "Chrome 142 · Windows"; partes desconhecidas são omitidas; nada reconhecido vira "desconhecido". */
export function describeUserAgent(ua: string | null | undefined): string {
  const s = ua ?? "";
  const rules: Array<[RegExp, string]> = [
    [/Edg(?:e|A|iOS)?\/([\d.]+)/, "Edge"],
    [/OPR\/([\d.]+)/, "Opera"],
    [/Firefox\/([\d.]+)/, "Firefox"],
    [/FxiOS\/([\d.]+)/, "Firefox"],
    [/(?:Chrome|CriOS)\/([\d.]+)/, "Chrome"],
    [/Version\/([\d.]+).*Safari\//, "Safari"],
  ];
  let browser = "";
  for (const [re, name] of rules) {
    const m = re.exec(s);
    if (m) {
      browser = `${name} ${major(m[1])}`.trim();
      break;
    }
  }

  let os = "";
  if (/Windows/i.test(s)) os = "Windows";
  else if (/Android/i.test(s)) os = "Android";
  else if (/iPhone|iPad|iPod/i.test(s)) os = "iOS";
  else if (/Mac OS X|Macintosh/i.test(s)) os = "macOS";
  else if (/CrOS/i.test(s)) os = "ChromeOS";
  else if (/Linux/i.test(s)) os = "Linux";

  return [browser, os].filter(Boolean).join(" · ") || "desconhecido";
}
