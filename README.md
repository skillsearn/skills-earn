# SKILLSEARN

Skills Package, Referral Income & Learning Platform: **website + user dashboard + admin panel**.

* **Frontend:** React 19 · Vite · Tailwind v4 · React Query (`apps/web`)
* **Backend:** NestJS 11 (`apps/api`)
* **Database/Auth:** Supabase Postgres + Supabase Auth (`supabase/`)

Read these first: [architecture.md](architecture.md) (system design) · [flow.md](flow.md) (every flow, step by step) · [brain.md](brain.md) (decisions, invariants, gotchas).

## 1. Supabase setup

1. Create a Supabase project.
2. In **SQL Editor**, run these in order:
   `supabase/migrations/0001_schema.sql` → `0002_functions.sql` → `0003_seed.sql`
   (or `supabase link && supabase db push`).
3. Optional check: run `supabase/tests/commission_test.sql`. It rolls back and prints `PASS 1…7`.
4. **Authentication → URL configuration**: Site URL = your web URL; add `<web-url>/reset-password` to Redirect URLs.
5. Copy the project URL, `anon` key and `service_role` key from **Project Settings → API**.

## 2. Run locally

```bash
npm install

cp apps/api/.env.example apps/api/.env   # fill SUPABASE_* (PAYMENT_PROVIDER=mock for dev)
cp apps/web/.env.example apps/web/.env   # fill VITE_SUPABASE_* (anon key only)

npm run create-admin -w apps/api -- admin@example.com 'StrongPass#1' "Owner" 9876543210
npm run seed:demo -w apps/api            # optional: PDF example hierarchy (password Demo@1234)

npm run dev:api    # http://localhost:4000/api
npm run dev:web    # http://localhost:5173
```

Log in at `/login` with a User ID (`SE100001`), email or mobile. Admins land on `/admin`.

With `PAYMENT_PROVIDER=mock`, checkout shows a **Simulate successful payment** button. It goes
through the same `activate_purchase` → commission path as a real payment. The API refuses
to start in mock mode when `NODE_ENV=production`.

## 3. Payments (Razorpay)

Set `PAYMENT_PROVIDER=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
In the Razorpay dashboard, add the webhook `https://<api>/api/payments/webhook/razorpay` with events
`payment.captured` and `payment.failed`. Activation is idempotent, so the browser callback and the
webhook can both arrive safely.

### Withdrawal payouts (RazorpayX)

1. Activate RazorpayX at https://x.razorpay.com (test mode works without KYC) and copy the
   **account number** from *Account details*.
2. Set `RAZORPAYX_ACCOUNT_NUMBER` in `apps/api/.env`. It uses the same `RAZORPAY_KEY_ID/SECRET`.
3. In RazorpayX → *Settings → Webhooks* add the same URL `https://<api>/api/payments/webhook/razorpay`
   with the same secret, events `payout.processed`, `payout.failed`, `payout.reversed`, `payout.rejected`.
4. Admin → Withdrawals → open an **approved** request → **Pay ₹…**. The status moves to Processing, then
   to Paid (with the UTR) or Failed (amount returned) automatically. A 10-minute job also syncs
   payouts in case a webhook is missed. Without step 2 the button is disabled and manual payout still works.

## 4. Tests

```bash
npm test                                   # API unit tests (quote maths, IST windows, CSV, mobile)
psql "$DATABASE_URL" -f supabase/tests/commission_test.sql   # engine tests against Postgres
```

## 5. Feature map (PDF module → where)

| Module | Implementation |
|---|---|
| 1 Package management | `/admin/packages`: price, direct %, generation eligibility, level/course access, activate/deactivate; versioned generation rates |
| 2 Registration & login | `/register` (all fields + T&C, `?ref=` link), login by User ID/email/mobile, forgot/reset password, logout; auto user ID, referral code/link, sponsor, ledger, pending purchase |
| 3 Hierarchy | `profiles.ancestors`; `/app/team`; admin upline/downline viewer |
| 4 Direct commission | `process_commissions` level 0 (40 % of purchased package) |
| 5 Generation engine | `process_commissions` levels 1–3 with compounding formula and per-beneficiary eligibility; no redistribution |
| 6 Upgrades | `/app/upgrade`: price difference, deadline, configurable commissionability |
| 7 User dashboard | `/app`, `/app/team`, `/app/income`, `/app/withdrawals`, `/app/purchases`, `/app/courses`, `/app/profile`, `/app/notifications` |
| 8 Wallet ledger | append-only `wallet_ledger` (immutable trigger), balance = Σ entries, unique txn IDs |
| 9 Withdrawals + 5 % | weekly/monthly windows (IST), minimum, live gross/charge/net quote, confirm modal, 7-status workflow, separate charge entry, failure reconciliation |
| 10 Admin panel | dashboard, reports (daily/weekly/monthly), users, payments/reconciliation, commissions, withdrawals, ledger, settings, fraud alerts, audit logs, announcements, CSV exports |
