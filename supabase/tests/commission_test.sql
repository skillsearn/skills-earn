-- SKILLSEARN — engine test. Runs in a transaction and rolls back.
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/commission_test.sql
begin;

create temp table ids(name text primary key, id uuid);

-- 'upline' is a root member without a sponsor.
update app_settings set value = value || '{"referralRequired": false}' where key = 'registration';

do $$
declare
  v_names text[] := array['upline','rahul','amit','rohit','mohan','sita','xavier'];
  n text; v_id uuid; v_sponsor text; v_p profiles;
begin
  foreach n in array v_names loop
    v_id := gen_random_uuid();
    insert into auth.users(id, email) values (v_id, n || '@test.local');
    v_sponsor := case n
      when 'rahul' then (select referral_code from profiles where id = (select id from ids where name = 'upline'))
      when 'amit'  then (select referral_code from profiles where id = (select id from ids where name = 'rahul'))
      when 'rohit' then (select referral_code from profiles where id = (select id from ids where name = 'amit'))
      when 'mohan' then (select referral_code from profiles where id = (select id from ids where name = 'rohit'))
      when 'sita'  then (select referral_code from profiles where id = (select id from ids where name = 'rohit'))
      when 'xavier' then (select referral_code from profiles where id = (select id from ids where name = 'mohan'))
      else null end;
    v_p := create_profile(v_id, initcap(n), n || '@test.local', '+9190000000' || array_position(v_names, n), v_sponsor);
    insert into ids values (n, v_id);
  end loop;

  -- beneficiaries' packages: upline Diamond, rahul Platinum, amit Gold, rohit Gold
  update profiles set active_package_id = (select id from packages where slug = 'diamond')  where id = (select id from ids where name = 'upline');
  update profiles set active_package_id = (select id from packages where slug = 'platinum') where id = (select id from ids where name = 'rahul');
  update profiles set active_package_id = (select id from packages where slug = 'gold')     where id = (select id from ids where name = 'amit');
  update profiles set active_package_id = (select id from packages where slug = 'gold')     where id = (select id from ids where name = 'rohit');
end $$;

create or replace function pg_temp.uid(p text) returns uuid language sql as $$ select id from ids where name = p $$;

create or replace function pg_temp.buy(p_user text, p_pkg text) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into purchases(user_id, package_id, type, amount, commission_base)
  select pg_temp.uid(p_user), id, 'new', price, price from packages where slug = p_pkg
  returning id into v_id;
  perform activate_purchase(v_id, 'manual', null, null);
  return v_id;
end $$;

create or replace function pg_temp.expect(p_purchase uuid, p_level int, p_who text, p_amount numeric, p_status text)
returns void language plpgsql as $$
declare c commissions;
begin
  select * into c from commissions where purchase_id = p_purchase and level = p_level;
  if not found then raise exception 'level % missing', p_level; end if;
  if c.beneficiary_id <> pg_temp.uid(p_who) or c.amount <> p_amount or c.status <> p_status then
    raise exception 'level %: expected % % %, got % % % (%)', p_level, p_who, p_amount, p_status,
      (select full_name from profiles where id = c.beneficiary_id), c.amount, c.status, c.calculation;
  end if;
end $$;

-- 1. PDF example: Mohan buys Diamond ₹6,000
do $$
declare p uuid := pg_temp.buy('mohan', 'diamond');
begin
  perform pg_temp.expect(p, 0, 'rohit',  2400.00, 'credited');
  perform pg_temp.expect(p, 1, 'amit',    360.00, 'credited');
  perform pg_temp.expect(p, 2, 'rahul',   342.00, 'credited');
  perform pg_temp.expect(p, 3, 'upline',  286.50, 'credited');
  assert (select active_package_id from profiles where id = pg_temp.uid('mohan')) = (select id from packages where slug='diamond');

  -- idempotency: second run does nothing and raises a fraud alert
  assert process_commissions(p) = 0;
  assert (select count(*) from commissions where purchase_id = p) = 4;
  assert exists (select 1 from fraud_alerts where purchase_id = p and type = 'duplicate_commission_attempt');
  assert (activate_purchase(p, 'manual'))->>'status' = 'already_paid';
  raise notice 'PASS 1: PDF diamond example 2400 / 360 / 342 / 286.50';
end $$;

-- 2. Gold purchase under Rohit: 800 / 120 / 114 / 95.50
do $$
declare p uuid := pg_temp.buy('sita', 'gold');
begin
  perform pg_temp.expect(p, 0, 'rohit',  800.00, 'credited');
  perform pg_temp.expect(p, 1, 'amit',   120.00, 'credited');
  perform pg_temp.expect(p, 2, 'rahul',  114.00, 'credited');
  perform pg_temp.expect(p, 3, 'upline',  95.50, 'credited');
  raise notice 'PASS 2: gold purchase 800 / 120 / 114 / 95.50';
end $$;

-- 3. Eligibility: Xavier (under Mohan) buys Gold.
--    direct Mohan (Diamond) ✓, G1 Rohit (Gold, max 1) ✓, G2 Amit (Gold) ✗, G3 Rahul (Platinum, max 2) ✗
do $$
declare p uuid := pg_temp.buy('xavier', 'gold');
begin
  perform pg_temp.expect(p, 0, 'mohan', 800.00, 'credited');
  perform pg_temp.expect(p, 1, 'rohit', 120.00, 'credited');
  perform pg_temp.expect(p, 2, 'amit',  114.00, 'skipped');
  perform pg_temp.expect(p, 3, 'rahul',  95.50, 'skipped');
  -- skipped amounts are not redistributed
  assert (select count(*) from wallet_ledger where purchase_id = p) = 2;
  raise notice 'PASS 3: package-wise eligibility, no redistribution';
end $$;

-- 4. Wallet + withdrawal with 5% charge
do $$
declare w withdrawals; bal numeric;
begin
  update app_settings set value = value || '{"windowDays":7,"minAmount":500}' where key = 'withdrawal';
  -- rohit: 2400 + 800 + 120 = 3320
  assert (wallet_summary(pg_temp.uid('rohit'))->>'availableBalance')::numeric = 3320.00;
  assert (wallet_summary(pg_temp.uid('rohit'))->>'directIncome')::numeric = 3200.00;

  begin
    perform request_withdrawal(pg_temp.uid('rohit'), 100, 'upi', '{"upi":"rohit@upi"}');
    raise exception 'should have failed';
  exception when others then assert sqlerrm like 'BELOW_MINIMUM%', sqlerrm; end;

  w := request_withdrawal(pg_temp.uid('rohit'), 1000, 'upi', '{"upi":"rohit@upi"}');
  assert w.charge_amount = 50.00 and w.net_amount = 950.00;
  assert (wallet_summary(pg_temp.uid('rohit'))->>'availableBalance')::numeric = 2320.00;

  begin
    perform request_withdrawal(pg_temp.uid('rohit'), 500, 'upi', '{"upi":"rohit@upi"}');
    raise exception 'should have failed';
  exception when others then assert sqlerrm like 'OPEN_REQUEST_EXISTS%', sqlerrm; end;

  begin
    perform transition_withdrawal(w.id, 'paid', null, null, 'UTR0');
    raise exception 'should have failed';
  exception when others then assert sqlerrm like 'INVALID_TRANSITION%', sqlerrm; end;

  perform transition_withdrawal(w.id, 'approved', null, 'ok');

  begin
    perform transition_withdrawal(w.id, 'paid', null, null, null);
    raise exception 'should have failed';
  exception when others then assert sqlerrm like 'REFERENCE_REQUIRED%', sqlerrm; end;
  w := transition_withdrawal(w.id, 'paid', null, null, 'UTR123');
  bal := (wallet_summary(pg_temp.uid('rohit'))->>'availableBalance')::numeric;
  assert bal = 2320.00, bal::text;
  assert exists (select 1 from wallet_ledger where withdrawal_id = w.id and type = 'platform_charge' and amount = -50.00);
  assert exists (select 1 from wallet_ledger where withdrawal_id = w.id and type = 'successful_withdrawal' and amount = -950.00);

  begin
    perform transition_withdrawal(w.id, 'paid', null, null, 'UTR999');
    raise exception 'should have failed';
  exception when others then assert sqlerrm like 'INVALID_TRANSITION%', sqlerrm; end;

  -- failed payout releases the full gross, no charge
  w := request_withdrawal(pg_temp.uid('rohit'), 2000, 'bank', '{"account":"123"}');
  perform transition_withdrawal(w.id, 'approved', null);
  perform transition_withdrawal(w.id, 'processing', null);
  perform transition_withdrawal(w.id, 'failed', null, 'bank rejected');
  assert (wallet_summary(pg_temp.uid('rohit'))->>'availableBalance')::numeric = 2320.00;
  assert not exists (select 1 from wallet_ledger where withdrawal_id = w.id and type = 'platform_charge');

  begin
    perform request_withdrawal(pg_temp.uid('rohit'), 99999, 'upi', '{"upi":"x"}');
    raise exception 'should have failed';
  exception when others then assert sqlerrm like 'INSUFFICIENT_BALANCE%', sqlerrm; end;
  raise notice 'PASS 4: withdrawal 1000 → charge 50, net 950; failed payout released';
end $$;

-- 5. Ledger immutability, self-referral, team view
do $$
begin
  begin
    update wallet_ledger set amount = 1 where user_id = pg_temp.uid('rohit');
    raise exception 'should have failed';
  exception when others then assert sqlerrm like 'LEDGER_IMMUTABLE%', sqlerrm; end;

  begin
    perform create_profile(gen_random_uuid(), 'Dup', 'rohit@test.local', '+919999999999',
                           (select referral_code from profiles where id = pg_temp.uid('rohit')));
    raise exception 'should have failed';
  exception when others then assert sqlerrm like 'SELF_REFERRAL%', sqlerrm; end;

  assert (team_summary(pg_temp.uid('amit'))->>'directReferrals')::int = 1;   -- rohit
  assert (team_summary(pg_temp.uid('amit'))->>'totalDownline')::int = 4;     -- rohit, mohan, sita, xavier
  assert (select count(*) from get_downline(pg_temp.uid('amit'), 4, 2)) = 2; -- mohan, sita
  raise notice 'PASS 5: immutability, self-referral block, downline';
end $$;

-- 6. Pending commission hold + release
do $$
declare p uuid; v_id uuid := gen_random_uuid();
begin
  update app_settings set value = value || '{"holdDays":3}' where key = 'commission';
  insert into auth.users(id, email) values (v_id, 'late@test.local');
  perform create_profile(v_id, 'Late', 'late@test.local', '+919888888888',
                         (select referral_code from profiles where id = pg_temp.uid('rohit')));
  insert into ids values ('late', v_id);
  p := pg_temp.buy('late', 'gold');
  perform pg_temp.expect(p, 0, 'rohit', 800.00, 'pending');
  assert (wallet_summary(pg_temp.uid('rohit'))->>'pendingCommission')::numeric = 800.00;
  assert release_pending_commissions() = 0;
  update commissions set available_at = now() - interval '1 minute' where purchase_id = p;
  -- rohit (direct), amit (G1, Gold), rahul (G2, Platinum), upline (G3, Diamond)
  assert release_pending_commissions() = 4;
  assert (select count(*) from wallet_ledger where purchase_id = p) = 4;
  raise notice 'PASS 6: hold + release';
end $$;

-- 7. Read models execute
do $$
begin
  assert (admin_dashboard()->>'totalSalesCount')::int = 4;
  assert (admin_dashboard()->>'platformCharges')::numeric = 50.00;
  assert (select count(*) from admin_report('day', current_date - 6, current_date)) = 7;
  assert (select count(*) from admin_report('month', current_date - 60, current_date)) >= 2;
  perform broadcast_announcement('Hello', 'World', null);
  assert (select count(*) from notifications where type = 'announcement') = 8;
  raise notice 'PASS 7: dashboard, reports, announcements';
end $$;

-- 8. Generations beyond 3: Gn = G(n-3)×8% + G(n-2)×12% + G(n-1)×15%, D only in G1–G3.
--    Yara (under Xavier) buys Diamond. Chain: xavier (direct) · mohan G1 · rohit G2 · amit G3 · rahul G4 · upline G5
do $$
declare p uuid; v_id uuid := gen_random_uuid();
begin
  update app_settings set value = value || '{"holdDays":0,"maxGenerations":5}' where key = 'commission';
  update app_settings set value = value || '{"referralRequired":true}' where key = 'registration';
  update packages set max_generations = 5 where slug = 'diamond';

  begin
    perform create_profile(gen_random_uuid(), 'Nobody', 'nobody@test.local', '+919777777777', null);
    raise exception 'should have failed';
  exception when others then assert sqlerrm like 'REFERRAL_REQUIRED%', sqlerrm; end;

  insert into auth.users(id, email) values (v_id, 'yara@test.local');
  perform create_profile(v_id, 'Yara', 'yara@test.local', '+919666666666',
                         (select referral_code from profiles where id = pg_temp.uid('xavier')));
  insert into ids values ('yara', v_id);
  p := pg_temp.buy('yara', 'diamond');
  perform pg_temp.expect(p, 0, 'xavier', 2400.00, 'credited');  -- Gold (bought in test 3)
  perform pg_temp.expect(p, 1, 'mohan',   360.00, 'credited');  -- Diamond
  perform pg_temp.expect(p, 2, 'rohit',   342.00, 'skipped');   -- Gold
  perform pg_temp.expect(p, 3, 'amit',    286.50, 'skipped');   -- Gold
  perform pg_temp.expect(p, 4, 'rahul',   112.82, 'skipped');   -- Platinum: 28.80 + 41.04 + 42.98
  perform pg_temp.expect(p, 5, 'upline',   78.66, 'credited');  -- Diamond:  27.36 + 34.38 + 16.92
  assert (select calculation from commissions where purchase_id = p and level = 4)
         = '(₹360.00 × 8%) + (₹342.00 × 12%) + (₹286.50 × 15%) = ₹112.82';
  assert (wallet_summary(pg_temp.uid('upline'))->'generationIncome'->>'5')::numeric = 78.66;
  raise notice 'PASS 8: generation 4+ formula, configurable depth, compulsory referral';
end $$;

rollback;
