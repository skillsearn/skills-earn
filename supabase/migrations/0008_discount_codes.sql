-- 0008 · Admin discount codes ("Discount Referral")
--
-- * Only the admin creates codes (Admin → Discount Codes): a % or flat ₹ discount,
--   optional max uses and expiry, on/off toggle.
-- * A member enters the code at checkout. The purchase `amount` becomes what the
--   member actually pays, so every sales/income figure (dashboard, reports, exports)
--   is automatically the admin's real income after the discount.
--   `list_amount` keeps the original price and `discount_amount` the discount.
-- * Commissions follow the money actually paid: `commission_base` is scaled by
--   amount / list_amount. A 100 % discount → amount ₹0, no commissions, and the
--   package is activated without the gateway (provider = 'discount').

create table if not exists discount_codes (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique check (code ~ '^[A-Z0-9_-]{3,30}$'),
  discount_type   text not null check (discount_type in ('percent', 'flat')),
  discount_value  numeric(14,2) not null check (discount_value > 0),
  max_uses        int check (max_uses is null or max_uses > 0),
  expires_at      timestamptz,
  is_active       boolean not null default true,
  note            text,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (discount_type <> 'percent' or discount_value <= 100)
);
alter table discount_codes enable row level security;
drop trigger if exists t_discount_codes on discount_codes;
create trigger t_discount_codes before update on discount_codes for each row execute function touch_updated_at();

alter table purchases
  add column if not exists list_amount          numeric(14,2),
  add column if not exists list_commission_base numeric(14,2),
  add column if not exists discount_amount      numeric(14,2) not null default 0,
  add column if not exists discount_code_id     uuid references discount_codes(id);
create index if not exists purchases_discount_code_idx on purchases(discount_code_id) where discount_code_id is not null;

-- A fully discounted purchase is worth ₹0.
alter table purchases drop constraint if exists purchases_amount_check;
alter table purchases add constraint purchases_amount_check check (amount >= 0);
alter table purchases drop constraint if exists purchases_provider_check;
alter table purchases add constraint purchases_provider_check check (provider in ('razorpay', 'mock', 'manual', 'discount'));

-- Applies (p_code) or removes (p_code null) a discount code on a member's unpaid purchase.
create or replace function apply_discount(p_purchase_id uuid, p_user_id uuid, p_code text)
returns jsonb language plpgsql as $$
declare
  v_pur   purchases;
  v_dc    discount_codes;
  v_list  numeric(14,2);
  v_base  numeric(14,2);
  v_disc  numeric(14,2) := 0;
  v_amt   numeric(14,2);
  v_cb    numeric(14,2);
  v_used  int;
begin
  select * into v_pur from purchases where id = p_purchase_id for update;
  if not found or v_pur.user_id <> p_user_id then raise exception 'PURCHASE_NOT_FOUND: purchase not found'; end if;
  if v_pur.status not in ('pending', 'failed') then
    raise exception 'PURCHASE_NOT_PAYABLE: purchase is %', v_pur.status;
  end if;
  if v_pur.status = 'pending' and v_pur.manual_proof_path is not null then
    raise exception 'PROOF_SUBMITTED: a payment screenshot is already under review for this purchase';
  end if;

  v_list := coalesce(v_pur.list_amount, v_pur.amount);
  v_base := coalesce(v_pur.list_commission_base, v_pur.commission_base);

  if p_code is not null and btrim(p_code) <> '' then
    select * into v_dc from discount_codes where code = upper(btrim(p_code)) for update;
    if not found or not v_dc.is_active then raise exception 'INVALID_DISCOUNT: this discount code is not valid'; end if;
    if v_dc.expires_at is not null and v_dc.expires_at <= now() then
      raise exception 'DISCOUNT_EXPIRED: this discount code has expired';
    end if;
    if v_dc.max_uses is not null then
      select count(*) into v_used from purchases where discount_code_id = v_dc.id and status = 'paid';
      if v_used >= v_dc.max_uses then raise exception 'DISCOUNT_USED_UP: this discount code has reached its usage limit'; end if;
    end if;
    v_disc := case when v_dc.discount_type = 'percent'
                   then money_round(v_list * v_dc.discount_value / 100.0)
                   else least(v_dc.discount_value, v_list) end;
  end if;

  v_amt := v_list - v_disc;
  if v_amt > 0 and v_amt < 1 then
    raise exception 'DISCOUNT_TOO_SMALL_REMAINDER: the amount after discount must be ₹0 or at least ₹1';
  end if;
  v_cb := case when v_list > 0 then money_round(v_base * v_amt / v_list) else 0 end;

  update purchases set
    amount = v_amt,
    list_amount = case when v_dc.id is null then null else v_list end,
    list_commission_base = case when v_dc.id is null then null else v_base end,
    discount_amount = v_disc,
    discount_code_id = v_dc.id,
    commission_base = v_cb,
    commission_status = case when v_cb > 0 then 'pending' else 'not_applicable' end,
    -- the old gateway order carried the old amount; a fresh one is created on next checkout
    provider_order_id = null,
    provider = null
  where id = v_pur.id;

  return jsonb_build_object('listAmount', v_list, 'discount', v_disc, 'amount', v_amt, 'code', v_dc.code);
end $$;

-- generationCommissions = G1–G3 only; turnoverCommissions = G4+.
-- verifiedPaymentAmount is net of discounts (what members actually paid = admin income).
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
    'grossSalesAmount',  (select coalesce(sum(coalesce(list_amount, amount)), 0) from purchases where status = 'paid'),
    'discountsGiven',    (select coalesce(sum(discount_amount), 0) from purchases where status = 'paid'),
    'discountedSalesCount', (select count(*) from purchases where status = 'paid' and discount_code_id is not null),
    'freeActivations',   (select count(*) from purchases where status = 'paid' and amount = 0),
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

do $$
declare f text;
begin
  foreach f in array array['apply_discount(uuid, uuid, text)', 'admin_dashboard()'] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon, authenticated', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;
