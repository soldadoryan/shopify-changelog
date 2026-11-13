import { describe, expect, it } from "vitest";
import { htmlToDiscordMarkdown, htmlToPlainText } from "../lib/html/to-discord";

const md = htmlToDiscordMarkdown;

describe("htmlToDiscordMarkdown", () => {
  it("returns empty string for empty input", () => {
    expect(md("")).toBe("");
    expect(md('<div class=""></div>')).toBe("");
    expect(md("  \n ")).toBe("");
  });

  it("converts paragraphs, strong and em", () => {
    expect(md('<div class=""><p>Oi <strong>mundo</strong> e <em>você</em></p><p>Dois</p></div>')).toBe(
      "Oi **mundo** e *você*\n\nDois",
    );
  });

  it("turns headings into bold lines", () => {
    const out = md("<h1>Um</h1><p>t</p><h2>Dois</h2><h3>Três <code>x</code></h3><h4>Quatro</h4>");
    expect(out).toBe("**Um**\n\nt\n\n**Dois**\n\n**Três `x`**\n\n**Quatro**");
    expect(out).not.toMatch(/^#/m);
  });

  it("keeps nested lists with - and numbered lists", () => {
    const out = md(
      "<ul><li>a<ul><li>b</li><li>c</li></ul></li><li>d</li></ul><ol><li>um</li><li>dois<ol><li>x</li></ol></li></ol>",
    );
    expect(out).toBe("- a\n  - b\n  - c\n- d\n\n1. um\n2. dois\n   1. x");
  });

  it("respects ol start", () => {
    expect(md('<ol start="3"><li>a</li><li>b</li></ol>')).toBe("3. a\n4. b");
  });

  it("keeps the language on fenced code blocks and decodes entities", () => {
    const out = md('<pre><code class="language-html">&lt;s-metrics-bar&gt;\n  &lt;/s-metrics-bar&gt;\n</code></pre>');
    expect(out).toBe("```html\n<s-metrics-bar>\n  </s-metrics-bar>\n```");
  });

  it("handles code blocks without language and pre without code", () => {
    expect(md("<pre><code>a\nb</code></pre>")).toBe("```\na\nb\n```");
    expect(md("<pre>x\ny</pre>")).toBe("```\nx\ny\n```");
  });

  it("uses a longer fence when the code contains fences", () => {
    const out = md('<pre><code class="language-md">```js\nx\n```</code></pre>');
    expect(out.startsWith("````md\n")).toBe(true);
    expect(out.endsWith("\n````")).toBe(true);
  });

  it("does not collapse blank lines inside code blocks", () => {
    expect(md("<pre><code>a\n\n\n\nb</code></pre>")).toBe("```\na\n\n\n\nb\n```");
  });

  it("renders inline code with literal tags", () => {
    expect(md("<p>use <code>&lt;s-metrics-bar&gt;</code> aqui</p>")).toBe("use `<s-metrics-bar>` aqui");
  });

  it("escapes markdown in plain text", () => {
    const out = md("<p>snake_case_name e *estrela* e ~~x~~ e ||spoiler|| e # nao</p>");
    expect(out).toContain("snake\\_case\\_name");
    expect(out).toContain("\\*estrela\\*");
    expect(out).toContain("\\~\\~x\\~\\~");
    expect(out).toContain("\\|\\|spoiler\\|\\|");
  });

  it("does not leave raw html for plain-text angle brackets", () => {
    expect(md("<p>&lt;div&gt; é uma tag</p>")).toBe("<div> é uma tag");
  });

  it("resolves relative links against shopify.dev", () => {
    expect(md('<p><a href="/docs/api/admin" target="_blank" class="body-link">docs</a></p>')).toBe(
      "[docs](https://shopify.dev/docs/api/admin)",
    );
  });

  it("keeps absolute links and encodes parentheses", () => {
    expect(md('<a href="https://en.wikipedia.org/wiki/A_(b)">w</a>')).toBe(
      "[w](https://en.wikipedia.org/wiki/A_%28b%29)",
    );
  });

  it("drops javascript: and data: links but keeps their text", () => {
    expect(md('<p><a href="javascript:alert(1)">clique</a> e <a href="data:text/html,x">d</a></p>')).toBe("clique e d");
    expect(md('<a href="  JaVaScRiPt:alert(1)">x</a>')).toBe("x");
  });

  it("shows mailto links as text", () => {
    expect(md('<a href="mailto:a@b.com">contato</a>')).toBe("contato");
  });

  it("converts images and iframes to links", () => {
    expect(md('<p>veja <img src="/cdn/a.png" alt="x"></p>')).toBe("veja [🖼 imagem](https://shopify.dev/cdn/a.png)");
    expect(md('<iframe width="560" src="https://www.youtube.com/embed/HmBjTMJ3GrA?si=abc"></iframe>')).toBe(
      "[▶ vídeo](https://www.youtube.com/watch?v=HmBjTMJ3GrA)",
    );
    expect(md('<iframe src="//www.youtube.com/embed/HmBjTMJ3GrA"></iframe>')).toContain("watch?v=HmBjTMJ3GrA");
    expect(md('<iframe src="javascript:alert(1)"></iframe>')).toBe("");
  });

  it("does not nest an image link inside a link", () => {
    expect(md('<a href="/x"><img src="/a.png"></a>')).toBe("[🖼 imagem](https://shopify.dev/a.png)");
  });

  it("turns aside and blockquote into quotes", () => {
    const out = md('<aside class="note"><p>Atenção</p></aside><blockquote><p>cita</p></blockquote>');
    expect(out).toBe("> Atenção\n\n> cita");
  });

  it("keeps ins text and drops script/style", () => {
    expect(md("<p>a <ins>novo</ins><script>alert(1)</script><style>p{}</style></p>")).toBe("a novo");
  });

  it("collapses runs of blank lines produced by <br/>", () => {
    expect(md("<p>a</p>\n<br/><h2>T</h2>\n<br/><p>b</p>")).not.toMatch(/\n{3,}/);
  });

  it("neutralizes @everyone, @here and <@...> mentions", () => {
    const out = md("<p>@everyone @here <@123456> <@&99> <#555> e user@everyone.com</p>");
    expect(out).not.toContain("@everyone");
    expect(out).not.toContain("@here");
    expect(out).not.toContain("<@");
    expect(out).not.toContain("<#");
    expect(out).toContain("@​everyone");
    expect(out).toContain("<​@123456>");
  });

  it("neutralizes mentions even inside code spans and blocks", () => {
    const out = md("<pre><code>@everyone</code></pre><p><code>@here</code></p>");
    expect(out).not.toContain("@everyone");
    expect(out).not.toContain("@here");
  });

  it("keeps example emails in code intact", () => {
    expect(md("<pre><code>to: merchant@example.com</code></pre>")).toBe("```\nto: merchant@example.com\n```");
  });

  it("converts a rich sample (analytics changelog) end to end", () => {
    const html = `<div class=""><p>Intro com <code>campaign_source</code>.</p>
<br/><h2>Embed it</h2>
<ul>
<li>For developers: Build against a stable surface.</li>
<li>For LLMs: <strong>docs</strong>.</li>
</ul>
<pre><code class="language-html">&lt;s-shopifyql-metric-card
  heading=&quot;My weekly sales&quot;&gt;
&lt;/s-shopifyql-metric-card&gt;
</code></pre>
<p>Load <code>analytics-ui.js</code> (after <code>polaris.js</code>).</p></div>`;
    expect(md(html)).toBe(
      [
        "Intro com `campaign_source`.",
        "",
        "**Embed it**",
        "",
        "- For developers: Build against a stable surface.",
        "- For LLMs: **docs**.",
        "",
        "```html",
        "<s-shopifyql-metric-card",
        '  heading="My weekly sales">',
        "</s-shopifyql-metric-card>",
        "```",
        "",
        "Load `analytics-ui.js` (after `polaris.js`).",
      ].join("\n"),
    );
  });

  it("leaves no raw HTML tags outside code", () => {
    const out = md('<div class=""><p>x <span>y</span> <font color="red">z</font></p><table><tr><td>c</td></tr></table></div>');
    expect(out).not.toMatch(/<\/?(div|p|span|font|table|tr|td)\b/);
  });
});

describe("htmlToPlainText", () => {
  it("strips tags, decodes entities and normalizes whitespace", () => {
    expect(
      htmlToPlainText('<div class=""><p>A &amp; B</p><p>use &lt;s-bar&gt;</p><ul><li>x</li><li>y</li></ul></div>'),
    ).toBe("A & B\nuse <s-bar>\nx\ny");
  });
  it("drops script and style content", () => {
    expect(htmlToPlainText("<p>a</p><script>alert(1)</script><style>p{}</style>")).toBe("a");
  });
  it("returns empty for empty wrapper", () => {
    expect(htmlToPlainText('<div class=""></div>')).toBe("");
  });
});
