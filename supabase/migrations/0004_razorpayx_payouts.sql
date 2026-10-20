-- SKILLSEARN — automatic withdrawal payouts through RazorpayX.
-- The withdrawal state machine and ledger rules are unchanged: a payout only moves
-- approved → processing on creation and processing → paid | failed when Razorpay settles it.

alter table profiles add column razorpay_contact_id text;

alter table withdrawals
  add column payout_provider      text check (payout_provider in ('manual', 'razorpayx')),
  add column payout_id            text unique,          -- pout_xxx
  add column payout_fund_account  text,                 -- fa_xxx, reused on retry so the idempotent request body stays identical
  add column payout_mode          text,                 -- UPI | IMPS | NEFT
  add column payout_status        text,                 -- initiating | initiation_failed | queued | pending | processing | processed | reversed | failed | rejected | cancelled
  add column payout_utr           text,
  add column payout_error         text,
  add column payout_initiated_by  uuid references profiles(id),
  add column payout_initiated_at  timestamptz;

create index withdrawals_payout_sync_idx on withdrawals(status) where payout_id is not null;
