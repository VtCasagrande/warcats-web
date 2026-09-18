create index account_checkpoints_account_time_idx on public.account_checkpoints(account_id,created_at desc);
-- PostgREST retries SQLSTATE 40001; business conflicts must return HTTP 409 immediately.
create or replace function public.apply_account_checkpoint(
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
  if v_profile.revision <> p_expected_revision then raise exception 'CHECKPOINT_REVISION_CONFLICT' using errcode='PT409'; end if;
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
  -- Bound retry history. Older requests still fail the revision check instead of reapplying money.
  delete from public.account_checkpoints where id in (
    select id from public.account_checkpoints where account_id=p_account_id order by created_at desc,id desc offset 63
  );
  insert into public.account_checkpoints(id,account_id,result) values(p_id,p_account_id,to_jsonb(v_profile));
  return next v_profile;
end;
$$;
