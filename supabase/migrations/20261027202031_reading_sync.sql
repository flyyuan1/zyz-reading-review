-- Encrypted reading history. Browsers never access these tables directly.
create table public.reading_sync_spaces (
  id text primary key check (id ~ '^[a-f0-9]{64}$'),
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  legacy_cursor bigint not null default 0 check (legacy_cursor >= 0),
  legacy_complete boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.reading_sync_records (
  seq bigint generated always as identity primary key check (seq <= 9007199254740991),
  space_id text not null references public.reading_sync_spaces(id),
  id text not null check (id ~ '^[a-f0-9]{64}$'),
  iv text not null check (iv ~ '^[A-Za-z0-9_-]{16}$'),
  ciphertext text not null check (length(ciphertext) between 22 and 98304 and ciphertext ~ '^[A-Za-z0-9_-]+$'),
  protocol_version integer not null default 1 check (protocol_version = 1),
  unique (space_id, id)
);
create index reading_sync_records_space_seq on public.reading_sync_records(space_id, seq);

alter table public.reading_sync_spaces enable row level security;
alter table public.reading_sync_records enable row level security;
revoke all on public.reading_sync_spaces, public.reading_sync_records from public, anon, authenticated;
revoke all on sequence public.reading_sync_records_seq_seq from public, anon, authenticated;
grant select, insert on public.reading_sync_spaces to service_role;
grant update (legacy_cursor, legacy_complete) on public.reading_sync_spaces to service_role;
grant select, insert on public.reading_sync_records to service_role;
grant usage, select on sequence public.reading_sync_records_seq_seq to service_role;

-- The per-space row lock is acquired BEFORE allocating sequence IDs. Concurrent
-- writers therefore commit in cursor order, so incremental readers cannot miss
-- an earlier sequence that was still uncommitted when they advanced the cursor.
create function public.reading_sync_append(
  p_space_id text,
  p_records jsonb,
  p_legacy_cursor bigint default null,
  p_legacy_complete boolean default false
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  envelope jsonb;
begin
  if jsonb_typeof(p_records) is distinct from 'array' then
    raise exception 'invalid batch';
  end if;
  if jsonb_array_length(p_records) > 20 then
    raise exception 'invalid batch';
  end if;
  perform 1 from public.reading_sync_spaces where id = p_space_id for update;
  if not found then raise exception 'unknown space'; end if;
  for envelope in select value from jsonb_array_elements(p_records) loop
    insert into public.reading_sync_records(space_id, id, iv, ciphertext)
    values (p_space_id, envelope->>'id', envelope->>'iv', envelope->>'ciphertext')
    on conflict (space_id, id) do nothing;
  end loop;
  if p_legacy_cursor is not null then
    update public.reading_sync_spaces
    set legacy_cursor = greatest(legacy_cursor, p_legacy_cursor),
        legacy_complete = legacy_complete or p_legacy_complete
    where id = p_space_id;
  end if;
end;
$$;
revoke all on function public.reading_sync_append(text, jsonb, bigint, boolean) from public, anon, authenticated;
grant execute on function public.reading_sync_append(text, jsonb, bigint, boolean) to service_role;
