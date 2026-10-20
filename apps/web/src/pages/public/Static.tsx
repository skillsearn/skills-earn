import { Link } from 'react-router-dom';

export function Terms() {
  const sections: [string, string][] = [
    ['Packages', 'Packages are one-time purchases that grant access to the courses of that tier and all lower tiers. A package is activated only after the payment is verified.'],
    ['Referral commission', 'When a user registers with your referral code and buys a package, you, as the Direct Referrer, earn the direct commission configured for that package. You cannot earn commission on your own purchases. Self-referrals and duplicate accounts are not allowed.'],
    ['Generation commission', 'Generation 1 is the Direct Referrer\'s upline, Generation 2 is the upline above Generation 1, and so on. Each beneficiary earns generation commission only if their own active package is eligible for that generation. Commission that a beneficiary is not eligible for is not transferred to anyone else.'],
    ['Upgrades', 'You may upgrade to a higher package by paying the price difference within the upgrade period shown in your dashboard. The original purchase is never re-processed for commission.'],
    ['Wallet', 'All earnings are recorded in your wallet ledger. Balances are calculated from ledger entries and cannot be edited by users.'],
    ['Withdrawals', 'Withdrawals can be requested during the schedule published by the administrator, subject to the minimum amount. A platform charge (currently 5%) is deducted from the gross withdrawal amount at payout. Failed payouts are returned to your wallet in full.'],
    ['Account suspension', 'Accounts involved in fraud, abuse or misrepresentation may be suspended. Suspended accounts do not receive new commissions.'],
    ['Income disclaimer', 'Earnings depend entirely on genuine package purchases by people you refer and are not guaranteed. SKILLSEARN does not pay for registrations alone.'],
  ];
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-bold tracking-tight">Terms & Conditions</h1>
      <p className="mt-2 text-sm text-slate-500">Please read these terms carefully before registering.</p>
      <div className="mt-8 space-y-6">
        {sections.map(([h, t], i) => (
          <section key={h}>
            <h2 className="font-semibold text-slate-900">{i + 1}. {h}</h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">{t}</p>
          </section>
        ))}
      </div>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <p className="text-6xl font-extrabold text-brand-600">404</p>
      <p className="mt-2 text-slate-600">This page does not exist.</p>
      <Link to="/" className="btn-gold mt-6 rounded-lg px-4 py-2 text-sm font-semibold">Go home</Link>
    </div>
  );
}
