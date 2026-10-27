-- SKILLSEARN — commission model v2 (client clarification, Oct 2026)
--
--  • Generation income  (G1–G3): uses the Direct Commission D, paid only up to the generation the
--    beneficiary's package allows (Gold G1 · Platinum G1–G2 · Diamond G1–G3).
--  • Turnover income    (G4+):   uses the previous three generations' amounts only, paid to every
--    upline holding any active package, down to commission.maxGenerations.
--  Rates cycle 15% · 12% · 8%. Ineligible amounts are never passed to anyone else.

update app_settings set value = value || '{"maxGenerations": 50}' where key = 'commission';

alter table commissions drop constraint if exists commissions_level_check;
alter table commissions add constraint commissions_level_check check (level between 0 and 100);

-- package.max_generations now describes eligibility for G1–G3 only.
update packages set max_generations = least(max_generations, 3);
alter table packages drop constraint if exists packages_max_generations_check;
alter table packages add constraint packages_max_generations_check check (max_generations between 0 and 3);

update packages set features = array_append(features, 'Turnover income from Generation 4 onwards')
 where not ('Turnover income from Generation 4 onwards' = any(features));

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
  v_max_gen int := least(100, greatest(3, coalesce((v_cset->>'maxGenerations')::int, 50)));
  v_depth int;
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

  -- Only as deep as the purchaser's upline actually goes.
  v_depth := least(v_max_gen, greatest(0, coalesce(array_length(v_buyer.ancestors, 1), 0) - 1));
  amt := array_fill(0::numeric, array[v_depth + 1]);
  calc := array_fill(''::text, array[v_depth + 1]);

  amt[1] := money_round(v_pur.commission_base * v_pkg.direct_rate_bps / 10000.0);
  calc[1] := fmt_inr(v_pur.commission_base) || ' × ' || fmt_pct(v_pkg.direct_rate_bps) || ' = ' || fmt_inr(amt[1]);

  -- With G0 = D: Gn = G(n-1)×r1 + G(n-2)×r2 + G(n-3)×r3, so D only feeds G1–G3.
  for n in 1..v_depth loop
    for j in greatest(0, n - 3)..(n - 1) loop
      term := money_round(amt[j + 1] * r[n - j] / 10000.0);
      amt[n + 1] := amt[n + 1] + term;
      calc[n + 1] := calc[n + 1] || case when j > greatest(0, n - 3) then ' + ' else '' end
                     || '(' || fmt_inr(amt[j + 1]) || ' × ' || fmt_pct(r[n - j]) || ')';
    end loop;
    calc[n + 1] := calc[n + 1] || ' = ' || fmt_inr(amt[n + 1]);
  end loop;

  for lvl in 0..v_depth loop
    exit when array_length(v_buyer.ancestors, 1) is null or lvl + 1 > array_length(v_buyer.ancestors, 1);
    -- Turnover amounts shrink every generation; once one rounds to ₹0 all deeper ones do too.
    exit when lvl > 3 and amt[lvl + 1] <= 0;

    select * into v_ben from profiles where id = v_buyer.ancestors[lvl + 1];
    select max_generations into v_ben_max from packages where id = v_ben.active_package_id;

    v_status := case when v_hold_days > 0 then 'pending' else 'credited' end;
    v_reason := null;
    if v_ben.status <> 'active' then
      v_status := 'skipped'; v_reason := 'Beneficiary account suspended';
    elsif v_ben.active_package_id is null and (lvl > 0 or v_direct_needs_pkg) then
      v_status := 'skipped'; v_reason := 'Beneficiary has no active package';
    elsif lvl between 1 and 3 and coalesce(v_ben_max, 0) < lvl then
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
             when lvl <= 3 then format('Generation %s commission from %s', lvl, v_buyer.user_code)
             else format('Turnover income (generation %s) from %s', lvl, v_buyer.user_code) end,
        v_pur.id, v_comm.id, null, lvl::smallint,
        jsonb_build_object('calculation', v_comm.calculation, 'rule_version', v_rule.id));
      perform notify_user(v_ben.id, 'commission',
        case when lvl = 0 then 'Direct commission credited'
             when lvl <= 3 then format('Generation %s commission credited', lvl)
             else format('Turnover income credited (generation %s)', lvl) end,
        fmt_inr(v_comm.amount) || ' from ' || v_buyer.full_name || ' (' || v_buyer.user_code || ')', '/app/income');
    end if;
  end loop;

  update purchases set commission_status = 'processed', commission_processed_at = now() where id = v_pur.id;
  return v_count;
end $$;

create or replace function release_pending_commissions() returns int
language plpgsql as $$
declare
  c record;
  v_count int := 0;
begin
  for c in
    select cm.*, p.user_code as source_code
      from commissions cm
      join profiles p on p.id = cm.source_user_id
     where cm.status = 'pending' and cm.available_at <= now()
     order by cm.available_at
     for update of cm skip locked
  loop
    continue when (select status from profiles where id = c.beneficiary_id) <> 'active';
    perform ledger_post(c.beneficiary_id,
      case when c.level = 0 then 'direct_commission' else 'generation_commission' end,
      c.amount,
      case when c.level = 0 then 'Direct referral commission from ' || c.source_code
           when c.level <= 3 then format('Generation %s commission from %s', c.level, c.source_code)
           else format('Turnover income (generation %s) from %s', c.level, c.source_code) end,
      c.purchase_id, c.id, null, c.level, jsonb_build_object('calculation', c.calculation));
    update commissions set status = 'credited', credited_at = now() where id = c.id;
    perform notify_user(c.beneficiary_id, 'commission', 'Commission released to wallet', fmt_inr(c.amount), '/app/income');
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

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
    'turnoverIncome',   (select coalesce(sum(amount), 0) from c where status = 'credited' and level > 3),
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

-- generationCommissions = G1–G3 only; turnoverCommissions = G4+.
create or replace function admin_dashboard() returns jsonb
language sql stable as $$
  with t as (select (now() at time zone 'Asia/Kolkata')::date as today)
  select jsonb_build_object(
    'totalUsers',        (select count(*) from profiles where role = 'user'),
    'activeUsers',       (select count(*) from profiles where role = 'user' and status = 'active' and active_package_id is not null),
    'suspendedUsers',    (select count(*) from profiles where status = 'suspended'),
    'newUsersToday',     (select count(*) from profiles, t where role = 'user' and (created_at at time zone 'Asia/Kolkata')::date = t.today),
    'packageWiseUsers',  coalesce((select jsonb_agg(jsonb_build_object('package', pk.name, 'level', pk.level, 'users',
                           (select count(*) from profiles p where p.active_package_id = pk.id)) order by pk.level)
                           from packages pk), '[]'::jsonb),
    'totalSalesCount',   (select count(*) from purchases where status = 'paid'),
    'verifiedPaymentAmount', (select coalesce(sum(amount), 0) from purchases where status = 'paid'),
    'newPackageSales',   (select coalesce(sum(amount), 0) from purchases where status = 'paid' and type = 'new'),
    'upgradeSales',      (select coalesce(sum(amount), 0) from purchases where status = 'paid' and type = 'upgrade'),
    'salesToday',        (select coalesce(sum(amount), 0) from purchases, t where status = 'paid' and (paid_at at time zone 'Asia/Kolkata')::date = t.today),
    'pendingPayments',   (select count(*) from purchases where status = 'pending'),
    'directCommissions', (select coalesce(sum(amount), 0) from commissions where status = 'credited' and level = 0),
    'generationCommissions', (select coalesce(sum(amount), 0) from commissions where status = 'credited' and level between 1 and 3),
    'turnoverCommissions',   (select coalesce(sum(amount), 0) from commissions where status = 'credited' and level > 3),
    'pendingCommissions',(select coalesce(sum(amount), 0) from commissions where status = 'pending'),
    'skippedCommissions',(select coalesce(sum(amount), 0) from commissions where status = 'skipped'),
    'pendingWithdrawalsCount',  (select count(*) from withdrawals where status in ('requested','under_review','approved','processing')),
    'pendingWithdrawalsAmount', (select coalesce(sum(gross_amount), 0) from withdrawals where status in ('requested','under_review','approved','processing')),
    'successfulPayouts', (select coalesce(sum(net_amount), 0) from withdrawals where status = 'paid'),
    'platformCharges',   (select coalesce(sum(charge_amount), 0) from withdrawals where status = 'paid'),
    'walletLiability',   (select coalesce(sum(amount), 0) from wallet_ledger),
    'courseEnrolments',  (select count(*) from enrolments),
    'openFraudAlerts',   (select count(*) from fraud_alerts where resolved_at is null)
  )
$$;

-- Same privileges as 0002: only the API (service_role) may call these.
do $$
declare f text;
begin
  foreach f in array array['process_commissions(uuid)', 'release_pending_commissions()', 'wallet_summary(uuid)', 'admin_dashboard()'] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon, authenticated', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;
