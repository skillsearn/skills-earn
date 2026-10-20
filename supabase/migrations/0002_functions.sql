-- SKILLSEARN — financial engine & read models
-- Every money-moving operation is a single function = a single transaction.
-- Errors are raised as 'CODE: message' and mapped to HTTP 400 by the API.

-- ───────────────────────── helpers ─────────────────────────
create or replace function get_setting(p_key text) returns jsonb
language sql stable as $$
  select coalesce((select value from app_settings where key = p_key), '{}'::jsonb)
$$;

create or replace function money_round(p numeric) returns numeric
language sql immutable as $$ select round(p, 2) $$;

create or replace function fmt_inr(p numeric) returns text
language sql immutable as $$ select '₹' || to_char(p, 'FM9999999990.00') $$;

create or replace function fmt_pct(p_bps int) returns text
language sql immutable as $$ select trim(trailing '.' from trim(trailing '0' from to_char(p_bps / 100.0, 'FM990.00'))) || '%' $$;

create or replace function write_audit(
  p_actor uuid, p_action text, p_entity text, p_entity_id text,
  p_before jsonb default null, p_after jsonb default null, p_ip text default null
) returns void language sql as $$
  insert into audit_logs(actor_id, action, entity, entity_id, before, after, ip)
  values (p_actor, p_action, p_entity, p_entity_id, p_before, p_after, p_ip)
$$;

create or replace function notify_user(
  p_user uuid, p_type text, p_title text, p_body text default null, p_link text default null
) returns void language sql as $$
  insert into notifications(user_id, type, title, body, link) values (p_user, p_type, p_title, p_body, p_link)
$$;

create or replace function gen_referral_code() returns text
language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  i int;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from profiles where referral_code = code);
  end loop;
  return code;
end $$;

-- Append a ledger row with a running balance. Locks the user's profile row so
-- concurrent postings for the same user are serialised.
create or replace function ledger_post(
  p_user uuid, p_type text, p_amount numeric, p_description text,
  p_purchase uuid default null, p_commission uuid default null, p_withdrawal uuid default null,
  p_generation smallint default null, p_meta jsonb default null, p_actor uuid default null
) returns wallet_ledger
language plpgsql as $$
declare
  v_balance numeric;
  v_row wallet_ledger;
begin
  perform 1 from profiles where id = p_user for update;
  if not found then raise exception 'USER_NOT_FOUND: user % not found', p_user; end if;

  select coalesce(sum(amount), 0) into v_balance from wallet_ledger where user_id = p_user;
  v_balance := v_balance + money_round(p_amount);
  if v_balance < 0 then
    raise exception 'INSUFFICIENT_BALANCE: wallet balance is not sufficient';
  end if;

  insert into wallet_ledger(txn_id, user_id, type, amount, balance_after, purchase_id,
                            commission_id, withdrawal_id, generation, description, meta, created_by)
  values ('TXN' || lpad(nextval('txn_seq')::text, 10, '0'), p_user, p_type, money_round(p_amount),
          v_balance, p_purchase, p_commission, p_withdrawal, p_generation, p_description, p_meta, p_actor)
  returning * into v_row;
  return v_row;
end $$;

-- ───────────────────────── registration ─────────────────────────
create or replace function create_profile(
  p_id uuid, p_full_name text, p_email text, p_mobile text,
  p_sponsor_code text default null, p_ip text default null, p_role text default 'user'
) returns profiles
language plpgsql as $$
declare
  v_sponsor profiles;
  v_row profiles;
  v_recent int;
begin
  if coalesce(trim(p_sponsor_code), '') <> '' then
    select * into v_sponsor from profiles where referral_code = upper(trim(p_sponsor_code));
    if not found then raise exception 'INVALID_REFERRAL: referral code not found'; end if;
    if v_sponsor.status <> 'active' then raise exception 'INVALID_REFERRAL: referrer account is not active'; end if;
    if lower(v_sponsor.email) = lower(p_email) or v_sponsor.mobile = p_mobile or v_sponsor.id = p_id then
      raise exception 'SELF_REFERRAL: you cannot use your own referral code';
    end if;
  elsif p_role = 'user' and coalesce((get_setting('registration')->>'referralRequired')::boolean, false) then
    raise exception 'REFERRAL_REQUIRED: a referral code is required to register';
  end if;

  insert into profiles(id, user_code, full_name, email, mobile, referral_code,
                       sponsor_id, ancestors, role, registration_ip)
  values (p_id, 'SE' || nextval('user_code_seq'), trim(p_full_name), lower(trim(p_email)), p_mobile,
          gen_referral_code(), v_sponsor.id,
          case when v_sponsor.id is null then '{}'::uuid[] else array_prepend(v_sponsor.id, v_sponsor.ancestors) end,
          p_role, p_ip)
  returning * into v_row;

  if p_ip is not null then
    select count(*) into v_recent from profiles
     where registration_ip = p_ip and created_at > now() - interval '24 hours';
    if v_recent > 3 then
      insert into fraud_alerts(type, severity, user_id, details)
      values ('ip_registration_burst', case when v_recent > 6 then 'high' else 'medium' end, v_row.id,
              jsonb_build_object('ip', p_ip, 'registrations_24h', v_recent, 'sponsor_id', v_sponsor.id));
    end if;
  end if;

  return v_row;
end $$;

-- ───────────────────────── commission engine ─────────────────────────
-- D  = base × direct_rate(purchased package)
-- G1 = D×r1 ; G2 = D×r2 + G1×r1 ; G3 = D×r3 + G1×r2 + G2×r1   (each term rounded to ₹0.01)
-- Beneficiaries: direct = ancestors[1]; Gn = ancestors[n+1]. Eligibility checked independently.
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
  r int[];
  amt numeric[] := array[0,0,0,0];   -- amt[1]=D, amt[2]=G1, amt[3]=G2, amt[4]=G3
  calc text[] := array['','','',''];
  term numeric;
  n int; k int;
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

  amt[1] := money_round(v_pur.commission_base * v_pkg.direct_rate_bps / 10000.0);
  calc[1] := fmt_inr(v_pur.commission_base) || ' × ' || fmt_pct(v_pkg.direct_rate_bps) || ' = ' || fmt_inr(amt[1]);

  for n in 1..3 loop
    term := money_round(amt[1] * r[n] / 10000.0);
    amt[n + 1] := term;
    calc[n + 1] := '(' || fmt_inr(amt[1]) || ' × ' || fmt_pct(r[n]) || ')';
    for k in 1..(n - 1) loop
      term := money_round(amt[k + 1] * r[n - k] / 10000.0);
      amt[n + 1] := amt[n + 1] + term;
      calc[n + 1] := calc[n + 1] || ' + (' || fmt_inr(amt[k + 1]) || ' × ' || fmt_pct(r[n - k]) || ')';
    end loop;
    calc[n + 1] := calc[n + 1] || ' = ' || fmt_inr(amt[n + 1]);
  end loop;

  for lvl in 0..3 loop
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
            case when lvl = 0 then v_pkg.direct_rate_bps else r[lvl] end,
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
           else format('Generation %s commission from %s', c.level, c.source_code) end,
      c.purchase_id, c.id, null, c.level, jsonb_build_object('calculation', c.calculation));
    update commissions set status = 'credited', credited_at = now() where id = c.id;
    perform notify_user(c.beneficiary_id, 'commission', 'Commission released to wallet', fmt_inr(c.amount), '/app/income');
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ───────────────────────── purchase activation ─────────────────────────
create or replace function activate_purchase(
  p_purchase_id uuid, p_provider text, p_payment_id text default null, p_verified_by uuid default null
) returns jsonb
language plpgsql as $$
declare
  v_pur purchases;
  v_prof profiles;
  v_pkg packages;
begin
  select * into v_pur from purchases where id = p_purchase_id for update;
  if not found then raise exception 'PURCHASE_NOT_FOUND: purchase not found'; end if;

  if v_pur.status = 'paid' then
    if p_payment_id is not null and v_pur.provider_payment_id is distinct from p_payment_id then
      insert into fraud_alerts(type, severity, user_id, purchase_id, details)
      values ('duplicate_payment', 'high', v_pur.user_id, v_pur.id,
              jsonb_build_object('existing_payment', v_pur.provider_payment_id, 'new_payment', p_payment_id));
    end if;
    return jsonb_build_object('status', 'already_paid', 'purchaseId', v_pur.id);
  end if;
  if v_pur.status not in ('pending', 'failed') then
    raise exception 'PURCHASE_NOT_PAYABLE: purchase is %', v_pur.status;
  end if;

  select * into v_prof from profiles where id = v_pur.user_id for update;
  select * into v_pkg from packages where id = v_pur.package_id;

  if v_pur.type = 'new' and v_prof.active_package_id is not null then
    raise exception 'ALREADY_ACTIVE: user already has an active package; use upgrade';
  end if;
  if v_pur.type = 'upgrade' and v_prof.active_package_id is distinct from v_pur.from_package_id then
    raise exception 'UPGRADE_CONFLICT: current package changed since the upgrade was created';
  end if;

  update purchases
     set status = 'paid', provider = coalesce(p_provider, provider),
         provider_payment_id = coalesce(p_payment_id, provider_payment_id),
         paid_at = now(), verified_by = p_verified_by
   where id = v_pur.id;

  update profiles
     set active_package_id = v_pur.package_id,
         package_activated_at = case when v_pur.type = 'new' then now() else package_activated_at end
   where id = v_prof.id;

  perform notify_user(v_prof.id, 'purchase',
    case when v_pur.type = 'new' then v_pkg.name || ' package activated' else 'Upgraded to ' || v_pkg.name end,
    'Payment of ' || fmt_inr(v_pur.amount) || ' verified.', '/app/purchases');

  if v_pur.commission_status = 'pending' then
    perform process_commissions(v_pur.id);
  end if;

  return jsonb_build_object('status', 'activated', 'purchaseId', v_pur.id, 'packageId', v_pur.package_id);
end $$;

-- ───────────────────────── withdrawals ─────────────────────────
create or replace function withdrawal_window_open(p_settings jsonb, p_at timestamptz default now())
returns boolean language plpgsql stable as $$
declare
  v_local timestamp := p_at at time zone 'Asia/Kolkata';
  v_days int := greatest(1, coalesce((p_settings->>'windowDays')::int, 1));
  v_dow int; v_dom int; v_start int;
begin
  if coalesce(p_settings->>'mode', 'weekly') = 'weekly' then
    v_dow := extract(dow from v_local)::int;
    v_start := coalesce((p_settings->>'weeklyDay')::int, 1);
    return ((v_dow - v_start + 7) % 7) < v_days;
  else
    v_dom := extract(day from v_local)::int;
    v_start := coalesce((p_settings->>'monthlyDay')::int, 1);
    return v_dom >= v_start and v_dom < v_start + v_days;
  end if;
end $$;

create or replace function request_withdrawal(
  p_user uuid, p_amount numeric, p_method text, p_details jsonb
) returns withdrawals
language plpgsql as $$
declare
  s jsonb := get_setting('withdrawal');
  v_amount numeric := money_round(p_amount);
  v_bps int := coalesce((s->>'chargeBps')::int, 500);
  v_charge numeric;
  v_prof profiles;
  v_w withdrawals;
begin
  select * into v_prof from profiles where id = p_user for update;
  if not found then raise exception 'USER_NOT_FOUND: user not found'; end if;
  if v_prof.status <> 'active' then raise exception 'ACCOUNT_SUSPENDED: account is suspended'; end if;
  if not coalesce((s->>'processingEnabled')::boolean, true) then
    raise exception 'WITHDRAWALS_PAUSED: withdrawals are temporarily paused';
  end if;
  if not withdrawal_window_open(s) then
    raise exception 'WINDOW_CLOSED: withdrawal requests are not open today';
  end if;
  if v_amount < coalesce((s->>'minAmount')::numeric, 0) then
    raise exception 'BELOW_MINIMUM: minimum withdrawal is %', fmt_inr((s->>'minAmount')::numeric);
  end if;
  if exists (select 1 from withdrawals where user_id = p_user
             and status in ('requested','under_review','approved','processing')) then
    raise exception 'OPEN_REQUEST_EXISTS: you already have a withdrawal in progress';
  end if;

  v_charge := money_round(v_amount * v_bps / 10000.0);

  insert into withdrawals(user_id, gross_amount, charge_bps, charge_amount, net_amount, method, payout_details)
  values (p_user, v_amount, v_bps, v_charge, v_amount - v_charge, p_method, p_details)
  returning * into v_w;

  insert into withdrawal_events(withdrawal_id, from_status, to_status, actor_id)
  values (v_w.id, null, 'requested', p_user);

  perform ledger_post(p_user, 'withdrawal_hold', -v_amount, 'Withdrawal request hold',
                      null, null, v_w.id, null,
                      jsonb_build_object('gross', v_amount, 'charge', v_charge, 'net', v_amount - v_charge));

  perform notify_user(p_user, 'withdrawal', 'Withdrawal requested',
    'Gross ' || fmt_inr(v_amount) || ' · charge ' || fmt_inr(v_charge) || ' · net ' || fmt_inr(v_amount - v_charge),
    '/app/withdrawals');
  return v_w;
end $$;

create or replace function transition_withdrawal(
  p_id uuid, p_to text, p_actor uuid, p_note text default null, p_reference text default null
) returns withdrawals
language plpgsql as $$
declare
  v_w withdrawals;
  v_before jsonb;
  v_allowed boolean;
begin
  select * into v_w from withdrawals where id = p_id for update;
  if not found then raise exception 'WITHDRAWAL_NOT_FOUND: withdrawal not found'; end if;
  v_before := to_jsonb(v_w);

  v_allowed := case v_w.status
    when 'requested'    then p_to in ('under_review','approved','rejected')
    when 'under_review' then p_to in ('approved','rejected')
    when 'approved'     then p_to in ('processing','paid','rejected')
    when 'processing'   then p_to in ('paid','failed')
    else false end;
  if not v_allowed then
    raise exception 'INVALID_TRANSITION: cannot move withdrawal from % to %', v_w.status, p_to;
  end if;

  if p_to = 'paid' then
    if coalesce(trim(p_reference), '') = '' then
      raise exception 'REFERENCE_REQUIRED: payment reference is required to mark as paid';
    end if;
    perform ledger_post(v_w.user_id, 'withdrawal_hold_release', v_w.gross_amount,
                        'Withdrawal hold released for payout', null, null, v_w.id, null, null, p_actor);
    perform ledger_post(v_w.user_id, 'successful_withdrawal', -v_w.net_amount,
                        'Withdrawal paid · ref ' || trim(p_reference), null, null, v_w.id, null,
                        jsonb_build_object('reference', trim(p_reference)), p_actor);
    if v_w.charge_amount > 0 then
      perform ledger_post(v_w.user_id, 'platform_charge', -v_w.charge_amount,
                          'Platform charge ' || fmt_pct(v_w.charge_bps) || ' on ' || fmt_inr(v_w.gross_amount),
                          null, null, v_w.id, null, null, p_actor);
    end if;
  elsif p_to in ('rejected', 'failed') then
    perform ledger_post(v_w.user_id, 'failed_withdrawal_release', v_w.gross_amount,
                        case when p_to = 'rejected' then 'Withdrawal rejected · amount released'
                             else 'Payout failed · amount released' end,
                        null, null, v_w.id, null, jsonb_build_object('reason', p_note), p_actor);
  end if;

  update withdrawals
     set status = p_to,
         admin_note = coalesce(p_note, admin_note),
         payment_reference = coalesce(nullif(trim(p_reference), ''), payment_reference),
         reviewed_by = p_actor,
         paid_at = case when p_to = 'paid' then now() else paid_at end
   where id = p_id
   returning * into v_w;

  insert into withdrawal_events(withdrawal_id, from_status, to_status, actor_id, note)
  values (p_id, v_before->>'status', p_to, p_actor, coalesce(p_note, p_reference));

  perform write_audit(p_actor, 'withdrawal.' || p_to, 'withdrawal', p_id::text, v_before, to_jsonb(v_w));

  perform notify_user(v_w.user_id, 'withdrawal',
    case p_to
      when 'paid' then 'Withdrawal paid: ' || fmt_inr(v_w.net_amount)
      when 'rejected' then 'Withdrawal rejected'
      when 'failed' then 'Payout failed, amount returned to wallet'
      else 'Withdrawal ' || replace(p_to, '_', ' ') end,
    p_note, '/app/withdrawals');
  return v_w;
end $$;

-- ───────────────────────── admin adjustments ─────────────────────────
create or replace function admin_adjust_wallet(p_user uuid, p_amount numeric, p_reason text, p_actor uuid)
returns wallet_ledger
language plpgsql as $$
declare v_row wallet_ledger;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'REASON_REQUIRED: a reason is required'; end if;
  v_row := ledger_post(p_user, 'admin_adjustment', p_amount, 'Admin adjustment: ' || trim(p_reason),
                       null, null, null, null, jsonb_build_object('reason', trim(p_reason)), p_actor);
  perform write_audit(p_actor, 'wallet.adjust', 'profile', p_user::text, null, to_jsonb(v_row));
  perform notify_user(p_user, 'wallet', 'Wallet adjusted', fmt_inr(p_amount) || ' · ' || trim(p_reason), '/app/income');
  return v_row;
end $$;

-- ───────────────────────── read models ─────────────────────────
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
    'totalWithdrawn',   (select coalesce(sum(net_amount), 0) from withdrawals where user_id = p_user and status = 'paid'),
    'totalCharges',     (select coalesce(sum(charge_amount), 0) from withdrawals where user_id = p_user and status = 'paid')
  )
$$;

create or replace function get_downline(
  p_user uuid, p_max_depth int default 4, p_depth int default null,
  p_search text default null, p_limit int default 50, p_offset int default 0
) returns table (
  id uuid, user_code text, full_name text, depth int, sponsor_code text,
  package_name text, package_level int, status text, is_active boolean,
  joined_at timestamptz, total_count bigint
) language sql stable as $$
  select p.id, p.user_code, p.full_name, array_position(p.ancestors, p_user) as depth,
         s.user_code as sponsor_code, pk.name, pk.level, p.status,
         (p.active_package_id is not null and p.status = 'active') as is_active,
         p.created_at, count(*) over () as total_count
    from profiles p
    left join profiles s on s.id = p.sponsor_id
    left join packages pk on pk.id = p.active_package_id
   where p.ancestors @> array[p_user]
     and array_position(p.ancestors, p_user) <= p_max_depth
     and (p_depth is null or array_position(p.ancestors, p_user) = p_depth)
     and (p_search is null or p.full_name ilike '%' || p_search || '%' or p.user_code ilike '%' || p_search || '%')
   order by depth, p.created_at
   limit p_limit offset p_offset
$$;

create or replace function team_summary(p_user uuid) returns jsonb
language sql stable as $$
  with d as (
    select array_position(ancestors, p_user) as depth,
           (active_package_id is not null and status = 'active') as active
      from profiles where ancestors @> array[p_user]
  )
  select jsonb_build_object(
    'directReferrals', (select count(*) from d where depth = 1),
    'totalDownline',   (select count(*) from d),
    'active',          (select count(*) from d where active),
    'inactive',        (select count(*) from d where not active),
    'byDepth', coalesce((select jsonb_object_agg(depth, cnt) from
                 (select depth, count(*) as cnt from d group by depth order by depth) x), '{}'::jsonb)
  )
$$;

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
    'generationCommissions', (select coalesce(sum(amount), 0) from commissions where status = 'credited' and level > 0),
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

create or replace function admin_report(p_period text, p_from date, p_to date)
returns table (
  bucket date, signups bigint, sales_count bigint, sales_amount numeric,
  direct_commission numeric, generation_commission numeric, payouts numeric, charges numeric
) language sql stable as $$
  with b as (
    select generate_series(date_trunc(p_period, p_from::timestamp), date_trunc(p_period, p_to::timestamp),
                           ('1 ' || p_period)::interval)::date as bucket
  )
  select b.bucket,
    (select count(*) from profiles where role = 'user'
       and date_trunc(p_period, created_at at time zone 'Asia/Kolkata')::date = b.bucket),
    (select count(*) from purchases where status = 'paid'
       and date_trunc(p_period, paid_at at time zone 'Asia/Kolkata')::date = b.bucket),
    (select coalesce(sum(amount), 0) from purchases where status = 'paid'
       and date_trunc(p_period, paid_at at time zone 'Asia/Kolkata')::date = b.bucket),
    (select coalesce(sum(amount), 0) from commissions where status = 'credited' and level = 0
       and date_trunc(p_period, credited_at at time zone 'Asia/Kolkata')::date = b.bucket),
    (select coalesce(sum(amount), 0) from commissions where status = 'credited' and level > 0
       and date_trunc(p_period, credited_at at time zone 'Asia/Kolkata')::date = b.bucket),
    (select coalesce(sum(net_amount), 0) from withdrawals where status = 'paid'
       and date_trunc(p_period, paid_at at time zone 'Asia/Kolkata')::date = b.bucket),
    (select coalesce(sum(charge_amount), 0) from withdrawals where status = 'paid'
       and date_trunc(p_period, paid_at at time zone 'Asia/Kolkata')::date = b.bucket)
  from b order by b.bucket
$$;

create or replace function broadcast_announcement(p_title text, p_body text, p_actor uuid)
returns announcements language plpgsql as $$
declare v_a announcements;
begin
  insert into announcements(title, body, created_by) values (p_title, p_body, p_actor) returning * into v_a;
  insert into notifications(user_id, type, title, body)
    select id, 'announcement', p_title, p_body from profiles where status = 'active';
  perform write_audit(p_actor, 'announcement.create', 'announcement', v_a.id::text, null, to_jsonb(v_a));
  return v_a;
end $$;

-- ───────────────────────── privileges ─────────────────────────
-- Functions are callable only by the API (service_role).
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon, authenticated', f.sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
end $$;
