import { createClient } from '@supabase/supabase-js';

/** Used ONLY for auth sessions (refresh, password recovery). All data goes through the API. */
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
});
