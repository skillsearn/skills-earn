/**
 * Creates (or promotes) an admin account.
 *   npm run create-admin -w apps/api -- admin@example.com 'StrongPass#1' "Owner Name" 9876543210
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { normalizeMobile } from '../common/util';

async function main() {
  const [email, password, fullName = 'Administrator', mobileRaw = '9000000000'] = process.argv.slice(2);
  if (!email || !password) {
    console.error('Usage: create-admin <email> <password> [full name] [mobile]');
    process.exit(1);
  }
  const mobile = normalizeMobile(mobileRaw);
  if (!mobile) throw new Error('Invalid mobile number');

  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: existing } = await db.from('profiles').select('id').eq('email', email.toLowerCase()).maybeSingle();
  if (existing) {
    await db.from('profiles').update({ role: 'admin' }).eq('id', existing.id);
    await db.auth.admin.updateUserById(existing.id, { password });
    console.log(`Promoted existing user ${email} to admin`);
    return;
  }

  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
  if (error || !data.user) throw error ?? new Error('createUser failed');

  const { error: rpcErr } = await db.rpc('create_profile', {
    p_id: data.user.id, p_full_name: fullName, p_email: email, p_mobile: mobile, p_sponsor_code: null, p_ip: null, p_role: 'admin',
  });
  if (rpcErr) {
    await db.auth.admin.deleteUser(data.user.id);
    throw rpcErr;
  }
  console.log(`Admin ${email} created`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
