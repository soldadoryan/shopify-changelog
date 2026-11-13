// Aviso de deploy no Discord (npm postbuild). Só roda na Vercel; nunca falha o build.

const env = process.env;

function clip(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function clean(text, max) {
  const cleaned = String(text ?? "")
    .replace(/[\u0000-\u001f\u007f`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/@(?=everyone|here)/gi, "@​")
    .replace(/<(?=[@#])/g, "<​");
  return clip(cleaned, max);
}

async function main() {
  if (env.VERCEL !== "1") return;
  if ((env.ACTIVITY_NOTICES ?? "").trim() === "0") return;

  const dryRun = (env.DISCORD_DRY_RUN ?? "").trim() === "1";
  const webhook = (env.DISCORD_WEBHOOK_URL ?? "").trim();
  if (!dryRun && webhook === "") return;

  const vercelEnv = env.VERCEL_ENV || "desconhecido";
  const sha = (env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7);
  const message = clean((env.VERCEL_GIT_COMMIT_MESSAGE ?? "").split("\n")[0], 200);
  const commit = [sha && `\`${sha}\``, message].filter(Boolean).join(" ") || "desconhecido";

  const urls = [];
  if (env.VERCEL_URL) urls.push(`https://${clean(env.VERCEL_URL, 200)}`);
  if (vercelEnv === "production" && env.VERCEL_PROJECT_PRODUCTION_URL) {
    urls.push(`https://${clean(env.VERCEL_PROJECT_PRODUCTION_URL, 200)}`);
  }

  const payload = {
    username: "Changelog Shopify Dev",
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: "🚀 Novo deploy",
        color: 0x8051ff,
        fields: [
          { name: "Ambiente", value: clean(vercelEnv, 100), inline: true },
          { name: "Branch", value: clean(env.VERCEL_GIT_COMMIT_REF || "desconhecida", 200), inline: true },
          { name: "Commit", value: clip(commit, 1000), inline: false },
          { name: "URL", value: urls.join("\n") || "desconhecida", inline: false },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: "Changelog Shopify Dev · deploy" },
      },
    ],
  };

  if (dryRun) {
    console.log(`[deploy-notice] dry run, não enviado: ${JSON.stringify(payload)}`);
    return;
  }

  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) console.log(`[deploy-notice] Discord respondeu ${res.status}; aviso descartado`);
}

try {
  await main();
} catch {
  console.log("[deploy-notice] aviso descartado");
}
process.exit(0);
