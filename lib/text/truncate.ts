// Truncamento de markdown para o Discord.
// Garante: resultado (com sufixo) <= max; nunca corta dentro de [texto](url), de um par
// substituto UTF-16 ou deixa um bloco ``` aberto.

type Range = [start: number, end: number];
type Fence = { start: number; end: number; marker: string; firstNewline: number };

const FENCE_OPEN = /^[ \t>]*(`{3,})/;
const LINK_RE = /\[(?:\\.|[^\]\\\n])*\]\([^)\s]*\)/g;

function encodeUrlForMarkdown(url: string): string {
  return url.replace(/\s/g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
}

function findFences(md: string): Fence[] {
  const fences: Fence[] = [];
  let open: { start: number; marker: string } | null = null;
  let pos = 0;
  for (const line of md.split("\n")) {
    const lineStart = pos;
    pos += line.length + 1;
    const m = FENCE_OPEN.exec(line);
    if (!open) {
      if (m) open = { start: lineStart, marker: m[1] };
    } else if (m && m[1].length >= open.marker.length && line.replace(FENCE_OPEN, "").trim() === "") {
      fences.push({
        start: open.start,
        end: lineStart + line.length,
        marker: open.marker,
        firstNewline: md.indexOf("\n", open.start),
      });
      open = null;
    }
  }
  if (open) {
    fences.push({
      start: open.start,
      end: md.length,
      marker: open.marker,
      firstNewline: md.indexOf("\n", open.start),
    });
  }
  return fences;
}

function inside(ranges: Range[], pos: number): boolean {
  for (const [s, e] of ranges) if (s < pos && pos < e) return true;
  return false;
}

function isSurrogateSplit(md: string, pos: number): boolean {
  if (pos <= 0 || pos >= md.length) return false;
  const prev = md.charCodeAt(pos - 1);
  const next = md.charCodeAt(pos);
  return prev >= 0xd800 && prev <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
}

export function truncateMarkdown(md: string, max: number, moreUrl: string): string {
  if (md.length <= max) return md;

  const suffix = `\n\n… [Ler mais](${encodeUrlForMarkdown(moreUrl)})`;
  const limit = max - suffix.length;
  if (limit <= 0) return suffix.slice(0, Math.max(0, max));

  const fences = findFences(md);
  const fenceRanges: Range[] = fences.map((f) => [f.start, f.end]);
  const linkRanges: Range[] = [];
  for (const m of md.matchAll(LINK_RE)) {
    const start = m.index ?? 0;
    if (!inside(fenceRanges, start)) linkRanges.push([start, start + m[0].length]);
  }
  const safe = (c: number) =>
    !inside(fenceRanges, c) && !inside(linkRanges, c) && !isSurrogateSplit(md, c);

  // Melhores pontos de corte fora de fences/links, varrendo de limit para trás.
  let para = -1;
  let line = -1;
  let space = -1;
  let any = -1;
  for (let c = Math.min(limit, md.length - 1); c > 0; c--) {
    if (!safe(c)) continue;
    const ch = md[c];
    if (para < 0 && ch === "\n" && md[c + 1] === "\n") para = c;
    if (line < 0 && ch === "\n") line = c;
    if (space < 0 && (ch === " " || ch === "\t")) space = c;
    if (any < 0) any = c;
    if (para >= 0 && line >= 0 && space >= 0) break;
  }

  const threshold = limit * 0.5;
  let cut = -1;
  for (const cand of [para, line, space]) {
    if (cand >= threshold) {
      cut = cand;
      break;
    }
  }
  if (cut < 0) cut = Math.max(para, line, space, any, 0);

  // Se o corte seguro perdeu muito espaço, tenta cortar dentro de um bloco de código fechando-o.
  if (cut < threshold) {
    for (const f of fences) {
      const closing = `\n${f.marker}`;
      const lim = limit - closing.length;
      if (f.firstNewline < 0 || f.start >= lim) continue;
      for (let c = Math.min(lim, f.end - 1); c > f.firstNewline; c--) {
        if (md[c] === "\n" && c < f.end) {
          if (c > cut) return `${md.slice(0, c).trimEnd()}${closing}${suffix}`;
          break;
        }
      }
    }
  }

  return `${md.slice(0, cut).trimEnd()}${suffix}`;
}
