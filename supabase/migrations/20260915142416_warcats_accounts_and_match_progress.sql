-- Auth owns identity. Only the authoritative game server owns money and results.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.admin_allowlist (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);
insert into private.admin_allowlist(email) values ('casagrandevitor@gmail.com');

create table public.player_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (char_length(username) between 3 and 40),
  display_name text not null check (char_length(display_name) between 1 and 18),
  email text not null,
  role text not null default 'player' check (role in ('player','admin')),
  cash numeric(14,2) not null default 10000 check (cash >= 0),
  kills bigint not null default 0 check (kills >= 0),
  deaths bigint not null default 0 check (deaths >= 0),
  wins bigint not null default 0 check (wins >= 0),
  rounds bigint not null default 0 check (rounds >= wins),
  objective_seconds numeric(14,2) not null default 0 check (objective_seconds >= 0),
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index player_profiles_created_at_idx on public.player_profiles(created_at desc);

create table public.game_sessions (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  account_id uuid not null references public.player_profiles(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index game_sessions_account_id_idx on public.game_sessions(account_id);
create index game_sessions_expires_at_idx on public.game_sessions(expires_at);

create table public.match_results (
  account_id uuid not null references public.player_profiles(id) on delete cascade,
  match_id text not null check (char_length(match_id) between 1 and 128),
  won boolean not null,
  created_at timestamptz not null default now(),
  primary key (account_id, match_id)
);
create index match_results_created_at_idx on public.match_results(created_at desc);
create index match_results_match_id_idx on public.match_results(match_id);

create table public.account_checkpoints (
  id uuid primary key,
  account_id uuid not null references public.player_profiles(id) on delete cascade,
  result jsonb not null,
  created_at timestamptz not null default now()
);
create index account_checkpoints_account_id_idx on public.account_checkpoints(account_id);
create index account_checkpoints_created_at_idx on public.account_checkpoints(created_at);

alter table public.player_profiles enable row level security;
alter table public.game_sessions enable row level security;
alter table public.match_results enable row level security;
alter table public.account_checkpoints enable row level security;
alter table private.admin_allowlist enable row level security;
revoke all on public.player_profiles, public.game_sessions, public.match_results, public.account_checkpoints from public, anon, authenticated;
grant select on public.player_profiles, public.match_results to authenticated;
grant select, insert, update, delete on public.player_profiles, public.game_sessions, public.match_results, public.account_checkpoints to service_role;
create policy profile_read_self on public.player_profiles for select to authenticated using ((select auth.uid()) = id);
create policy result_read_self on public.match_results for select to authenticated using ((select auth.uid()) = account_id);

create function private.sync_auth_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_username text;
  v_display text;
  v_role text := 'player';
begin
  v_username := lower(regexp_replace(coalesce(new.raw_user_meta_data->>'username',''), '[^a-zA-Z0-9_]', '', 'g'));
  if char_length(v_username) < 3 or char_length(v_username) > 20 or exists(select 1 from public.player_profiles where username = v_username and id <> new.id) then
    v_username := 'op_' || replace(new.id::text, '-', '');
  end if;
  v_display := left(trim(regexp_replace(coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'displayName', v_username), '[<>[:cntrl:]]', '', 'g')), 18);
  if v_display = '' then v_display := 'Operador'; end if;
  -- An unverified address and user-editable metadata can never grant admin rights.
  if new.email_confirmed_at is not null and exists(select 1 from private.admin_allowlist where email = lower(new.email)) then v_role := 'admin'; end if;
  insert into public.player_profiles(id,username,display_name,email,role)
    values (new.id,v_username,v_display,lower(coalesce(new.email,'')),v_role)
    on conflict (id) do update set email=excluded.email, role=excluded.role, display_name=excluded.display_name, updated_at=now();
  return new;
end;
$$;
revoke all on function private.sync_auth_profile() from public, anon, authenticated;
create trigger warcats_sync_auth_profile after insert or update of email, email_confirmed_at, raw_user_meta_data on auth.users for each row execute function private.sync_auth_profile();

create function public.apply_account_checkpoint(
  p_id uuid, p_account_id uuid, p_expected_revision bigint, p_cash numeric,
  p_kills bigint, p_deaths bigint, p_objective_seconds numeric, p_results jsonb
) returns setof public.player_profiles
language plpgsql security invoker set search_path = '' as $$
declare
  v_profile public.player_profiles;
  v_prior jsonb;
  v_result jsonb;
  v_inserted integer;
  v_rounds integer := 0;
  v_wins integer := 0;
begin
  select * into strict v_profile from public.player_profiles where id=p_account_id for update;
  select result into v_prior from public.account_checkpoints where id=p_id and account_id=p_account_id;
  if found then
    return query select * from jsonb_populate_record(null::public.player_profiles, v_prior);
    return;
  end if;
  if v_profile.revision <> p_expected_revision then raise exception 'CHECKPOINT_REVISION_CONFLICT' using errcode='40001'; end if;
  if p_cash is null or p_cash < 0 or p_cash > 999999999999 or p_cash::text in ('NaN','Infinity','-Infinity')
    or p_kills is null or p_kills < 0 or p_kills > 1000000 or p_deaths is null or p_deaths < 0 or p_deaths > 1000000
    or p_objective_seconds is null or p_objective_seconds < 0 or p_objective_seconds > 10000000 or p_objective_seconds::text in ('NaN','Infinity','-Infinity') then
    raise exception 'INVALID_PROGRESS' using errcode='22023';
  end if;
  if p_results is null or jsonb_typeof(p_results) <> 'array' then raise exception 'INVALID_RESULTS' using errcode='22023'; end if;
  if jsonb_array_length(p_results) > 64 then raise exception 'TOO_MANY_RESULTS' using errcode='22023'; end if;
  for v_result in select value from jsonb_array_elements(p_results) loop
    if jsonb_typeof(v_result->'matchId') is distinct from 'string' or char_length(v_result->>'matchId') not between 1 and 128 or jsonb_typeof(v_result->'won') is distinct from 'boolean' then
      raise exception 'INVALID_MATCH_RESULT' using errcode='22023';
    end if;
    insert into public.match_results(account_id,match_id,won) values (p_account_id,v_result->>'matchId',(v_result->>'won')::boolean) on conflict do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 1 then v_rounds := v_rounds+1; if (v_result->>'won')::boolean then v_wins := v_wins+1; end if; end if;
  end loop;
  update public.player_profiles set cash=round(p_cash,2), kills=kills+p_kills, deaths=deaths+p_deaths,
    objective_seconds=objective_seconds+round(p_objective_seconds,2), rounds=rounds+v_rounds, wins=wins+v_wins,
    revision=revision+1, updated_at=now() where id=p_account_id returning * into v_profile;
  insert into public.account_checkpoints(id,account_id,result) values(p_id,p_account_id,to_jsonb(v_profile));
  return next v_profile;
end;
$$;
revoke all on function public.apply_account_checkpoint(uuid,uuid,bigint,numeric,bigint,bigint,numeric,jsonb) from public, anon, authenticated;
grant execute on function public.apply_account_checkpoint(uuid,uuid,bigint,numeric,bigint,bigint,numeric,jsonb) to service_role;

create function public.admin_overview() returns jsonb
language sql security invoker set search_path = '' as $$
  select jsonb_build_object(
    'accounts',(select count(*) from public.player_profiles),
    'totalCash',(select coalesce(sum(cash),0) from public.player_profiles),
    'matchesPlayed',(select count(distinct match_id) from public.match_results),
    'operators',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from (select * from public.player_profiles order by created_at desc limit 20) p),
    'results',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select r.*,p.display_name from public.match_results r join public.player_profiles p on p.id=r.account_id order by r.created_at desc limit 20) r)
  );
$$;
revoke all on function public.admin_overview() from public, anon, authenticated;
grant execute on function public.admin_overview() to service_role;
