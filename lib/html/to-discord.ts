// HTML do changelog -> markdown do Discord e texto puro.
import sanitizeHtml from "sanitize-html";
import TurndownService from "turndown";

const SITE = "https://shopify.dev";
const ZWSP = "​";

function encodeParens(url: string): string {
  return url.replace(/\(/g, "%28").replace(/\)/g, "%29");
}

/** Resolve contra shopify.dev; só aceita http(s). */
function resolveHttpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim(), SITE);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.href;
  } catch {
    return null;
  }
}

function youtubeWatchUrl(src: string): string | null {
  const url = resolveHttpUrl(src);
  if (!url) return null;
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, "");
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const m = /^\/embed\/([\w-]{6,20})/.exec(u.pathname);
    if (m) return `https://www.youtube.com/watch?v=${m[1]}`;
  }
  return url;
}

function createService(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
    strongDelimiter: "**",
    linkStyle: "inlined",
  });

  const baseEscape = td.escape.bind(td);
  td.escape = (s: string) => baseEscape(s).replace(/\|\|/g, "\\|\\|").replace(/~~/g, "\\~\\~");

  td.remove(["script", "style", "noscript", "template"]);

  td.addRule("heading", {
    filter: ["h1", "h2", "h3", "h4", "h5", "h6"],
    replacement: (content) => {
      const text = content.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
      return text ? `\n\n**${text}**\n\n` : "";
    },
  });

  td.addRule("br", { filter: "br", replacement: () => "\n" });
  td.addRule("hr", { filter: "hr", replacement: () => "\n\n──────────\n\n" });

  td.addRule("quote", {
    filter: ["blockquote", "aside"],
    replacement: (content) => {
      const body = content.replace(/^\n+|\n+$/g, "");
      if (!body) return "";
      return `\n\n${body.replace(/^/gm, "> ")}\n\n`;
    },
  });

  td.addRule("listItem", {
    filter: "li",
    replacement: (content, node) => {
      const parent = node.parentNode as HTMLElement | null;
      let prefix = "- ";
      if (parent && parent.nodeName === "OL") {
        const start = parent.getAttribute("start");
        const index = Array.prototype.indexOf.call(parent.children, node);
        const n = start && /^-?\d+$/.test(start) ? Number(start) + index : index + 1;
        prefix = `${n}. `;
      }
      const indent = " ".repeat(prefix.length);
      const body = content
        .replace(/^\n+/, "")
        .replace(/\n+$/, "\n")
        .replace(/\n(?=[^\n])/g, `\n${indent}`);
      return prefix + body + (node.nextSibling && !/\n$/.test(body) ? "\n" : "");
    },
  });

  td.addRule("pre", {
    filter: "pre",
    replacement: (_content, node) => {
      const el = node as HTMLElement;
      const code = el.querySelector("code");
      const cls = code?.getAttribute("class") || el.getAttribute("class") || "";
      const lang = /language-([\w+#.-]+)/.exec(cls)?.[1] ?? "";
      const text = ((code ?? el).textContent ?? "")
        .replace(/\r\n?/g, "\n")
        .replace(/^\n/, "")
        .replace(/\s+$/, "");
      if (!text.trim()) return "";
      const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
      const fence = "`".repeat(Math.max(3, longest + 1));
      return `\n\n${fence}${lang}\n${text}\n${fence}\n\n`;
    },
  });

  td.addRule("link", {
    filter: "a",
    replacement: (content, node) => {
      const href = (node as HTMLElement).getAttribute("href")?.trim();
      const text = content.replace(/\s+/g, " ").trim();
      if (!href) return content;
      if (/^mailto:/i.test(href)) return text || href.replace(/^mailto:/i, "");
      const url = resolveHttpUrl(href);
      if (!url) return content; // javascript:, data:, etc.
      if (!text) return url;
      if (text.includes("](")) return content; // evita links aninhados
      return `[${text}](${encodeParens(url)})`;
    },
  });

  td.addRule("img", {
    filter: "img",
    replacement: (_c, node) => {
      const url = resolveHttpUrl((node as HTMLElement).getAttribute("src"));
      return url ? `[🖼 imagem](${encodeParens(url)})` : "";
    },
  });

  td.addRule("iframe", {
    filter: "iframe",
    replacement: (_c, node) => {
      const url = youtubeWatchUrl((node as HTMLElement).getAttribute("src") ?? "");
      return url ? `\n\n[▶ vídeo](${encodeParens(url)})\n\n` : "";
    },
  });

  return td;
}

const service = createService();

/** Neutraliza menções do Discord (defesa em profundidade; allowed_mentions também é vazio). */
function neutralizeMentions(text: string): string {
  return text
    .replace(/@(?=(?:everyone|here)\b)/gi, `@${ZWSP}`)
    .replace(/<(?=[@#])/g, `<${ZWSP}`);
}

const FENCED_BLOCK = /^[ >]*(`{3,})[^\n]*\n[\s\S]*?\n[ >]*\1[ \t]*$/gm;

/** Colapsa linhas em branco e espaços finais, sem tocar nos blocos de código. */
function tidy(md: string): string {
  const blocks: string[] = [];
  const masked = md.replace(FENCED_BLOCK, (m) => {
    blocks.push(m);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  const cleaned = masked
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => blocks[Number(i)]);
}

export function htmlToDiscordMarkdown(html: string): string {
  if (!html || !html.trim()) return "";
  const md = service.turndown(html);
  return neutralizeMentions(tidy(md));
}

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Texto puro (busca/trechos): sem tags, entidades decodificadas, espaços normalizados. */
export function htmlToPlainText(html: string): string {
  if (!html) return "";
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|pre|blockquote|aside|tr|ul|ol)>/gi, "\n");
  const stripped = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} });
  return decodeBasicEntities(stripped)
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
