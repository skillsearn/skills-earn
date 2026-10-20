/**
 * Seeds the hierarchy from the specification so you can see real numbers in the UI:
 *   Rahul's Upline (Diamond) → Rahul (Platinum) → Amit (Gold) → Rohit (Gold) → Mohan (buys Diamond)
 * Expected commissions for Mohan's ₹6,000 purchase: Rohit 2400, Amit 360, Rahul 342, Upline 286.50.
 *
 *   npm run seed:demo -w apps/api        (password for all demo users: Demo@1234)
 * Development only — refuses to run when NODE_ENV=production.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const PASSWORD = 'Demo@1234';
const chain = [
  { key: 'upline', name: 'Suresh Kumar', mobile: '+919000000101', pkg: 'diamond' },
  { key: 'rahul', name: 'Rahul Sharma', mobile: '+919000000102', pkg: 'platinum' },
  { key: 'amit', name: 'Amit Verma', mobile: '+919000000103', pkg: 'gold' },
  { key: 'rohit', name: 'Rohit Singh', mobile: '+919000000104', pkg: 'gold' },
  { key: 'mohan', name: 'Mohan Das', mobile: '+919000000105', pkg: 'diamond' },
];

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('seed:demo is disabled in production');
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  const { data: pkgs } = await db.from('packages').select('id, slug, price');
  const bySlug = new Map((pkgs ?? []).map((p) => [p.slug, p]));
  let sponsorCode: string | null = null;

  for (const u of chain) {
    const email = `${u.key}@demo.skillsearn.in`;
    const { data: existing } = await db.from('profiles').select('id, referral_code').eq('email', email).maybeSingle();
    let id = existing?.id as string | undefined;
    let code = existing?.referral_code as string | undefined;

    if (!id) {
      const { data, error } = await db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      if (error || !data.user) throw error;
      id = data.user.id;
      const { data: prof, error: e2 }: { data: any; error: any } = await db.rpc('create_profile', {
        p_id: id, p_full_name: u.name, p_email: email, p_mobile: u.mobile, p_sponsor_code: sponsorCode, p_ip: null,
      });
      if (e2) throw e2;
      code = prof.referral_code;

      const pkg = bySlug.get(u.pkg)!;
      const { data: purchase, error: e3 } = await db
        .from('purchases')
        .insert({ user_id: id, package_id: pkg.id, type: 'new', amount: pkg.price, commission_base: pkg.price })
        .select('id')
        .single();
      if (e3) throw e3;
      const { error: e4 } = await db.rpc('activate_purchase', {
        p_purchase_id: purchase.id, p_provider: 'manual', p_payment_id: `demo_${u.key}`, p_verified_by: null,
      });
      if (e4) throw e4;
      console.log(`✓ ${u.name.padEnd(14)} ${email}  (${u.pkg})`);
    } else {
      console.log(`• ${u.name} already exists`);
    }
    sponsorCode = code ?? null;
  }

  const { data: mohan } = await db.from('profiles').select('id').eq('email', 'mohan@demo.skillsearn.in').single();
  const { data: purchase } = await db.from('purchases').select('id').eq('user_id', mohan!.id).eq('status', 'paid').limit(1).single();
  const { data: rows } = await db
    .from('commissions')
    .select('level, amount, status, beneficiary:profiles!commissions_beneficiary_id_fkey(full_name)')
    .eq('purchase_id', purchase!.id)
    .order('level');
  console.log('\nCommissions for Mohan\'s Diamond purchase:');
  for (const r of rows ?? []) {
    const who = (r.beneficiary as unknown as { full_name: string }).full_name;
    console.log(`  ${r.level === 0 ? 'Direct' : 'Gen ' + r.level}`.padEnd(10), who.padEnd(14), `₹${r.amount}`, r.status);
  }
  console.log(`\nLog in with any demo email and password ${PASSWORD}`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
