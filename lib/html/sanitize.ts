// Sanitizer do HTML do feed para renderização na web.
import sanitizeHtml, { type IOptions, type Tag } from "sanitize-html";

const DEFAULT_BASE = "https://shopify.dev";
const REL = "noopener noreferrer nofollow";
const YT_HOSTS = new Set(["youtube.com", "youtube-nocookie.com"]);

function resolve(raw: string | undefined, base: string): URL | null {
  if (!raw) return null;
  try {
    return new URL(raw.trim(), base);
  } catch {
    return null;
  }
}

function youtubeId(src: string | undefined, base: string): string | null {
  const u = resolve(src, base);
  if (!u || (u.protocol !== "https:" && u.protocol !== "http:")) return null;
  if (!YT_HOSTS.has(u.hostname.toLowerCase().replace(/^www\./, ""))) return null;
  return /^\/embed\/([\w-]{6,20})$/.exec(u.pathname)?.[1] ?? null;
}

function buildOptions(base: string): IOptions {
  return {
    allowedTags: [
      "p", "a", "code", "pre", "ul", "ol", "li", "strong", "em", "h2", "h3", "h4",
      "blockquote", "img", "br", "aside", "ins", "hr",
    ],
    allowedAttributes: {
      a: ["href", "rel", "target", "class"],
      img: ["src", "alt", "width", "height", "loading", "referrerpolicy"],
      code: ["class"],
    },
    allowedClasses: { a: ["video-link"], code: ["language-*"] },
    allowedSchemes: ["https", "mailto"],
    allowedSchemesByTag: { img: ["https"] },
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    transformTags: {
      h1: "h2",
      h5: "h4",
      h6: "h4",
      b: "strong",
      i: "em",
      a: (_tag, attribs): Tag => {
        const u = resolve(attribs.href, base);
        if (!u || (u.protocol !== "https:" && u.protocol !== "mailto:")) {
          return { tagName: "span", attribs: {} }; // não permitido: mantém só o texto
        }
        return { tagName: "a", attribs: { href: u.href, rel: REL, target: "_blank" } };
      },
      img: (_tag, attribs): Tag => {
        const u = resolve(attribs.src, base);
        const out: Record<string, string> = { loading: "lazy", referrerpolicy: "no-referrer" };
        if (u && u.protocol === "https:") out.src = u.href;
        if (attribs.alt) out.alt = attribs.alt;
        if (/^\d{1,5}$/.test(attribs.width ?? "")) out.width = attribs.width;
        if (/^\d{1,5}$/.test(attribs.height ?? "")) out.height = attribs.height;
        return { tagName: "img", attribs: out };
      },
      iframe: (_tag, attribs): Tag => {
        const id = youtubeId(attribs.src, base);
        if (!id) return { tagName: "iframe", attribs: {} }; // tag não permitida -> descartada
        return {
          tagName: "a",
          attribs: {
            href: `https://www.youtube.com/watch?v=${id}`,
            class: "video-link",
            rel: REL,
            target: "_blank",
          },
          text: "▶ Assistir vídeo",
        };
      },
    },
    exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs.src,
  };
}

/**
 * @param html HTML bruto do feed
 * @param baseUrl base para resolver links relativos (padrão https://shopify.dev)
 */
export function sanitizeForWeb(html: string, baseUrl: string = DEFAULT_BASE): string {
  if (!html || !html.trim()) return "";
  return sanitizeHtml(html, buildOptions(baseUrl)).trim();
}
