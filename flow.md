# Flows — SKILLSEARN

## 1. Registration → payment → activation

```
Visitor opens  /register?ref=AB12CD34
  │  GET /api/referrals/validate/AB12CD34  → shows "Referred by Rohit (SE100003)"
  │  fills: name, email, mobile, password, package, referral code, ✔ terms
  ▼
POST /api/auth/register
  1. DTO validation (mobile normalised to +91XXXXXXXXXX)
  2. email / mobile uniqueness check
  3. sponsor code → sponsor profile (must exist & not suspended)
     – self-referral blocked (sponsor email/mobile == new user's)
  4. supabase.auth.admin.createUser(email, password, email_confirm)
  5. rpc create_profile → user_code SE1000xx, referral_code, sponsor_id,
                          ancestors = [sponsor, …sponsor.ancestors]
                          fraud check: >3 signups from same IP / 24 h → alert
  6. insert purchase {type:new, status:pending, amount=package.price}
  7. sign in → return session
     (on failure after step 4 the auth user is deleted — no orphans)
  ▼
/app/checkout/:purchaseId
  POST /api/payments/checkout {purchaseId}
    ├─ razorpay → create order (amount in paise) → Razorpay Checkout opens
    │      success handler → POST /api/payments/verify {order, payment, signature}
    │      and/or webhook payment.captured (HMAC) — whichever comes first
    └─ mock (dev) → "Simulate payment" → POST /api/payments/mock/:id/confirm
  ▼
rpc activate_purchase(purchase, payment_id)        ── single DB transaction ──
  • lock purchase; already paid → return (idempotent)
  • status = paid; profile.active_package = package; activated_at = now
  • notification "Package activated"
  • rpc process_commissions(purchase)  (see §2)
```

The wallet ledger exists from the start: it is the append-only `wallet_ledger` table,
so a user with no entries has a ₹0 balance.

## 2. Commission engine (per verified purchase)

```
purchaser P,  base B (= price, or commissionable part of upgrade difference)
DR  = P.sponsor                      (direct referrer)
U1  = P.ancestors[2]                 Generation 1 (DR's upline)
U2  = P.ancestors[3]                 Generation 2
U3  = P.ancestors[4]                 Generation 3
r1,r2,r3 = current commission_rule_versions.generation_rates (15 %,12 %,8 %)

D  = B × package.direct_rate                       (40 %)
G1 = D × r1
G2 = D × r2 + G1 × r1
G3 = D × r3 + G1 × r2 + G2 × r1
(each step rounded to ₹0.01; amounts are computed even if a beneficiary is skipped,
 so one ineligible upline never changes another's amount)

for each (beneficiary, level, amount):
  beneficiary missing            → stop (no row)
  suspended / no active package  → commission row status=skipped (reason)
  level ≥ 1 and beneficiary.active_package.max_generations < level → skipped
  else                           → hold_days = 0 ? credited + ledger entry
                                                 : pending (available_at)
purchase.commission_status = processed
```

Guarantees: `commissions UNIQUE(purchase_id, level)`, purchase row lock,
`commission_status` check → a second call inserts a **duplicate_commission_attempt**
fraud alert and changes nothing. Skipped amounts are **not** passed to anyone else.

**Worked example (from the PDF):** Rahul's upline → Rahul → Amit → Rohit → Mohan.
Mohan buys Diamond ₹6,000:

| Beneficiary   | Level | Amount   | Needs package    |
|---------------|-------|----------|------------------|
| Rohit         | direct| ₹2,400.00| any active       |
| Amit          | G1    | ₹360.00  | Gold+            |
| Rahul         | G2    | ₹342.00  | Platinum+        |
| Rahul's upline| G3    | ₹286.50  | Diamond          |

## 3. Upgrade

```
/app/upgrade → GET /api/payments/upgrade-options
   lists higher packages, payable = new.price − current.price, deadline =
   activated_at + upgrade.windowDays (0 = no deadline)
POST /api/payments/upgrade {packageId}
   → purchase {type:upgrade, from_package, amount=difference,
               commission_base = commissionable ? difference × baseBps : 0}
   → same checkout / verify path
activate_purchase(upgrade):
   current package must still equal from_package (else reject)
   active_package = new (course access + generation eligibility follow instantly)
   commissions only if commission_base > 0 (original purchase never re-processed)
```

## 4. Wallet & withdrawal

```
Ledger types: direct_commission(+) · generation_commission(+) · withdrawal_hold(−)
              withdrawal_hold_release(+) · successful_withdrawal(−) · platform_charge(−)
              failed_withdrawal_release(+) · admin_adjustment(±)
Available balance = Σ amount   (never stored, never user-editable)

User: /app/withdrawals
  GET /me/withdrawals/quote?amount=1000
      → { gross 1000, chargeBps 500, charge 50, net 950, windowOpen, nextWindow,
          minAmount, available }
  POST /me/withdrawals {amount, method: upi|bank, details}
      rpc request_withdrawal:
        processing enabled? window open (IST)? amount ≥ min? ≤ available?
        no other open request?  → insert (requested) + ledger withdrawal_hold −gross

Admin: /admin/withdrawals  (same gross / 5 % / net breakdown shown)
  requested ─▶ under_review ─▶ approved ─▶ processing ─▶ paid
      │             │             │             └──────▶ failed
      └─────────────┴─────────────┴──▶ rejected
  rpc transition_withdrawal (row lock, legal transitions only):
    paid     → requires payment reference;
               ledger: hold_release +gross, successful_withdrawal −net,
                       platform_charge −charge      (net effect −gross)
    rejected / failed → failed_withdrawal_release +gross (no charge taken)
  every transition → withdrawal_events + audit_logs + user notification
```

Example: ₹5,000 request → hold −5,000 → paid ref UTR123 → +5,000 −4,750 −250.

### 4a. Automatic payout (RazorpayX)

Enabled when `RAZORPAYX_ACCOUNT_NUMBER` is set (same Razorpay key/secret). Manual "Mark paid" still works.

```
Admin opens an APPROVED withdrawal → "Pay ₹950"
  POST /admin/withdrawals/:id/payout
    claim row: status=approved, payout_id null, payout_status null|initiation_failed
               → payout_status=initiating          (one statement: no double payout)
    contact      POST /v1/contacts       (once per user, cached in profiles.razorpay_contact_id)
    fund account POST /v1/fund_accounts  (vpa for UPI, bank_account for bank; saved on the row)
    payout       POST /v1/payouts  amount=net, mode UPI | IMPS (≤ ₹5L) | NEFT,
                 reference_id=withdrawal id, header X-Payout-Idempotency=wd-<id>
      error  → payout_status=initiation_failed + payout_error; still approved; admin can retry
      ok     → payout_id saved; transition approved → processing
Settlement (whichever arrives first; all idempotent):
  webhook payout.processed | payout.failed | payout.reversed | payout.rejected
          → POST /api/payments/webhook/razorpay (same endpoint + secret as payments)
  cron every 10 min → GET /v1/payouts/:id for every processing payout
  admin "Refresh status" → POST /admin/withdrawals/:id/payout/sync
  processed                          → transition paid (reference = UTR) → normal paid ledger entries
  failed / reversed / rejected / cancelled → transition failed → full gross back to wallet
  reversed after already paid        → fraud_alerts 'payout_reversed' (high) for manual handling
```

## 5. Courses

```
packages.level: Gold 1 · Platinum 2 · Diamond 3
course.min_package_level ≤ user's active package level → unlocked
GET /courses       → all published, with locked flag
GET /courses/:slug → lessons; video/content only when unlocked (enrolment row created)
POST /courses/lessons/:id/complete → progress
```

## 6. Admin

```
login (same /login) → role=admin → /admin  (login recorded in audit_logs)
Dashboard   totals, package-wise users, sales, commissions, payouts, charges, enrolments
Reports     daily / weekly / monthly series (sales, commissions, withdrawals)
Users       search → detail: upline chain, downline by generation, purchases,
            commissions, ledger, suspend/reactivate (audited), wallet adjustment (audited)
Packages    CRUD price / direct rate / max generations / level; generation-rate versions
Courses     CRUD courses + lessons
Payments    pending / failed / paid, gateway events, manual verify (reconciliation)
Commissions purchase-wise breakdown, status, manual release
Withdrawals workflow above + CSV export
Settings    withdrawal schedule (weekly day / monthly date / window / min / charge %
            / processing on-off / manual payout confirmation), upgrade, commission hold,
            registration → every change audited with before/after
Fraud       IP bursts, duplicate commission attempts → resolve
Audit       filterable log
Announce    broadcast in-app notification
```

## 7. Scheduled jobs

| Every    | Job                                    |
|----------|----------------------------------------|
| 10 min   | `release_pending_commissions()`        |
