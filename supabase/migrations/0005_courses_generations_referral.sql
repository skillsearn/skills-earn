-- SKILLSEARN — course lifecycle, configurable generation depth, compulsory referral code.

-- ───────────────────────── registration ─────────────────────────
-- Every new member must join under a referral code (the admin's code is the root of the tree).
update app_settings set value = value || '{"referralRequired": true}' where key = 'registration';

-- ───────────────────────── courses ─────────────────────────
-- draft       → being prepared, never visible to members
-- published   → live for members
-- unpublished → was live, temporarily hidden
-- archived    → "deleted" but kept because members have enrolment/progress records
alter table courses
  add column status       text not null default 'draft'
                          check (status in ('draft','published','unpublished','archived')),
  add column category     text,
  add column duration     text,          -- free text shown to members, e.g. "4 weeks" or "6 hours"
  add column published_at timestamptz,
  add column archived_at  timestamptz;

update courses set status = case when is_published then 'published' else 'draft' end,
                   published_at = case when is_published then created_at end;

-- is_published is now derived from status so every member-facing query keeps working.
alter table courses drop column is_published;
alter table courses add column is_published boolean generated always as (status = 'published') stored;

create index courses_status_idx on courses(status, sort);

-- ───────────────────────── generation depth ─────────────────────────
-- commission.maxGenerations caps how many generations above the direct referrer are calculated.
-- A package's max_generations still decides which of those generations a beneficiary may receive.
update app_settings set value = value || '{"maxGenerations": 3}'
 where key = 'commission' and not value ? 'maxGenerations';

alter table packages drop constraint if exists packages_max_generations_check;
alter table packages add constraint packages_max_generations_check check (max_generations between 0 and 50);

alter table commissions drop constraint if exists commissions_level_check;
alter table commissions add constraint commissions_level_check check (level between 0 and 50);

-- D  = base × direct_rate(purchased package)
-- With G0 = D and the repeating rates r1, r2, r3 (15% · 12% · 8%):
--   Gn = G(n-1)×r1 + G(n-2)×r2 + G(n-3)×r3        (terms with index < 0 are dropped)
-- which gives  G1 = D×r1 ; G2 = D×r2 + G1×r1 ; G3 = D×r3 + G1×r2 + G2×r1
--              G4 = G1×r3 + G2×r2 + G3×r1 ; G5 = G2×r3 + G3×r2 + G4×r1 ; …
-- so D only feeds generations 1–3. Each term is rounded to ₹0.01 before it is reused.
-- Beneficiaries: direct = ancestors[1]; Gn = ancestors[n+1]. Eligibility checked independently,
-- and an ineligible generation's amount is never moved to anyone else.
create or replace function process_commissions(p_purchase_id uuid) returns int
language plpgsql as $$
declare
  v_pur purchases;
  v_buyer profiles;
  v_pkg packages;
  v_rule commission_rule_versions;
  v_cset jsonb := get_setting('commission');
  v_hold_days int := coalesce((v_cset->>'holdDays')::int, 0);
  v_direct_needs_pkg boolean := coalesce((v_cset->>'directRequiresActivePackage')::boolean, true);
  v_max_gen int := least(50, greatest(1, coalesce((v_cset->>'maxGenerations')::int, 3)));
  r int[];
  amt numeric[];      -- amt[1]=D, amt[n+1]=Gn
  calc text[];
  term numeric;
  n int; j int;
  lvl int;
  v_ben profiles;
  v_ben_max int;
  v_status text;
  v_reason text;
  v_comm commissions;
  v_count int := 0;
begin
  select * into v_pur from purchases where id = p_purchase_id for update;
  if not found then raise exception 'PURCHASE_NOT_FOUND: purchase not found'; end if;
  if v_pur.status <> 'paid' then raise exception 'PURCHASE_NOT_PAID: commissions require a verified payment'; end if;

  if v_pur.commission_status = 'processed' then
    insert into fraud_alerts(type, severity, user_id, purchase_id, details)
    values ('duplicate_commission_attempt', 'high', v_pur.user_id, v_pur.id,
            jsonb_build_object('processed_at', v_pur.commission_processed_at));
    return 0;
  end if;
  if v_pur.commission_status = 'not_applicable' then return 0; end if;

  if v_pur.commission_base <= 0 then
    update purchases set commission_status = 'not_applicable' where id = v_pur.id;
    return 0;
  end if;

  select * into v_buyer from profiles where id = v_pur.user_id;
  select * into v_pkg from packages where id = v_pur.package_id;
  select * into v_rule from commission_rule_versions order by id desc limit 1;
  r := v_rule.generation_rates_bps;

  amt := array_fill(0::numeric, array[v_max_gen + 1]);
  calc := array_fill(''::text, array[v_max_gen + 1]);

  amt[1] := money_round(v_pur.commission_base * v_pkg.direct_rate_bps / 10000.0);
  calc[1] := fmt_inr(v_pur.commission_base) || ' × ' || fmt_pct(v_pkg.direct_rate_bps) || ' = ' || fmt_inr(amt[1]);

  for n in 1..v_max_gen loop
    for j in greatest(0, n - 3)..(n - 1) loop
      term := money_round(amt[j + 1] * r[n - j] / 10000.0);
      amt[n + 1] := amt[n + 1] + term;
      calc[n + 1] := calc[n + 1] || case when j > greatest(0, n - 3) then ' + ' else '' end
                     || '(' || fmt_inr(amt[j + 1]) || ' × ' || fmt_pct(r[n - j]) || ')';
    end loop;
    calc[n + 1] := calc[n + 1] || ' = ' || fmt_inr(amt[n + 1]);
  end loop;

  for lvl in 0..v_max_gen loop
    exit when array_length(v_buyer.ancestors, 1) is null or lvl + 1 > array_length(v_buyer.ancestors, 1);

    select * into v_ben from profiles where id = v_buyer.ancestors[lvl + 1];
    select max_generations into v_ben_max from packages where id = v_ben.active_package_id;

    v_status := case when v_hold_days > 0 then 'pending' else 'credited' end;
    v_reason := null;
    if v_ben.status <> 'active' then
      v_status := 'skipped'; v_reason := 'Beneficiary account suspended';
    elsif v_ben.active_package_id is null and (lvl > 0 or v_direct_needs_pkg) then
      v_status := 'skipped'; v_reason := 'Beneficiary has no active package';
    elsif lvl > 0 and coalesce(v_ben_max, 0) < lvl then
      v_status := 'skipped'; v_reason := format('Package eligible up to generation %s only', coalesce(v_ben_max, 0));
    elsif amt[lvl + 1] <= 0 then
      v_status := 'skipped'; v_reason := 'Zero commission amount';
    end if;

    insert into commissions(purchase_id, source_user_id, beneficiary_id, level, rate_bps, base_amount,
                            amount, calculation, status, skip_reason, rule_version_id, available_at, credited_at)
    values (v_pur.id, v_buyer.id, v_ben.id, lvl,
            case when lvl = 0 then v_pkg.direct_rate_bps else r[1 + (lvl - 1) % 3] end,
            case when lvl = 0 then v_pur.commission_base else amt[1] end,
            amt[lvl + 1], calc[lvl + 1], v_status, v_reason, v_rule.id,
            case when v_status = 'pending' then now() + make_interval(days => v_hold_days) end,
            case when v_status = 'credited' then now() end)
    returning * into v_comm;
    v_count := v_count + 1;

    if v_status = 'credited' then
      perform ledger_post(v_ben.id,
        case when lvl = 0 then 'direct_commission' else 'generation_commission' end,
        v_comm.amount,
        case when lvl = 0 then 'Direct referral commission from ' || v_buyer.user_code
             else format('Generation %s commission from %s', lvl, v_buyer.user_code) end,
        v_pur.id, v_comm.id, null, lvl::smallint,
        jsonb_build_object('calculation', v_comm.calculation, 'rule_version', v_rule.id));
      perform notify_user(v_ben.id, 'commission',
        case when lvl = 0 then 'Direct commission credited' else format('Generation %s commission credited', lvl) end,
        fmt_inr(v_comm.amount) || ' from ' || v_buyer.full_name || ' (' || v_buyer.user_code || ')', '/app/income');
    end if;
  end loop;

  update purchases set commission_status = 'processed', commission_processed_at = now() where id = v_pur.id;
  return v_count;
end $$;

-- Generation-wise income for any depth, plus the member's own and team purchase turnover.
-- Turnover is reported separately and is never used as a commission base.
create or replace function wallet_summary(p_user uuid) returns jsonb
language sql stable as $$
  with t as (select (now() at time zone 'Asia/Kolkata') as local_now),
  c as (
    select cm.*, (cm.credited_at at time zone 'Asia/Kolkata') as local_at
      from commissions cm where cm.beneficiary_id = p_user
  )
  select jsonb_build_object(
    'availableBalance', (select coalesce(sum(amount), 0) from wallet_ledger where user_id = p_user),
    'onHold',           (select coalesce(sum(gross_amount), 0) from withdrawals
                          where user_id = p_user and status in ('requested','under_review','approved','processing')),
    'pendingCommission',(select coalesce(sum(amount), 0) from c where status = 'pending'),
    'skippedCommission',(select coalesce(sum(amount), 0) from c where status = 'skipped'),
    'totalIncome',      (select coalesce(sum(amount), 0) from c where status = 'credited'),
    'todayIncome',      (select coalesce(sum(amount), 0) from c, t
                          where status = 'credited' and local_at::date = t.local_now::date),
    'weeklyIncome',     (select coalesce(sum(amount), 0) from c, t
                          where status = 'credited' and local_at >= date_trunc('week', t.local_now)),
    'monthlyIncome',    (select coalesce(sum(amount), 0) from c, t
                          where status = 'credited' and local_at >= date_trunc('month', t.local_now)),
    'directIncome',     (select coalesce(sum(amount), 0) from c where status = 'credited' and level = 0),
    'gen1Income',       (select coalesce(sum(amount), 0) from c where status = 'credited' and level = 1),
    'gen2Income',       (select coalesce(sum(amount), 0) from c where status = 'credited' and level = 2),
    'gen3Income',       (select coalesce(sum(amount), 0) from c where status = 'credited' and level = 3),
    'generationIncome', coalesce((select jsonb_object_agg(level, total order by level) from
                          (select level, sum(amount) as total from c where status = 'credited' and level > 0 group by level) g),
                          '{}'::jsonb),
    'ownTurnover',      (select coalesce(sum(amount), 0) from purchases where user_id = p_user and status = 'paid'),
    'teamTurnover',     (select coalesce(sum(pu.amount), 0) from purchases pu join profiles p on p.id = pu.user_id
                          where pu.status = 'paid' and p.ancestors @> array[p_user]),
    'totalWithdrawn',   (select coalesce(sum(net_amount), 0) from withdrawals where user_id = p_user and status = 'paid'),
    'totalCharges',     (select coalesce(sum(charge_amount), 0) from withdrawals where user_id = p_user and status = 'paid')
  )
$$;

-- Same privileges as 0002: only the API (service_role) may call these.
revoke all on function process_commissions(uuid) from public;
revoke all on function wallet_summary(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function process_commissions(uuid) from anon, authenticated;
    revoke all on function wallet_summary(uuid) from anon, authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function process_commissions(uuid) to service_role;
    grant execute on function wallet_summary(uuid) to service_role;
  end if;
end $$;
