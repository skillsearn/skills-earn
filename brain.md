# Brain — SKILLSEARN knowledge, decisions & conventions

Read this before touching money logic. It records *why* the code is the way it is.

## 1. Product in one paragraph

The owner sells skill-learning **packages** (Gold ₹2,000 · Platinum ₹4,000 · Diamond ₹6,000).
Buying a package unlocks courses for that tier. Every user gets a referral link. When
someone buys a package, the **direct referrer** earns 40 % of it, and up to three
**generations above the direct referrer** earn compounded generation commissions. That
depends on each beneficiary's own package. Earnings go to an append-only wallet ledger.
Users withdraw on an admin-defined weekly or monthly schedule, and a 5 % platform charge
is deducted at payout.

## 2. Terminology (the #1 source of bugs)

* **Direct Referrer** = purchaser's sponsor. Gets the **direct** commission and is **not** Generation 1.
* **Generation 1** = the Direct Referrer's upline (purchaser's 2nd ancestor).
* **Generation n** = purchaser's `ancestors[n+1]` (1-based Postgres arrays).
* From the *earner's* point of view: your direct referrals' purchases pay you **direct**.
  Purchases by members 2 levels below you pay **G1**, 3 levels below pay **G2**, and
  4 levels below pay **G3**.
  The team page therefore labels levels as *Direct (L1) · Gen 1 source (L2) · …* .

## 3. Decisions on ambiguous points in the spec

| # | Spec ambiguity | Decision | Where |
|---|----------------|----------|-------|
| 1 | Packages each list "Generation n commission %" but Module 5 shows one global rate table | Rates are **global & versioned** (`commission_rule_versions`). Each package has `max_generations`, and package cards show the global rates up to that depth, which reproduces the PDF exactly. Every commission row stores the rule version used. | `process_commissions` |
| 2 | Direct rate per package? | `packages.direct_rate_bps`, taken from the **purchased** package (all 40 % by default). | |
| 3 | Is D used in generation formulas if the direct referrer is ineligible? | Yes. D, G1, G2 are *calculated* amounts and are used even when that person is skipped. Skipped money is never redistributed (spec forbids it). | |
| 4 | Must the direct referrer hold an active package? | Setting `commission.directRequiresActivePackage` (default **true**). | `app_settings` |
| 5 | Upgrade price difference: on prices at purchase time or today? | Current configured prices: `new.price − current.price`, which must be > 0. | payments service |
| 6 | Upgrade commission base | `upgrade.commissionable` (default false) + `upgrade.commissionBaseBps` (% of difference). Purchaser's chain processed like a new purchase with that base. | |
| 7 | "Pending commission" | `commission.holdDays` (default 0). If > 0, rows are `pending` until `available_at`, then a cron job credits the wallet. | jobs |
| 8 | Platform charge on failed/rejected payout | Not charged; full gross released (`failed_withdrawal_release`). | `transition_withdrawal` |
| 9 | Ledger on successful payout | `withdrawal_hold_release +gross`, `successful_withdrawal −net`, `platform_charge −charge`, so the charge is its own ledger row (spec D.7) and the net effect is −gross. | |
| 10 | Concurrent withdrawal requests | One open request per user at a time. | `request_withdrawal` |
| 11 | Course access | Tiered and inclusive: a package of level *n* unlocks courses with `min_package_level ≤ n`. | courses service |
| 12 | Referral code mandatory? | Optional by default (`registration.referralRequired`). No referrer means no commissions (rule 4). | |
| 13 | Withdrawal window | Weekly: IST weekday `weeklyDay` (0 = Sun) for `windowDays` days. Monthly: IST day `monthlyDay` (1–28) for `windowDays` days. | `withdrawal_window_open()` |
| 14 | Sponsor changes | Not allowed. The sponsor is fixed at registration, so `ancestors` never needs rewriting. | |
| 15 | Push notifications | In-app notifications are implemented. Web/mobile push (FCM/VAPID) is a roadmap item, and the `notifications` table is the single source to fan out from. | |
| 16 | PDF export | Statements export as CSV (opens in Excel) plus a print-friendly view for "Save as PDF". | |

## 4. Rounding

All money is `numeric(14,2)`. Each formula step is rounded half-up to 2 decimals
before it is reused: G1 is rounded, then used in G2, and so on. The PDF example gives
G3 = 192 + 43.20 + 51.30 = **286.50**. `supabase/tests/commission_test.sql` asserts it.

## 5. Invariants (never break these)

1. A wallet balance is **only** `SUM(wallet_ledger.amount)`. No balance column is ever updated.
2. Ledger rows are never updated or deleted. Corrections are new `admin_adjustment` rows plus an audit log.
3. A purchase moves `pending → paid` exactly once (row lock + status check).
4. `commissions(purchase_id, level)` is unique, and a purchase is processed once (`commission_status`).
5. Commissions are calculated on full amounts. The 5 % charge applies to withdrawals only.
6. A user can never be their own beneficiary (sponsor ≠ self, and ancestors exclude self).
7. Withdrawal transitions follow the state machine. `paid` requires a payment reference.
8. Every admin config, status or money action writes `audit_logs` (before/after JSON).

## 6. Conventions

* API: one Nest module per domain. DB rows are snake_case and API JSON is camelCase
  (mapped in services). Admin routes live under `/admin/*` with `@Roles('admin')`.
* All RPCs are called through `SupabaseService.rpc()`, which converts Postgres
  `RAISE EXCEPTION 'CODE: message'` into `400 { code, message }`.
* Web: React Query for server state, `lib/api.ts` is the only fetch wrapper, and money is
  displayed with `formatINR()`. Dates are shown in IST.
* Throttles: global 120/min · `/auth/*` 10/min · withdrawals POST 5/min.

## 7. Compliance note

Referral-income schemes in India fall under the Consumer Protection (Direct Selling)
Rules 2021 and the Prize Chits & Money Circulation Schemes (Banning) Act. Commissions
here come only from **real package (course) sales**, never from sign-ups. The spec
also asks that undistributed (ineligible) commissions are not redistributed without
legal review. Keep both properties, and get the T&C and payout model reviewed by
counsel before launch.

## 7a. Payouts (RazorpayX)

* Razorpay decides the outcome. The app never marks a RazorpayX payout paid by hand: manual buttons are hidden while a payout is processing.
* Only the **net** amount is sent. The 5 % charge stays a separate ledger entry exactly as for manual payouts.
* Double-pay protection: the row claim is atomic, `payout_id` is unique, and the payout call uses `X-Payout-Idempotency = wd-<withdrawal id>` with the same fund account on retry.
* `queue_if_low_balance: true`: if the RazorpayX balance is short the payout is queued, not failed. Top up the RazorpayX account.
* UPI payouts are capped at ₹1,00,000; larger amounts must go to a bank account (IMPS up to ₹5L, NEFT above).
* The ledger is never rewound automatically. A reversal after `paid` raises a high fraud alert for an admin adjustment.

## 8. Roadmap

Push notifications (FCM) · KYC/PAN capture (TDS u/s 194H)
· Excel/PDF native exports · Hindi UI · video hosting with signed URLs.
