# shopify-changelog — mapa para o Claude

<!-- meta: gerado=2026-11-13 commit=sem-git versao=2 -->
<!-- Este arquivo é lido pelo Claude antes de qualquer tarefa. Mantenha curto, exato e atual. -->

## 1. O que é

Notificador e site NÃO oficiais do changelog de desenvolvedores da Shopify. Uma rota de sync lê o RSS `https://shopify.dev/changelog/feed.xml`, grava os itens no Supabase (Postgres), posta cada item novo num webhook do Discord (com resumo opcional em pt-BR gerado pelo Claude) e um site Next.js no estilo Polaris lista/filtra/busca os itens.
Estado: app terminado (268 testes passando), pronto para deploy; a migration ainda não foi aplicada em nenhum banco. Operação e SQL de suporte: `README.md`.

## 2. Stack e comandos

| Item | Valor |
|---|---|
| Linguagem | TypeScript 6 (strict via `tsconfig.json`), Node 26 em dev (README pede 20+) |
| Framework | Next.js 16.4 (App Router) + React 19.3, CSS próprio em `app/globals.css` (tokens Polaris, sem Tailwind) |
| Banco | Supabase Postgres via `@supabase/supabase-js` (service role, só servidor); RLS ligado, sem policies |
| Feed / HTML | `fast-xml-parser`, `sanitize-html`, `turndown` (HTML -> markdown do Discord) |
| IA | `@anthropic-ai/sdk` (resumo pt-BR, opcional; modelo padrão `claude-haiku-5-5`) |
| Validação | `zod` 4 (só em `lib/env.ts`) |
| Testes | Vitest 5, ambiente `node`, `pool: "vmThreads"`, `tests/**/*.test.ts`, alias `@/` e stub de `server-only` |
| Lint | ESLint 9 (`eslint.config.mjs`, `eslint-config-next`); sem Prettier |
| Pacotes | npm (`package-lock.json`) |
| Infra | Vercel (site + rota de sync, `maxDuration = 60`), Supabase `pg_cron` + `pg_net` + Vault (gatilho de 15 min), Discord webhook |

| Ação | Comando |
|---|---|
| Instalar | `npm install` |
| Rodar em dev | `npm run dev` (http://localhost:3000) |
| Testar | `npm test` (um arquivo: `npx vitest run tests/diff.test.ts`) |
| Lint | `npm run lint` |
| Type check | `npm run typecheck` |
| Build | `npm run build` (não exige variáveis de ambiente) |
| Servir build | `npm start` |
| Migrar banco | manual: colar `supabase/migrations/0001_init.sql` no SQL Editor do Supabase (não há CLI/script) |
| Disparar sync local | `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/sync` |

## 3. Onde mexer

| Se o pedido for… | Mexa em… | Copie o padrão de… |
|---|---|---|
| nova tabela / coluna / RPC no banco | novo arquivo `supabase/migrations/000N_<nome>.sql` (idempotente) + `lib/db/mapping.ts` (`ItemRow`, `ITEM_COLUMNS`, `feedItemToRow`) + `lib/db/items.ts` + o `MemoryRepo` de `tests/run.test.ts` + `supabase/migrations/0001_init.sql` só se ainda não houver deploy (ver 7) | `supabase/migrations/0001_init.sql` |
| novo campo do item (ex.: nova derivação do feed) | `lib/types.ts` (`FeedItem`) -> `lib/feed/parse.ts` / `lib/feed/classify.ts` -> `lib/db/mapping.ts` -> migration -> `lib/db/queries.ts` se for listado | `apiVersions` (classify.ts + mapping.ts + coluna `api_versions`) |
| novo filtro / facet na home | `lib/db/queries.ts` (`ListFilters`, `clean*Param`, `fetchList`, `changelog_facets` no SQL) + `app/page.tsx` + `components/FilterBar.tsx` | filtro `version` (`cleanVersionParam` + `FilterBar` + `Pagination params`) |
| mudar tela / estilo do site | `app/page.tsx`, `app/changelog/[slug]/page.tsx`, `components/*.tsx`, `app/globals.css` (tokens em `:root`) | `components/ItemCard.tsx` |
| nova página | `app/<rota>/page.tsx` (Server Component; dados só via `lib/db/queries.ts`) | `app/changelog/[slug]/page.tsx` |
| mudar o que é renderizado do HTML do feed | `lib/html/sanitize.ts` (allowlist) + `tests/sanitize.test.ts` | casos em `tests/sanitize.test.ts` |
| mudar o post do Discord (embed, cores, campos, menção) | `lib/discord/embed.ts` (`buildDiscordPayload`) + `lib/html/to-discord.ts` + `lib/text/truncate.ts` | `tests/embed.test.ts` |
| mudar envio / tratamento de erros do Discord | `lib/discord/send.ts` (classificação do `SendResult`) + ramo correspondente em `lib/sync/run.ts` | `tests/send.test.ts` |
| mudar o prompt/modelo do resumo pt-BR | `lib/summarize.ts` (`SYSTEM_PROMPT`, limites) | `tests/summarize.test.ts` (client injetado) |
| mudar regra do sync (limites, flood guard, estados de notify) | `lib/sync/run.ts` (`DEFAULT_SYNC_CONFIG`, máquina de estados no comentário do topo) + `lib/db/items.ts` + SQL de `claim_items_for_notify` | `tests/run.test.ts` |
| mudar diff / slugs | `lib/sync/diff.ts` + `lib/feed/classify.ts` (`resolveSlugCollision`) | `tests/diff.test.ts` |
| mudar parse do feed / fetch | `lib/feed/parse.ts`, `lib/feed/fetch.ts`, erros em `lib/feed/errors.ts` | `tests/parse.test.ts` + `tests/fixtures/feed.xml` |
| nova variável de ambiente | `lib/env.ts` (acessor `getX()` com zod) + `.env.example` + tabela do `README.md` + `tests/env.test.ts` | `getMaxPostsPerRun` (opcional com padrão) / `getCronSecret` (obrigatória) |
| rota/autenticação da rota de cron | `app/api/cron/sync/route.ts` (monta os `deps` reais) + `lib/sync/auth.ts` | `tests/route.test.ts` |
| agendamento (pg_cron / Vercel Cron) | `supabase/cron.sql` (manual, com placeholders) e `vercel.json` (AINDA NÃO EXISTE, ver 7) | `supabase/cron.sql` |
| headers de segurança / CSP | `next.config.ts` | — |
| invalidar cache após escrita | `revalidateChangelog()` em `lib/db/queries.ts` | chamada em `lib/sync/run.ts` (`deps.revalidate`) |
| testes | `tests/<modulo>.test.ts` (vitest; dependências injetadas, sem rede) | `tests/run.test.ts` (sync) ou `tests/diff.test.ts` (função pura) |

## 4. Estrutura

```
app/
  layout.tsx, globals.css       — shell (Inter, Header/Footer, metadata, SITE_URL), tokens Polaris
  page.tsx                      — home: lê searchParams, listItems + getFacets, FilterBar/ItemCard/Pagination
  changelog/[slug]/page.tsx     — detalhe: getItemBySlug, resumo IA, sanitizeForWeb -> ItemBody
  error.tsx, not-found.tsx      — 500 ("Changelog indisponível") e 404
  api/cron/sync/route.ts        — GET autenticado por Bearer; injeta deps reais em runSync
  loading.tsx, changelog/[slug]/loading.tsx — skeletons
  robots.ts, sitemap.ts, manifest.ts, icon.svg, opengraph-image.tsx — SEO (sitemap lê listItems; sem env publica só a home)
components/                     — Badge, EmptyState, FilterBar (busca/área/versão; tipo vai em campo oculto), TypeTabs (abas de tipo = links GET), Footer, Header, Icon, ItemBody, ItemCard (linha da lista), JsonLd, Pagination, format.ts, href.ts (listHref)
lib/site.ts                     — siteOrigin()/absoluteUrl(): SITE_URL -> VERCEL_PROJECT_PRODUCTION_URL -> localhost
lib/
  types.ts                      — CONTRATO compartilhado: FeedItem, StoredItem, NotifyStatus, SyncResult
  env.ts                        — acessores preguiçosos de env (zod); server-only
  feed/                         — fetch (timeout 15 s), parse (RSS->FeedItem), classify (tipo/área/versão, slug, hash), text, errors
  sync/                         — run.ts (orquestração + máquina de estados), diff.ts (puro), auth.ts (Bearer em tempo constante)
  db/                           — items.ts (ItemsRepo + impl Supabase), mapping.ts (snake<->camel), queries.ts (leituras do site, cache)
  supabase/server.ts            — cliente service role singleton
  discord/                      — embed.ts (payload), send.ts (webhook, SendResult)
  html/                         — sanitize.ts (web), to-discord.ts (markdown do Discord)
  summarize.ts                  — resumo pt-BR via Anthropic (nunca lança; falha = null)
  text/truncate.ts              — truncamento seguro de markdown
public/                         — llms.txt (índice para LLMs)
supabase/
  migrations/0001_init.sql      — tabelas, índices, RLS, RPCs (acquire/release lock, claim_items_for_notify, changelog_facets)
  cron.sql                      — pg_cron + Vault, rodado À MÃO após o deploy
tests/                          — 1 arquivo por módulo + fixtures/feed.xml
README.md                       — operação e setup
```

## 5. Padrões e convenções

### Fluxo
- **Sync:** `GET /api/cron/sync` (Bearer) -> `runSync(deps)` em `lib/sync/run.ts`: lock global -> `fetchFeed`+`parseFeed` -> `diffFeed` contra `listKnownItems` -> insert (`pending`; `skipped` no seed ou flood) / update (só conteúdo, zera `summary_pt`) -> `claimForNotify` -> resumo -> `buildDiscordPayload` -> `send` -> `markSent`/`markFailed`/estorno -> `revalidate()` -> libera lock.
- **Site:** `page.tsx` (Server Component) -> `lib/db/queries.ts` (cache) -> Supabase. Páginas nunca falam com o banco direto; erros sobem para `app/error.tsx` (HTTP 500).
- `runSync` não importa Supabase/Discord/relógio: tudo entra por `SyncDeps` (testável). Efeitos reais só em `app/api/cron/sync/route.ts`.
- `lib/types.ts` é o contrato; não altere assinaturas sem atualizar os consumidores.

### Nomenclatura
- Arquivos `kebab`/curtos em `lib/` (`to-discord.ts`), componentes `PascalCase.tsx`; alias `@/` = raiz. Imports sempre `@/lib/...`.
- TS em camelCase (`publishedAt`), colunas SQL em snake_case (`published_at`); a conversão vive só em `lib/db/mapping.ts`.
- Comentários e textos de UI em pt-BR; logs com prefixo `[sync]`, `[env]`. Código/identificadores em inglês, exceto termos de domínio.
- Módulos de servidor começam com `import "server-only"` (env, supabase, db).

### Receita: novo módulo de lib com teste
1. Crie `lib/<area>/<nome>.ts` puro (dependências por parâmetro), exporte tipos junto.
2. Crie `tests/<nome>.test.ts` (`import { describe, expect, it } from "vitest"`; mocks por injeção ou `vi.mock("@/lib/...")` como em `tests/route.test.ts`).
3. Se o módulo tiver `server-only`, nada a fazer nos testes: o alias em `vitest.config.ts` o neutraliza.
4. `npm test`, `npm run typecheck`, `npm run lint`.

### Receita: nova coluna em `changelog_items`
1. Nova migration `supabase/migrations/000N_<nome>.sql` com `alter table ... add column if not exists` (nunca edite a 0001 depois do primeiro deploy).
2. Se a coluna é lida pelo claim: recriar `claim_items_for_notify` (retorno é `returns table`, precisa `drop function` antes, como na 0001) e reaplicar os `grant`/`revoke`.
3. `lib/db/mapping.ts`: `ItemRow`, `ITEM_COLUMNS`, `feedItemToRow`/`rowToStoredItem`; `lib/types.ts` se for do contrato.
4. `lib/db/items.ts` (insert/update) e o `MemoryRepo` em `tests/run.test.ts` espelhando o mesmo comportamento; `tests/db-mapping.test.ts`.
5. `npm test` + `npm run typecheck`.

### Receita: novo filtro da home
1. `lib/db/queries.ts`: campo em `ListFilters`, função `clean<X>Param`, `.contains/.eq` em `fetchList`; facet no RPC `changelog_facets` (migration) e em `fetchFacets`.
2. `app/page.tsx`: `first(sp.<x>)` em `filters` e o mapeamento de facets para `FilterBar` (ver 7).
3. `components/FilterBar.tsx` (Select) e `components/Pagination.tsx` (propaga `params`).
4. `tests/queries-validation.test.ts` para o `clean*`.

### Erros, validação e logs
- Env obrigatória ausente/inválida lança em `lib/env.ts`; opcional inválida vira `console.warn("[env] ...")` + padrão e nunca derruba o sync.
- Erros do feed: `FeedFetchError` / `FeedParseError` -> `SyncResult.status = "feed_error"` -> HTTP 502. Corpo de erro 500 é sempre genérico (`internal_error`); detalhe só no log.
- Segredos (URL do webhook, chaves) nunca em log, resultado ou mensagem de erro. `last_error` é truncado (1000 chars).
- Entrada de URL (`q`, `type`, `area`, `version`, `page`) é normalizada antes de formar a chave de cache (`listItems`).

### Testes
- `tests/*.test.ts`, 268 testes, sem rede e sem banco. Sync usa `MemoryRepo` + `Clock` fake em `tests/run.test.ts`; rota mocka `@/lib/sync/run`; Anthropic e fetch entram por injeção.
- Fixture do feed: `tests/fixtures/feed.xml`.

### Dados
- Tabelas: `changelog_items` (PK `guid` = link; `slug` único; `search` tsvector gerado `simple`), `sync_state` (linha única `id = 1`: `seeded_at`, lock, `last_run_at`, `last_success_at`, `last_error`).
- Sem soft delete; itens ausentes do feed nunca são removidos. Timestamps `timestamptz`. Alteração de schema só por arquivo em `supabase/migrations/`, aplicado à mão.

### Config e ambiente
- Local: `.env.local` (copiado de `.env.example`); Vercel: variáveis em Production. `.env*` é ignorado pelo git, exceto `.env.example`. Nunca abra/copie `.env`/`.env.local`.
- Obrigatórias: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` (>= 32 chars), `DISCORD_WEBHOOK_URL`. Opcionais: `DISCORD_ALERT_ROLE_ID`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `FEED_URL`, `MAX_POSTS_PER_RUN` (1–10, padrão 5), `DISCORD_DRY_RUN` (`1`), `SITE_URL`.
- Ambiente de dev do autor: Windows (PowerShell/Git Bash), Node 26.

## 6. Domínio

- **Item (FeedItem/StoredItem)** — entrada do changelog; `guid` == `link`; `slug` = último segmento do link (+ sufixo hash de 6 hex do guid em colisão); `contentHash` = sha256(`título|descriptionHtml|categorias`).
- **categories** — brutas do feed; derivadas em `changeTypes` (um de `CHANGE_TYPES`: Action Required, Breaking API Change, Deprecation announcement, New, Update, Platform), `apiVersions` (`YYYY-MM[-DD]`) e `areas` (todo o resto).
- **Itens de alerta** — Action Required / Breaking API Change: cor própria e menção ao cargo `DISCORD_ALERT_ROLE_ID` (`isAlertItem` em `lib/discord/embed.ts`).
- **notify_status** — `pending | sending | sent | failed | skipped` (máquina completa no comentário de `lib/sync/run.ts`; `MAX_NOTIFY_ATTEMPTS = 5`; claim "sending" velho >10 min é reclamado de novo).
- **Seed** — 1º run: todos os itens do feed entram `skipped` e `sync_state.seeded_at` é gravado; nada é postado.
- **Flood guard** — mais de 50 itens novos (pós-seed) entram `skipped`.
- **Lock global** — RPC `acquire_sync_lock` (TTL 120 s) garante um run por vez; resposta `status: "locked"`.
- **Facets** — contagens por tipo/área/versão via RPC `changelog_facets`.
- **SyncResult** — `{status: ok|locked|feed_error, seeded, inserted, updated, posted, failed, remaining}`.

## 7. Armadilhas e decisões

- **Vitest precisa de `pool: "vmThreads"`** (`vitest.config.ts`): no Node 26 + vitest 5 os pools padrão quebram antes do primeiro teste. Não remova.
- **Cache:** usa `unstable_cache` com tag `changelog` e revalidate 1 h porque `cacheComponents` está desligado (`use cache` exigiria a flag). Invalide só via `revalidateChangelog()`, que chama `revalidateTag(tag, { expire: 0 })`; a forma de 1 argumento está depreciada no Next 16.
- **`lib/types.ts` é o contrato** entre módulos; mexer em assinatura exige atualizar todos os consumidores.
- **`MemoryRepo` de `tests/run.test.ts` precisa espelhar o SQL** (`claim_items_for_notify`, `markFailedTerminal`, `returnToPending` com estorno, update zerando resumo). Mudou o SQL ou `lib/db/items.ts`? Mude os dois juntos, senão os testes passam mentindo.
- **Máquina de `notify_status`:** envio ambíguo (timeout/socket depois de enviar) vira `failed` terminal com `notify_attempts = 5` e `last_error` "ambiguous: ...", sem retry automático, para não duplicar post; o lote do run para. 401/403/404/webhook ausente, 429 longo, dry run e "sem tempo" voltam a `pending` com estorno da tentativa. Reenfileirar é SQL manual (README, seção Operação).
- **Primeiro run semeia como `skipped`** (~811 itens) e não posta nada; esperado `"seeded": true, "posted": 0`.
- **Flood guard > 50** itens novos viram `skipped` para não inundar o canal.
- **Reenfileirar em produção posta de verdade** (o pg_cron roda a cada 15 min); teste de payload só em projeto Supabase separado ou com `DISCORD_DRY_RUN=1`.
- **Migration `0001_init.sql` ainda não foi aplicada em lugar nenhum e foi editada no lugar** (inclusive a RPC com `drop function if exists`). Depois do primeiro deploy/aplicação, TODA mudança de schema precisa de um novo arquivo `000N_*.sql`.
- **`vercel.json` registra o Vercel Cron diário de backup** (`0 12 * * *` → `/api/cron/sync`; a Vercel envia `Authorization: Bearer $CRON_SECRET` sozinha). O gatilho principal é o `pg_cron` (`supabase/cron.sql`). O arquivo já sumiu uma vez em 2026-11-13: se faltar, recrie.
- **`FilterBar` recebe outra forma de facet:** `app/page.tsx` mapeia `{ value, count }` (de `getFacets`) para `{ value, n }` e `apiVersions` para `versions`. Ao mudar um lado, mude o outro.
- **O sanitizer é o único caminho do HTML do feed para a página:** `ItemBody` usa `dangerouslySetInnerHTML` e só aceita saída de `sanitizeForWeb()` (allowlist em `lib/html/sanitize.ts`). Nunca passe `descriptionHtml` cru.
- **CSP (`next.config.ts`) tem `'unsafe-inline'` em `script-src`:** nonces forçariam renderização dinâmica e quebrariam as páginas em cache; `'unsafe-eval'` só em dev (HMR).
- **`.env*` ignorado, exceto `.env.example`** (só nomes de variáveis). Nunca commite nem leia valores reais; `supabase/cron.sql` tem placeholders que são preenchidos só no SQL Editor, nunca no repo.
- **Deployment Protection da Vercel** não pode bloquear o domínio de produção, senão o `pg_cron` recebe 401/403.
- **Webhook e service role** nunca em `NEXT_PUBLIC_*` nem em logs. `layout.tsx` lê `process.env.SITE_URL` direto (metadata), enquanto `lib/env.ts` expõe `getSiteUrl()`.
- **Tempos da rota:** `maxDuration = 60`, `runtime = "nodejs"`, `dynamic = "force-dynamic"`; orçamentos em `DEFAULT_SYNC_CONFIG` (notificações param após 32 s, teto duro 52 s, lock 120 s). Mantenha lock TTL > maxDuration.
- **Edições de itens existentes** atualizam o site mas nunca geram novo post; o slug gravado é mantido (URL estável).
- **Windows:** o repositório git raiz é `C:\`, não esta pasta; evite comandos git amplos aqui. Prefira Edit/Write a `sed -i` e heredocs com `\n`.

- **Visual (2026-11-13, /perfect-app):** tokens OKLCH em `app/globals.css` (`--color-*`, `--text-*` escala 1.2, `--space-*` 8pt); cards e lista SEM bordas por pedido do usuário (separação por superfície + sombra `--shadow-card`); só inputs/selects/chips/botão secundário mantêm borda (3:1). Contraste verificado numericamente.
- **Título de `app/page.tsx` é `absolute`:** o template do layout não se aplica à página do mesmo segmento.

## 8. Histórico

- 2026-11-13 — criado (mapeamento inicial).
- 2026-11-13 — fase 9 do /perfect-app: comentários removidos de app/components/tests (lib e SQL mantidos), PLAN.md apagado, newLockOwner→createLockId, llms.txt.
