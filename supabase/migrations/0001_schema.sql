-- SKILLSEARN — schema
-- Money: numeric(14,2) rupees. Rates: basis points (4000 = 40%).

create extension if not exists pgcrypto;

-- ───────────────────────── sequences ─────────────────────────
create sequence if not exists user_code_seq start 100001;
create sequence if not exists txn_seq start 1;

-- ───────────────────────── settings ─────────────────────────
create table app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

-- ───────────────────────── packages ─────────────────────────
create table packages (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  slug             text not null unique,
  level            int  not null unique check (level > 0),
  price            numeric(14,2) not null check (price > 0),
  direct_rate_bps  int  not null default 4000 check (direct_rate_bps between 0 and 10000),
  max_generations  int  not null default 1 check (max_generations between 0 and 3),
  description      text,
  features         text[] not null default '{}',
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table commission_rule_versions (
  id                    serial primary key,
  generation_rates_bps  int[] not null check (array_length(generation_rates_bps, 1) = 3),
  note                  text,
  created_by            uuid,
  created_at            timestamptz not null default now()
);

-- ───────────────────────── users ─────────────────────────
create table profiles (
  id                    uuid primary key references auth.users(id) on delete cascade,
  user_code             text not null unique,
  full_name             text not null,
  email                 text not null unique,
  mobile                text not null unique,
  referral_code         text not null unique,
  sponsor_id            uuid references profiles(id),
  ancestors             uuid[] not null default '{}',  -- nearest first: [sponsor, gen1, gen2, ...]
  role                  text not null default 'user' check (role in ('user','admin')),
  status                text not null default 'active' check (status in ('active','suspended')),
  active_package_id     uuid references packages(id),
  package_activated_at  timestamptz,
  payout_details        jsonb,
  terms_accepted_at     timestamptz not null default now(),
  registration_ip       text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (sponsor_id is null or sponsor_id <> id)
);
create index profiles_sponsor_idx   on profiles(sponsor_id);
create index profiles_ancestors_idx on profiles using gin(ancestors);
create index profiles_created_idx   on profiles(created_at);

-- ───────────────────────── purchases & payments ─────────────────────────
create table purchases (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references profiles(id),
  package_id               uuid not null references packages(id),
  from_package_id          uuid references packages(id),
  type                     text not null check (type in ('new','upgrade')),
  amount                   numeric(14,2) not null check (amount > 0),
  commission_base          numeric(14,2) not null default 0,
  status                   text not null default 'pending'
                           check (status in ('pending','paid','failed','cancelled')),
  provider                 text check (provider in ('razorpay','mock','manual')),
  provider_order_id        text unique,
  provider_payment_id      text unique,
  paid_at                  timestamptz,
  verified_by              uuid references profiles(id),
  commission_status        text not null default 'pending'
                           check (commission_status in ('pending','processed','not_applicable')),
  commission_processed_at  timestamptz,
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index purchases_user_idx   on purchases(user_id, created_at desc);
create index purchases_status_idx on purchases(status, created_at desc);

create table payment_events (
  id           bigserial primary key,
  purchase_id  uuid references purchases(id),
  provider     text not null,
  event        text not null,
  payload      jsonb,
  created_at   timestamptz not null default now()
);
create index payment_events_purchase_idx on payment_events(purchase_id);

-- ───────────────────────── commissions & ledger ─────────────────────────
create table commissions (
  id               uuid primary key default gen_random_uuid(),
  purchase_id      uuid not null references purchases(id),
  source_user_id   uuid not null references profiles(id),
  beneficiary_id   uuid not null references profiles(id),
  level            smallint not null check (level between 0 and 3),  -- 0 = direct
  rate_bps         int not null,
  base_amount      numeric(14,2) not null,
  amount           numeric(14,2) not null,
  calculation      text not null,
  status           text not null check (status in ('pending','credited','skipped')),
  skip_reason      text,
  rule_version_id  int references commission_rule_versions(id),
  available_at     timestamptz,
  credited_at      timestamptz,
  created_at       timestamptz not null default now(),
  unique (purchase_id, level),
  check (beneficiary_id <> source_user_id)
);
create index commissions_beneficiary_idx on commissions(beneficiary_id, created_at desc);
create index commissions_pending_idx     on commissions(available_at) where status = 'pending';

create table withdrawals (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references profiles(id),
  gross_amount       numeric(14,2) not null check (gross_amount > 0),
  charge_bps         int not null,
  charge_amount      numeric(14,2) not null,
  net_amount         numeric(14,2) not null,
  method             text not null check (method in ('upi','bank')),
  payout_details     jsonb not null,
  status             text not null default 'requested'
                     check (status in ('requested','under_review','approved','processing','paid','rejected','failed')),
  admin_note         text,
  payment_reference  text,
  reviewed_by        uuid references profiles(id),
  requested_at       timestamptz not null default now(),
  paid_at            timestamptz,
  updated_at         timestamptz not null default now()
);
create index withdrawals_user_idx   on withdrawals(user_id, requested_at desc);
create index withdrawals_status_idx on withdrawals(status, requested_at desc);
-- one open request per user
create unique index withdrawals_one_open_idx on withdrawals(user_id)
  where status in ('requested','under_review','approved','processing');

create table withdrawal_events (
  id             bigserial primary key,
  withdrawal_id  uuid not null references withdrawals(id),
  from_status    text,
  to_status      text not null,
  actor_id       uuid references profiles(id),
  note           text,
  created_at     timestamptz not null default now()
);

create table wallet_ledger (
  id             uuid primary key default gen_random_uuid(),
  txn_id         text not null unique,
  user_id        uuid not null references profiles(id),
  type           text not null check (type in (
                   'direct_commission','generation_commission','withdrawal_hold',
                   'withdrawal_hold_release','successful_withdrawal','platform_charge',
                   'failed_withdrawal_release','admin_adjustment')),
  amount         numeric(14,2) not null check (amount <> 0),
  balance_after  numeric(14,2) not null,
  purchase_id    uuid references purchases(id),
  commission_id  uuid unique references commissions(id),
  withdrawal_id  uuid references withdrawals(id),
  generation     smallint,
  description    text not null,
  meta           jsonb,
  created_by     uuid references profiles(id),
  created_at     timestamptz not null default now()
);
create index wallet_ledger_user_idx on wallet_ledger(user_id, created_at desc);

-- ───────────────────────── courses ─────────────────────────
create table courses (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  slug               text not null unique,
  description        text,
  thumbnail_url      text,
  min_package_level  int not null default 1,
  is_published       boolean not null default false,
  sort               int not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table lessons (
  id                uuid primary key default gen_random_uuid(),
  course_id         uuid not null references courses(id) on delete cascade,
  title             text not null,
  video_url         text,
  content           text,
  duration_minutes  int,
  sort              int not null default 0,
  is_preview        boolean not null default false,
  created_at        timestamptz not null default now()
);
create index lessons_course_idx on lessons(course_id, sort);

create table enrolments (
  user_id      uuid not null references profiles(id) on delete cascade,
  course_id    uuid not null references courses(id) on delete cascade,
  enrolled_at  timestamptz not null default now(),
  primary key (user_id, course_id)
);

create table lesson_progress (
  user_id       uuid not null references profiles(id) on delete cascade,
  lesson_id     uuid not null references lessons(id) on delete cascade,
  completed_at  timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

-- ───────────────────────── notifications / audit / fraud ─────────────────────────
create table notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  type        text not null,
  title       text not null,
  body        text,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_user_idx on notifications(user_id, created_at desc);

create table announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now()
);

create table audit_logs (
  id          bigserial primary key,
  actor_id    uuid references profiles(id),
  action      text not null,
  entity      text,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  ip          text,
  created_at  timestamptz not null default now()
);
create index audit_logs_created_idx on audit_logs(created_at desc);
create index audit_logs_action_idx  on audit_logs(action);

create table fraud_alerts (
  id           uuid primary key default gen_random_uuid(),
  type         text not null,
  severity     text not null default 'medium' check (severity in ('low','medium','high')),
  user_id      uuid references profiles(id),
  purchase_id  uuid references purchases(id),
  details      jsonb,
  resolved_at  timestamptz,
  resolved_by  uuid references profiles(id),
  created_at   timestamptz not null default now()
);
create index fraud_alerts_open_idx on fraud_alerts(created_at desc) where resolved_at is null;

-- ───────────────────────── updated_at trigger ─────────────────────────
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger t_packages    before update on packages    for each row execute function touch_updated_at();
create trigger t_profiles    before update on profiles    for each row execute function touch_updated_at();
create trigger t_purchases   before update on purchases   for each row execute function touch_updated_at();
create trigger t_withdrawals before update on withdrawals for each row execute function touch_updated_at();
create trigger t_courses     before update on courses     for each row execute function touch_updated_at();

-- ledger is append-only
create or replace function forbid_ledger_mutation() returns trigger language plpgsql as $$
begin raise exception 'LEDGER_IMMUTABLE: wallet_ledger rows cannot be modified'; end $$;
create trigger t_ledger_immutable before update or delete on wallet_ledger
  for each row execute function forbid_ledger_mutation();

-- ───────────────────────── RLS: deny everything to anon/authenticated ─────────────────────────
-- All access goes through the NestJS API using the service_role key (which bypasses RLS).
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
