# Architecture — SKILLSEARN

> Skills Package, Referral Income & Learning Platform
> Website + User Dashboard + Admin Panel · React (Vite) · NestJS · Supabase (Postgres + Auth)

## 1. System overview

```
 ┌──────────────────────────────────────────────────────────────┐
 │ apps/web — React 19 + Vite + Tailwind v4 + React Query       │
 │  Public site  ·  /app (user dashboard)  ·  /admin (panel)    │
 └───────────────┬───────────────────────────────┬──────────────┘
                 │ REST JSON  /api/*             │ Supabase Auth only
                 │ Authorization: Bearer <jwt>   │ (session refresh,
                 ▼                               │  password reset)
 ┌───────────────────────────────────────┐       │
 │ apps/api — NestJS 11                  │       │
 │  AuthGuard → RolesGuard → Throttler   │       │
 │  Validation (class-validator)         │       │
 │  Modules: auth · packages · payments  │       │
 │   wallet · withdrawals · referrals    │       │
 │   courses · notifications · settings  │       │
 │   admin · audit · jobs (cron)         │       │
 └───────────────┬───────────────────────┘       │
                 │ supabase-js (service role)     │
                 │  • table reads/writes          │
                 │  • RPC → PL/pgSQL functions    │
                 ▼                               ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ Supabase                                                     │
 │  Postgres: tables + RLS (deny-all for anon/authenticated)    │
 │  Financial engine as SECURITY DEFINER functions (atomic)     │
 │  Auth: email+password users (JWT)                            │
 └──────────────────────────────────────────────────────────────┘
                 ▲
                 │ webhook (HMAC verified)
           Razorpay (payments)
```

### Why money logic lives in Postgres functions
supabase-js cannot open multi-statement transactions. The spec requires
*"database transactions for commission and wallet operations"* and *"each purchase is
processed only once"*. So every money-moving operation is one PL/pgSQL function that
runs in a single transaction with row locks (`SELECT … FOR UPDATE`) and unique
constraints as a second line of defence. NestJS validates input, enforces auth, and
calls the function via `supabase.rpc()`.

| Function                         | Does                                                       |
|----------------------------------|------------------------------------------------------------|
| `create_profile`                 | user id, referral code, sponsor + ancestor path, fraud check |
| `activate_purchase`              | mark payment verified → activate/upgrade package → commissions |
| `process_commissions`            | direct + generation engine, idempotent                     |
| `release_pending_commissions`    | moves matured *pending* commissions to the wallet (cron)  |
| `ledger_post` (internal)         | locked, append-only ledger insert with running balance    |
| `request_withdrawal`             | schedule/min/balance checks, hold, 5 % quote frozen       |
| `transition_withdrawal`          | admin state machine, payout / charge / release entries    |
| `admin_adjust_wallet`            | authorised correction + audit                             |
| `wallet_summary`, `get_downline`, `team_summary`, `admin_dashboard`, `admin_report` | read models |

## 2. Repository layout

```
skilllearn/
├── architecture.md · flow.md · brain.md · README.md
├── package.json                      # npm workspaces
├── supabase/migrations/
│   ├── 0001_schema.sql               # tables, indexes, RLS
│   ├── 0002_functions.sql            # financial engine + read models
│   └── 0003_seed.sql                 # packages, rule v1, settings, sample courses
└── apps/
    ├── api/src/
    │   ├── main.ts · app.module.ts
    │   ├── common/        supabase.service, guards, decorators, csv, errors
    │   ├── auth/          register · login (id/email/mobile) · me · password
    │   ├── settings/      typed settings + audit
    │   ├── packages/      public list, admin CRUD, commission rule versions
    │   ├── payments/      checkout, upgrade, Razorpay verify + webhook, mock, admin
    │   ├── wallet/        summary, ledger, commissions, statements, adjustments
    │   ├── withdrawals/   quote, request, history, admin workflow, export
    │   ├── referrals/     team summary, generation lists, hierarchy viewer
    │   ├── courses/       catalogue, access control, lessons, progress, admin CRUD
    │   ├── notifications/ in-app notifications, announcements
    │   ├── admin/         dashboard, users, reports, audit logs, fraud alerts
    │   ├── jobs/          cron: release pending commissions
    │   ├── health/
    │   └── scripts/       create-admin.ts, seed-demo.ts
    └── web/src/
        ├── lib/           api.ts, supabase.ts, auth.tsx, format.ts, types.ts
        ├── components/    ui.tsx (Button, Card, Table, Badge…), layouts
        └── pages/         public/*, app/*, admin/*
```

## 3. Data model

```
auth.users 1─1 profiles ─┬─ sponsor_id ─▶ profiles   (direct referrer)
                         │  ancestors uuid[]  (nearest first: [sponsor, gen1, gen2, …])
                         ├─* purchases ─* payment_events
                         │      └─* commissions (unique purchase_id+level)
                         ├─* wallet_ledger   (append-only, signed amounts)
                         ├─* withdrawals ─* withdrawal_events
                         ├─* enrolments, lesson_progress
                         └─* notifications
packages (level 1..n) ─── courses.min_package_level ─* lessons
commission_rule_versions  (generation rates history)
app_settings (withdrawal · upgrade · commission · registration)
audit_logs · fraud_alerts · announcements
```

* **Money:** `numeric(14,2)` rupees, rounded half-up to the paisa at each formula step.
* **Rates:** basis points (`4000` = 40 %).
* **IDs:** `profiles.user_code` = `SE100001…` (sequence), `referral_code` 8 chars,
  `wallet_ledger.txn_id` = `TXN000000001…` (sequence, unique).
* **Hierarchy:** `ancestors` array set once at registration (sponsor is immutable) →
  upline lookup is O(1), downline = `ancestors @> {uid}` with a GIN index,
  depth = `array_position(ancestors, uid)`.

## 4. Security model

| Layer      | Control                                                                 |
|------------|-------------------------------------------------------------------------|
| Browser    | holds only the Supabase **anon** key + user JWT                         |
| Postgres   | RLS on every table, **no** policies → anon/authenticated can't read/write; functions `REVOKE EXECUTE … FROM public` and granted only to `service_role` |
| API        | `AuthGuard` verifies JWT with Supabase (cached 60 s), loads profile, rejects suspended; `RolesGuard` for `/admin/*` |
| Payments   | Razorpay signature (`order|payment` HMAC) + webhook HMAC on raw body; activation idempotent |
| Abuse      | throttling (global + stricter on auth/withdrawals), self-referral block, IP burst fraud alerts, duplicate-commission alerts |
| Audit      | `audit_logs` for config changes, suspensions, withdrawal decisions, adjustments, admin logins |

## 5. API surface (prefix `/api`)

Public: `GET /health`, `GET /packages`, `GET /settings/public`, `GET /referrals/validate/:code`,
`POST /auth/register`, `POST /auth/login`, `POST /auth/forgot-password`,
`POST /payments/webhook/razorpay`.

User (JWT): `GET /auth/me`, `PATCH /me/profile`, `POST /auth/change-password`,
`POST /payments/checkout`, `GET /payments/upgrade-options`, `POST /payments/upgrade`,
`POST /payments/verify`, `POST /payments/mock/:id/confirm`, `GET /me/purchases`,
`GET /me/wallet/summary`, `GET /me/wallet/ledger`, `GET /me/commissions`,
`GET /me/statement.csv`, `GET /me/withdrawals`, `GET /me/withdrawals/quote`,
`POST /me/withdrawals`, `GET /me/team/summary`, `GET /me/team`,
`GET /courses`, `GET /courses/:slug`, `POST /courses/lessons/:id/complete`,
`GET /me/notifications`, `POST /me/notifications/:id/read`, `POST /me/notifications/read-all`.

Admin (JWT + role=admin): `/admin/dashboard`, `/admin/reports`, `/admin/users[/:id]`,
`/admin/users/:id/status`, `/admin/users/:id/hierarchy`, `/admin/users/:id/adjust`,
`/admin/packages`, `/admin/commission-rules`, `/admin/courses`, `/admin/lessons`,
`/admin/payments[/:id/verify|fail]`, `/admin/commissions`, `/admin/commissions/release`,
`/admin/ledger`, `/admin/withdrawals[/:id]`, `/admin/settings/:key`,
`/admin/announcements`, `/admin/fraud-alerts`, `/admin/audit-logs`,
`/admin/export/:report.csv`.

## 6. Environment

**apps/api/.env**

| Var | Notes |
|-----|-------|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | service role = server only |
| `PORT` (4000), `WEB_ORIGIN`, `SITE_URL` | CORS + referral links + reset redirect |
| `PAYMENT_PROVIDER` | `razorpay` or `mock` (dev only, blocked when `NODE_ENV=production`) |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | |
| `RAZORPAYX_ACCOUNT_NUMBER` | Optional. Enables automatic withdrawal payouts via RazorpayX (flow.md §4a) |

**apps/web/.env** — `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## 7. Deployment

1. Supabase: run the three migrations (SQL editor or `supabase db push`).
2. Auth settings: Site URL = web URL; add `/reset-password` to redirect URLs.
3. API on Render/Railway/Fly (Node ≥ 20). Web on Vercel/Netlify with SPA fallback.
4. `npm run create-admin -w apps/api -- <email> <password> "<name>" <mobile>`.
5. Razorpay dashboard → webhook `https://api…/api/payments/webhook/razorpay`,
   events `payment.captured`, `payment.failed`.
