import { describe, expect, it } from "vitest";
import { sanitizeForWeb } from "../lib/html/sanitize";

describe("sanitizeForWeb", () => {
  it("returns empty string for empty input and the empty wrapper", () => {
    expect(sanitizeForWeb("")).toBe("");
    expect(sanitizeForWeb('<div class=""></div>')).toBe("");
  });

  it("keeps allowlisted structure and drops the wrapper div", () => {
    const out = sanitizeForWeb(
      '<div class=""><p>Oi <strong>mundo</strong> <em>x</em></p><ul><li>a<ul><li>b</li></ul></li></ul></div>',
    );
    expect(out).toBe("<p>Oi <strong>mundo</strong> <em>x</em></p><ul><li>a<ul><li>b</li></ul></li></ul>");
  });

  it("maps h1 to h2 and keeps h2-h4", () => {
    expect(sanitizeForWeb("<h1>A</h1><h3>B</h3>")).toBe("<h2>A</h2><h3>B</h3>");
  });

  it("keeps code language class and renders entities as literal text, not tags", () => {
    const html = '<pre><code class="language-html">&lt;s-metrics-bar&gt;\n&lt;/s-metrics-bar&gt;</code></pre>';
    const out = sanitizeForWeb(html);
    expect(out).toContain('class="language-html"');
    expect(out).toContain("&lt;s-metrics-bar&gt;");
    expect(out).not.toContain("<s-metrics-bar");
  });

  it("drops non-language classes", () => {
    expect(sanitizeForWeb('<code class="evil foo">x</code>')).toBe("<code>x</code>");
  });

  it("resolves relative hrefs and adds rel/target to links", () => {
    const out = sanitizeForWeb('<a href="/docs/api" target="_self" class="body-link" rel="x">Docs</a>');
    expect(out).toContain('href="https://shopify.dev/docs/api"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).toContain('target="_blank"');
    expect(out).not.toContain("body-link");
    expect(out).not.toContain("_self");
  });

  it("resolves fragments against the supplied base", () => {
    const out = sanitizeForWeb('<a href="#x">y</a>', "https://shopify.dev/changelog/foo");
    expect(out).toContain('href="https://shopify.dev/changelog/foo#x"');
  });

  it("supports mailto links", () => {
    expect(sanitizeForWeb('<a href="mailto:a@b.com">m</a>')).toContain('href="mailto:a@b.com"');
  });

  it("img gets lazy loading, no-referrer, absolute src", () => {
    const out = sanitizeForWeb('<img src="/cdn/a.png" alt="A" width="10" height="x" srcset="evil">');
    expect(out).toContain('src="https://shopify.dev/cdn/a.png"');
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('referrerpolicy="no-referrer"');
    expect(out).toContain('alt="A"');
    expect(out).toContain('width="10"');
    expect(out).not.toContain("height");
    expect(out).not.toContain("srcset");
  });

  it("removes images without a safe src", () => {
    expect(sanitizeForWeb('<img src="http://x.test/a.png">')).toBe("");
    expect(sanitizeForWeb('<img src="data:image/png;base64,AAAA">')).toBe("");
    expect(sanitizeForWeb('<img src="javascript:alert(1)">')).toBe("");
  });

  it("turns YouTube iframes into a video link", () => {
    const out = sanitizeForWeb(
      '<iframe width="560" src="https://www.youtube.com/embed/HmBjTMJ3GrA?si=abc" allowfullscreen></iframe>',
    );
    expect(out).toContain('href="https://www.youtube.com/watch?v=HmBjTMJ3GrA"');
    expect(out).toContain('class="video-link"');
    expect(out).toContain("▶ Assistir vídeo");
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).not.toContain("<iframe");
  });

  it("accepts youtube-nocookie and protocol-relative embeds", () => {
    expect(sanitizeForWeb('<iframe src="//www.youtube-nocookie.com/embed/abcdefghijk"></iframe>')).toContain(
      "watch?v=abcdefghijk",
    );
  });

  it("drops non-YouTube iframes", () => {
    for (const src of [
      "https://evil.example/embed/abcdefghijk",
      "https://youtube.com.evil.example/embed/abcdefghijk",
      "javascript:alert(1)",
      "https://www.youtube.com/watch?v=abcdefghijk",
    ]) {
      const out = sanitizeForWeb(`<p>a</p><iframe src="${src}"></iframe><p>b</p>`);
      expect(out).toBe("<p>a</p><p>b</p>");
    }
  });

  it("keeps aside, ins, blockquote, hr, br", () => {
    const out = sanitizeForWeb('<aside class="note"><p>n</p></aside><ins>i</ins><blockquote>q</blockquote><hr><br/>');
    expect(out).toContain("<aside><p>n</p></aside>");
    expect(out).toContain("<ins>i</ins>");
    expect(out).toContain("<blockquote>q</blockquote>");
    expect(out).toContain("<hr />");
  });
});

describe("sanitizeForWeb XSS vectors", () => {
  const dangerous = [/<script/i, /onerror/i, /onload/i, /onclick/i, /javascript:/i, /<svg/i, /<style/i, /<iframe/i, /srcdoc/i];
  const vectors: Record<string, string> = {
    script: "<p>a</p><script>alert(1)</script>",
    imgOnerror: "<img src=x onerror=alert(1)>",
    imgOnerrorQuoted: '<img src="https://x.test/a.png" onerror="alert(1)">',
    jsHref: '<a href="javascript:alert(1)">click</a>',
    jsHrefCase: '<a href="JaVaScRiPt:alert(1)">click</a>',
    jsHrefTab: '<a href="java\tscript:alert(1)">click</a>',
    jsHrefEntity: '<a href="&#106;avascript:alert(1)">click</a>',
    jsHrefEntityColon: '<a href="javascript&colon;alert(1)">click</a>',
    jsHrefEntityHex: '<a href="&#x6A;&#x61;vascript:alert(1)">click</a>',
    jsHrefSpace: '<a href="  javascript:alert(1)">click</a>',
    dataHref: '<a href="data:text/html,<script>alert(1)</script>">x</a>',
    vbs: '<a href="vbscript:msgbox(1)">x</a>',
    svg: "<svg onload=alert(1)><circle/></svg>",
    svgInP: "<p><svg/onload=alert(1)></p>",
    iframeEvil: '<iframe src="https://evil.example"></iframe>',
    iframeSrcdoc: '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    style: "<style>body{display:none}</style><p>x</p>",
    styleAttr: '<p style="background:url(javascript:alert(1))">x</p>',
    onclick: '<p onclick="alert(1)">x</p>',
    nested: "<scr<script>ipt>alert(1)</scr</script>ipt>",
    mathml: '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
    form: '<form action="javascript:alert(1)"><input name=x></form>',
    meta: '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
    object: '<object data="javascript:alert(1)"></object><embed src="javascript:alert(1)">',
    imgJsSrc: '<img src="javascript:alert(1)">',
    comment: "<!--<img src=x onerror=alert(1)>-->",
  };

  for (const [name, html] of Object.entries(vectors)) {
    it(`neutralizes ${name}`, () => {
      const out = sanitizeForWeb(html);
      for (const re of dangerous) expect(out).not.toMatch(re);
      expect(out).not.toMatch(/<(script|style|svg|math|form|input|object|embed|meta)\b/i);
    });
  }

  it("escapes angle brackets that come from text entities", () => {
    expect(sanitizeForWeb("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>")).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
    );
  });

  it("keeps the surrounding text of removed links", () => {
    expect(sanitizeForWeb('<p>ver <a href="javascript:x()">aqui</a> já</p>')).toBe("<p>ver aqui já</p>");
  });

  it("does not let attribute values break out of quotes", () => {
    const out = sanitizeForWeb('<a href="https://x.test/&quot; onmouseover=&quot;alert(1)">x</a>');
    expect(out).not.toMatch(/\sonmouseover=/i);
  });
});
