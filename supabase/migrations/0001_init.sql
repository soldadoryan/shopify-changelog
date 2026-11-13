-- 0001_init.sql — Shopify Dev Changelog notifier
-- Idempotent: safe to re-run on an already-migrated database.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.changelog_items (
  guid               text primary key,              -- == link
  slug               text not null unique,          -- last link segment (+ hash suffix on collision)
  title              text not null,
  link               text not null,
  published_at       timestamptz not null,          -- atom:published (fallback pubDate)
  updated_at         timestamptz not null,          -- atom:updated
  categories         text[] not null default '{}',  -- raw, in feed order
  change_types       text[] not null default '{}',  -- derived
  areas              text[] not null default '{}',
  api_versions       text[] not null default '{}',
  description_html   text not null,                 -- raw, without the outer <div class="">
  description_text   text not null,                 -- plain text (search)
  content_hash       text not null,                 -- sha256(title|description_html|categories)
  summary_pt         text,                          -- AI summary (Discord + detail box)
  summary_model      text,
  notify_status      text not null default 'pending'
                     check (notify_status in ('pending','sending','sent','failed','skipped')),
  notify_attempts    int  not null default 0,
  notify_claimed_at  timestamptz,
  notified_at        timestamptz,
  discord_message_id text,
  last_error         text,
  first_seen_at      timestamptz not null default now(),
  search tsvector generated always as (
    setweight(to_tsvector('simple', title), 'A') ||
    setweight(to_tsvector('simple', left(description_text, 20000)), 'B')
  ) stored
);

create index if not exists changelog_items_published_at_idx
  on public.changelog_items (published_at desc);
create index if not exists changelog_items_change_types_idx
  on public.changelog_items using gin (change_types);
create index if not exists changelog_items_areas_idx
  on public.changelog_items using gin (areas);
create index if not exists changelog_items_api_versions_idx
  on public.changelog_items using gin (api_versions);
create index if not exists changelog_items_search_idx
  on public.changelog_items using gin (search);
create index if not exists changelog_items_notify_status_idx
  on public.changelog_items (notify_status)
  where notify_status in ('pending','sending','failed');

create table if not exists public.sync_state (
  id              int primary key default 1 check (id = 1),
  seeded_at       timestamptz,
  lock_owner      uuid,
  lock_until      timestamptz,
  last_run_at     timestamptz,
  last_success_at timestamptz,
  last_error      text
);

insert into public.sync_state (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Row Level Security: enabled, no policies => anon/authenticated see nothing.
-- service_role bypasses RLS. Table grants are also dropped (defense in depth).
-- ---------------------------------------------------------------------------

alter table public.changelog_items enable row level security;
alter table public.sync_state      enable row level security;

revoke all on table public.changelog_items from public, anon, authenticated;
revoke all on table public.sync_state      from public, anon, authenticated;

-- Explicit grant: do not depend on the project's default privileges.
grant select, insert, update, delete on public.changelog_items, public.sync_state to service_role;

-- ---------------------------------------------------------------------------
-- RPCs. SECURITY INVOKER (default) is enough: only service_role (BYPASSRLS)
-- may execute them. search_path is empty, so every name is schema-qualified.
-- ---------------------------------------------------------------------------

-- Atomic global lock: one UPDATE that succeeds only if the lock is free or expired.
create or replace function public.acquire_sync_lock(p_owner uuid, p_ttl_seconds int)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  if p_owner is null or p_ttl_seconds is null or p_ttl_seconds <= 0 then
    raise exception 'acquire_sync_lock: p_owner and a positive p_ttl_seconds are required';
  end if;

  update public.sync_state
     set lock_owner  = p_owner,
         lock_until  = now() + make_interval(secs => p_ttl_seconds),
         last_run_at = now()
   where id = 1
     and (lock_until is null or lock_until < now());

  return found;
end;
$$;

-- Release only by the holder token; a stale or foreign owner is a no-op.
create or replace function public.release_sync_lock(p_owner uuid)
returns void
language sql
set search_path = ''
as $$
  update public.sync_state
     set lock_until = null,
         lock_owner = null
   where id = 1
     and lock_owner = p_owner;
$$;

-- Atomically claim up to p_limit items for notification (oldest first).
-- FOR UPDATE SKIP LOCKED makes concurrent callers pick disjoint rows.
-- Returns every column except the generated `search` tsvector (large, never needed by the notifier).
-- The return type changed from `setof changelog_items`, hence the drop (the grants below are re-applied).
drop function if exists public.claim_items_for_notify(int);
create function public.claim_items_for_notify(p_limit int)
returns table (
  guid               text,
  slug               text,
  title              text,
  link               text,
  published_at       timestamptz,
  updated_at         timestamptz,
  categories         text[],
  change_types       text[],
  areas              text[],
  api_versions       text[],
  description_html   text,
  description_text   text,
  content_hash       text,
  summary_pt         text,
  summary_model      text,
  notify_status      text,
  notify_attempts    int,
  notify_claimed_at  timestamptz,
  notified_at        timestamptz,
  discord_message_id text,
  last_error         text,
  first_seen_at      timestamptz
)
language sql
set search_path = ''
as $$
  -- A claim that died (process killed) with the attempts already exhausted would stay in
  -- 'sending' forever: surface it as failed so it is visible and excluded from the remaining count.
  update public.changelog_items
     set notify_status = 'failed',
         last_error    = 'stale sending (attempts exhausted)'
   where notify_status = 'sending'
     and notify_attempts >= 5
     and notify_claimed_at < now() - interval '10 minutes';

  with picked as (
    select i.guid
      from public.changelog_items i
     where i.notify_status = 'pending'
        or (i.notify_status = 'failed'  and i.notify_attempts < 5)
        or (i.notify_status = 'sending' and i.notify_attempts < 5
            and i.notify_claimed_at < now() - interval '10 minutes')
     order by i.published_at asc, i.guid asc
     limit greatest(coalesce(p_limit, 0), 0)
       for update skip locked
  ),
  claimed as (
    update public.changelog_items c
       set notify_status     = 'sending',
           notify_claimed_at = now(),
           notify_attempts   = c.notify_attempts + 1
      from picked
     where c.guid = picked.guid
    returning c.guid, c.slug, c.title, c.link, c.published_at, c.updated_at, c.categories,
              c.change_types, c.areas, c.api_versions, c.description_html, c.description_text,
              c.content_hash, c.summary_pt, c.summary_model, c.notify_status, c.notify_attempts,
              c.notify_claimed_at, c.notified_at, c.discord_message_id, c.last_error, c.first_seen_at
  )
  select * from claimed order by published_at asc, guid asc;
$$;

-- Facet counts for the filter selects.
create or replace function public.changelog_facets()
returns table (kind text, value text, n bigint)
language sql
stable
set search_path = ''
as $$
  select 'change_type'::text as kind, v as value, count(*)::bigint as n
    from public.changelog_items, unnest(change_types) as v group by v
  union all
  select 'area'::text, v, count(*)::bigint
    from public.changelog_items, unnest(areas) as v group by v
  union all
  select 'api_version'::text, v, count(*)::bigint
    from public.changelog_items, unnest(api_versions) as v group by v
  order by 1, 3 desc, 2;
$$;

-- Execute only for service_role.
revoke execute on function public.acquire_sync_lock(uuid, int)  from public, anon, authenticated;
revoke execute on function public.release_sync_lock(uuid)       from public, anon, authenticated;
revoke execute on function public.claim_items_for_notify(int)   from public, anon, authenticated;
revoke execute on function public.changelog_facets()            from public, anon, authenticated;

grant execute on function public.acquire_sync_lock(uuid, int)  to service_role;
grant execute on function public.release_sync_lock(uuid)       to service_role;
grant execute on function public.claim_items_for_notify(int)   to service_role;
grant execute on function public.changelog_facets()            to service_role;
