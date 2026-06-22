import { createClient } from '@supabase/supabase-js';

// Keep-alive endpoint, pinged daily by Vercel Cron (see vercel.json "crons").
// A free-tier Supabase project auto-pauses after ~7 days of no activity, which
// breaks every game with "TypeError: fetch failed". A tiny daily read against
// the shared `games` table keeps the project awake so it never idles out.
export default async function handler(req, res) {
  try {
    const sb = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );
    // Cheapest possible touch of the database — one row, one column.
    const { error } = await sb.from('games').select('code').limit(1);
    if (error) throw error;
    return res.status(200).json({ ok: true, ts: Date.now() });
  } catch (e) {
    console.error('keepalive error', e);
    return res.status(500).json({ ok: false, error: e.message || 'Internal error' });
  }
}
