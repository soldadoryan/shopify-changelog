# Shopify Changelog (não oficial)

Sincroniza o feed `https://shopify.dev/changelog/feed.xml`, guarda os itens no Supabase, posta cada item novo em um webhook do Discord (com resumo opcional em pt-BR gerado pelo Claude) e publica um site no estilo Polaris com busca e filtros. Projeto não afiliado à Shopify.

## Arquitetura

- **Next.js 16 + TypeScript** na Vercel: páginas `/` (lista) e `/changelog/[slug]` (detalhe), mais a rota `GET /api/cron/sync`.
- **Supabase (Postgres)**: tabelas `changelog_items` e `sync_state` (lock, `last_success_at`, `last_error`). Só o servidor acessa, via service role; RLS ligado e sem policies.
- **Sync** (`lib/sync/run.ts`): busca o feed, compara com o banco, insere/atualiza, reclama itens `pending` e posta no Discord. Autenticado por `Authorization: Bearer <CRON_SECRET>`.
- **Gatilhos**: `pg_cron` do Supabase a cada 15 min (principal) e Vercel Cron diário às 12:00 UTC (backup, `vercel.json`).

## Requisitos

- Node.js 20+ e npm
- Conta Supabase, Vercel e um servidor Discord onde você possa criar webhooks
- (Opcional) chave da API da Anthropic para o resumo em pt-BR

## Desenvolvimento local

```bash
npm install
cp .env.example .env.local   # preencha os valores (veja abaixo)
npm run dev                  # http://localhost:3000
```

Para rodar o sync local: `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/sync`.

## Variáveis de ambiente

Nunca commite valores reais; `.env*` está no `.gitignore` (exceto `.env.example`). Na Vercel, defina em Production.

| Variável | Obrigatória | Descrição |
|---|---|---|
| `SUPABASE_URL` | sim | URL do projeto (Settings > API) |
| `SUPABASE_SERVICE_ROLE_KEY` | sim | Service role key (Settings > API). Somente servidor, nunca `NEXT_PUBLIC_*` |
| `CRON_SECRET` | sim | Bearer da rota de sync, mínimo 32 caracteres |
| `DISCORD_WEBHOOK_URL` | sim | URL do webhook do canal |
| `DISCORD_ALERT_ROLE_ID` | não | ID numérico do cargo mencionado em itens Action Required / Breaking API Change |
| `ANTHROPIC_API_KEY` | não | Liga o resumo em pt-BR; sem ela posta sem resumo |
| `ANTHROPIC_MODEL` | não | Modelo do resumo (padrão `claude-haiku-5-5`) |
| `FEED_URL` | não | Feed RSS (padrão `https://shopify.dev/changelog/feed.xml`) |
| `MAX_POSTS_PER_RUN` | não | Máximo de posts por execução (padrão `5`, limitado a 1–10; valor inválido vira o padrão) |
| `DISCORD_DRY_RUN` | não | `1` = só loga o payload; não posta e não marca `sent` |
| `ACTIVITY_NOTICES` | não | `0` desliga os avisos de atividade (acesso, início local, deploy) |
| `SITE_URL` | não | URL pública do site (metadata/OG), ex.: `https://meu-app.vercel.app` |

Gerar o `CRON_SECRET`:

```bash
openssl rand -hex 32
# ou, sem openssl:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Setup do Supabase

1. Crie um projeto em supabase.com.
2. Em **SQL Editor**, cole e rode `supabase/migrations/0001_init.sql` (cria as tabelas, índices, RLS e a função de claim).
3. Copie `SUPABASE_URL` e a service role key em **Settings > API**.
4. Depois do deploy na Vercel (passo abaixo), configure o agendamento de 15 min:
   - Em **Integrations**, habilite `pg_cron` e `pg_net`.
   - Abra `supabase/cron.sql` e, **só no SQL Editor** (não salve no repo), troque os dois placeholders do bloco `DO`: `<APP_URL>` pela URL completa do endpoint (`https://meu-app.vercel.app/api/cron/sync`) e `<CRON_SECRET>` pelo mesmo valor da Vercel. Os dois valores vão para o Supabase Vault (`changelog_sync_url` e `changelog_cron_secret`) e o job `shopify-changelog-sync` roda a cada 15 min. O script é idempotente.
   - Verifique com:
     ```sql
     select * from cron.job_run_details order by start_time desc limit 10;
     select id, status_code, error_msg, created from net._http_response order by created desc limit 10;
     ```
   - O Deployment Protection da Vercel não pode bloquear o domínio de produção, senão o `pg_cron` recebe 401/403.

## Webhook do Discord

1. No servidor: **Server Settings > Integrations > Webhooks > New Webhook**.
2. Escolha o canal, copie a URL e coloque em `DISCORD_WEBHOOK_URL`.
3. (Opcional) Para marcar um cargo em itens críticos, ative o modo desenvolvedor no Discord, clique com o botão direito no cargo > Copiar ID e use em `DISCORD_ALERT_ROLE_ID`.

## Deploy na Vercel

1. Importe o repositório (Add New > Project).
2. Defina as variáveis de ambiente da tabela acima em Production.
3. Faça o deploy. O `vercel.json` já registra o cron de backup diário (`0 12 * * *` em `/api/cron/sync`); a Vercel envia o `CRON_SECRET` como Bearer automaticamente.
4. Configure o `supabase/cron.sql` (seção anterior) com a URL final.

## Primeiro run

Chame a rota uma vez:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://meu-app.vercel.app/api/cron/sync
```

Na primeira execução ocorre o **seed**: todos os itens atuais do feed (cerca de 811) são gravados como `skipped` (já vistos) e **nada é postado** no Discord. A resposta deve trazer `"seeded": true, "posted": 0`. Confira o site. A partir daí, só itens novos viram `pending` e são postados.

## Testar um post com segurança

> **Cuidado:** o job `pg_cron` de produção roda a cada 15 min. Se você reenfileirar um item no banco de **produção** (`notify_status = 'pending'`), o cron de produção o posta de verdade no Discord, não importa o que você faça localmente. Por isso o teste de payload deve usar **um projeto Supabase separado** (de teste).

1. Crie um segundo projeto Supabase só para teste, aplique `supabase/migrations/0001_init.sql` e aponte `.env.local` para ele (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`). Sem `pg_cron` nesse projeto, nada roda sozinho. Use também `DISCORD_DRY_RUN=1` em `.env.local` e `npm run dev`.
2. Rode a rota uma vez para o seed e, no SQL Editor **do projeto de teste**, marque um item como pendente:
   ```sql
   update changelog_items
      set notify_status = 'pending', notify_attempts = 0, last_error = null
    where guid = '<guid-do-item>';
   ```
3. Chame a rota com `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/sync` e veja o payload no log do `next dev`. Em dry run o item volta a `pending` e nada vai ao Discord.
4. Quando o payload estiver bom, tire `DISCORD_DRY_RUN` (ou use `0`), reinicie o dev server e chame a rota de novo: o item é postado (no canal do webhook configurado) e vira `sent`.

Se for realmente necessário testar no banco de produção, **pause o job antes** e reative depois:

```sql
select cron.unschedule('shopify-changelog-sync');
-- ... teste ...
-- depois: rode de novo o supabase/cron.sql no SQL Editor para recriar o agendamento
```

## Operação

- **Saúde**: `select * from sync_state;` mostra `last_run_at`, `last_success_at` e `last_error` (falha do feed, flood guard, webhook inválido). `last_success_at` parado há horas indica problema.
- **`notify_status` por item**:
  - `pending`: aguardando postagem
  - `sending`: reclamado por um run em andamento (se o processo morrer, é reclamado de novo após 10 min)
  - `sent`: postado (`discord_message_id` guardado quando o Discord devolve)
  - `failed`: falhou; é retentado nos próximos runs até 5 tentativas (`notify_attempts`). Com 5 tentativas fica parado; veja `last_error` do item. Prefixos de `last_error`: `payload:` (erro ao montar o post; tentativa gasta), `ambiguous:` (ver abaixo), `stale sending (attempts exhausted)` (um run morreu no meio do envio com as tentativas esgotadas)
  - `skipped`: não será postado (seed, ou flood guard quando chegam mais de 50 itens novos de uma vez)
- **Reenfileirar** um item:
  ```sql
  update changelog_items
     set notify_status = 'pending', notify_attempts = 0, last_error = null
   where guid = '<guid-do-item>';
  ```
  O próximo run (até 15 min) o posta. Com webhook inválido (401/403/404) ou ausente, os itens voltam para `pending` e a tentativa é estornada (`notify_attempts` não sobe): corrija `DISCORD_WEBHOOK_URL` e eles seguem sozinhos.
- **Envio ambíguo (`last_error` começa com `ambiguous:`)**: o POST ao Discord deu timeout ou erro de socket depois de enviado, então a mensagem **pode ter sido postada**. Para evitar duplicata, o item fica `failed` com `notify_attempts = 5` e nunca é retentado sozinho; o lote daquele run para. Para resolver:
  1. Abra o canal do Discord e procure o título do item.
  2. Se a mensagem **está lá**: marque como enviado (`update changelog_items set notify_status = 'sent', last_error = null where guid = '<guid-do-item>';`).
  3. Se **não está**: reenfileire (o próximo run o posta):
     ```sql
     update changelog_items
        set notify_status = 'pending', notify_attempts = 0, last_error = null
      where guid = '<guid-do-item>';
     ```
  Para listar os pendentes de revisão: `select guid, last_error from changelog_items where last_error like 'ambiguous:%';`. Cuidado: reenfileirar no banco de produção faz o cron postar de verdade (veja "Testar um post com segurança").
- Variáveis opcionais inválidas (`MAX_POSTS_PER_RUN` não numérica, `DISCORD_ALERT_ROLE_ID` não numérica) não derrubam o sync: viram aviso no log e usam o padrão (5 posts; sem menção a cargo); `MAX_POSTS_PER_RUN` fora de 1–10 é ajustado ao limite.
- Se o banco estiver fora, o site responde `500` com a página "Changelog indisponível no momento" e um botão para tentar de novo.
- Edições em itens já existentes atualizam o site, mas não geram novo post.
- A rota responde `401` sem Bearer correto, `502` se o feed falhar e `200` com `status: "locked"` se outro run estiver ativo.

## Avisos de atividade

Além dos itens do changelog, o mesmo webhook (`DISCORD_WEBHOOK_URL`) recebe avisos de atividade:

- **Novo acesso** (`proxy.ts`): uma visita humana a uma página (GET HTML; sem prefetch, bots, `/api`, `/_next` ou arquivos estáticos). Mostra página, país (header `x-vercel-ip-country`), navegador/SO e origem do referer. Nunca inclui IP. Dedupe por cookie `cl_seen=1` (30 min, HttpOnly, SameSite=Lax, sem identificador). Teto de 10 avisos por minuto por instância; o excedente é descartado e contado ("+N acessos não notificados" no próximo aviso).
- **Aplicação iniciada** (`instrumentation-node.ts`): só rodando localmente (`npm run dev` / `npm start`, nunca na Vercel). Envia o embed de início (ambiente, Node, versão; máquina sempre "local") e, em seguida, reenvia a última novidade do banco (maior `published_at`, só leitura, sem marcar nada, sem mencionar cargo, sem chamar a IA; usa o resumo já salvo) com a nota "Última novidade do changelog (reenvio ao iniciar)".
- **Novo deploy** (`scripts/notify-deploy.mjs`, `postbuild`): só na Vercel; nunca falha o build.

Envio sem retry, com timeout curto; em erro ou 429 o aviso é descartado com uma linha de log. Como desligar: `ACTIVITY_NOTICES=0`, deixar `DISCORD_WEBHOOK_URL` vazio, ou usar `DISCORD_DRY_RUN=1` (só loga). Os avisos dividem o limite de taxa do webhook com os posts do changelog.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | servidor de desenvolvimento |
| `npm run build` | build de produção (não exige variáveis de ambiente) |
| `npm start` | serve o build |
| `npm test` | testes (vitest) |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
