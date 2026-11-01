-- SKILLSEARN — discount code test. Runs in a transaction and rolls back.
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/discount_test.sql
begin;

create temp table ids(name text primary key, id uuid);
update app_settings set value = value || '{"referralRequired": false}' where key = 'registration';

do $$
declare n text; v_id uuid; v_sponsor text;
begin
  foreach n in array array['boss','buyer1','buyer2','buyer3'] loop
    v_id := gen_random_uuid();
    insert into auth.users(id, email) values (v_id, n || '@test.local');
    v_sponsor := case when n = 'boss' then null
                      else (select referral_code from profiles where id = (select id from ids where name = 'boss')) end;
    perform create_profile(v_id, initcap(n), n || '@test.local', '+91900000100' || length(n) || substr(n, length(n)), v_sponsor);
    insert into ids values (n, v_id);
  end loop;
  update profiles set active_package_id = (select id from packages where slug = 'diamond') where id = (select id from ids where name = 'boss');
end $$;

insert into discount_codes(code, discount_type, discount_value, max_uses) values
  ('HALF', 'percent', 50, null), ('FREE100', 'percent', 100, 1), ('FLAT9999', 'flat', 9999, null);

create or replace function pg_temp.newp(p_user text) returns uuid language sql as $$
  insert into purchases(user_id, package_id, type, amount, commission_base)
  select (select id from ids where name = p_user), id, 'new', price, price from packages where slug = 'gold'
  returning id $$;

do $$
declare p uuid; r jsonb; v purchases; c commissions; v_uid uuid;
begin
  -- 50 %: pays half, direct commission on what was paid
  p := pg_temp.newp('buyer1');
  r := apply_discount(p, (select id from ids where name = 'buyer1'), 'half');
  select * into v from purchases where id = p;
  assert v.amount = 1000 and v.list_amount = 2000 and v.discount_amount = 1000 and v.commission_base = 1000, format('half: %s', row_to_json(v));
  -- remove → back to list price
  perform apply_discount(p, v.user_id, null);
  select * into v from purchases where id = p;
  assert v.amount = 2000 and v.list_amount is null and v.discount_amount = 0 and v.commission_base = 2000 and v.discount_code_id is null, 'remove';
  perform apply_discount(p, v.user_id, 'HALF');
  perform activate_purchase(p, 'manual', 'x1', null);
  select * into c from commissions where purchase_id = p and level = 0;
  assert c.amount = 400 and c.status = 'credited', format('half commission: %s', row_to_json(c));

  -- 100 %: amount 0, no commissions, package active
  p := pg_temp.newp('buyer2');
  v_uid := (select id from ids where name = 'buyer2');
  perform apply_discount(p, v_uid, 'FREE100');
  select * into v from purchases where id = p;
  assert v.amount = 0 and v.commission_base = 0 and v.commission_status = 'not_applicable', 'free';
  perform activate_purchase(p, 'discount', 'discount_' || p, null);
  assert (select status from purchases where id = p) = 'paid';
  assert (select active_package_id from profiles where id = v_uid) is not null, 'free activates package';
  assert not exists (select 1 from commissions where purchase_id = p), 'free: no commissions';

  -- max_uses = 1 → second use rejected
  p := pg_temp.newp('buyer3');
  begin
    perform apply_discount(p, (select id from ids where name = 'buyer3'), 'FREE100');
    raise exception 'expected DISCOUNT_USED_UP';
  exception when others then
    assert sqlerrm like 'DISCOUNT_USED_UP%', sqlerrm;
  end;

  -- flat above price is capped → free
  perform apply_discount(p, (select id from ids where name = 'buyer3'), 'FLAT9999');
  assert (select amount from purchases where id = p) = 0 and (select discount_amount from purchases where id = p) = 2000, 'flat cap';

  -- someone else's purchase
  begin
    perform apply_discount(p, (select id from ids where name = 'buyer1'), 'HALF');
    raise exception 'expected PURCHASE_NOT_FOUND';
  exception when others then
    assert sqlerrm like 'PURCHASE_NOT_FOUND%', sqlerrm;
  end;

  -- dashboard: income is net of discounts
  r := admin_dashboard();
  assert (r->>'verifiedPaymentAmount')::numeric = 1000 and (r->>'discountsGiven')::numeric = 3000
     and (r->>'grossSalesAmount')::numeric = 4000 and (r->>'freeActivations')::int = 1, r::text;
  raise notice 'discount tests passed';
end $$;

rollback;
