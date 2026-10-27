-- One-off: delete every member (role = 'user') and everything they generated.
-- Keeps admin accounts, packages, courses, lessons, settings, commission rules and announcements.
-- Take a backup first:  supabase db dump --linked --data-only -f backups/<date>-data.sql
-- Run:                  supabase db query --linked -f supabase/scripts/wipe_members.sql
begin;

create temp table wipe_ids on commit drop as select id from profiles where role <> 'admin';

-- money records (ledger is append-only, so its guard trigger is paused for this transaction only)
alter table wallet_ledger disable trigger t_ledger_immutable;
delete from wallet_ledger;
alter table wallet_ledger enable trigger t_ledger_immutable;

delete from withdrawal_events;
delete from withdrawals;
delete from commissions;
delete from fraud_alerts;
delete from payment_events;
delete from purchases;

-- member activity
delete from notifications   where user_id in (select id from wipe_ids);
delete from enrolments      where user_id in (select id from wipe_ids);
delete from lesson_progress where user_id in (select id from wipe_ids);
delete from audit_logs      where actor_id in (select id from wipe_ids);

-- accounts: auth.users cascades to profiles
delete from profiles   where id in (select id from wipe_ids);
delete from auth.users where id in (select id from wipe_ids);

select (select count(*) from profiles) as profiles_left,
       (select count(*) from auth.users) as auth_users_left,
       (select count(*) from purchases) as purchases_left,
       (select count(*) from wallet_ledger) as ledger_left;
commit;
