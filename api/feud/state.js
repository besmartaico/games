// POST/GET /api/feud/state — polling endpoint, returns redacted state
import { getGame, redactState } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'POST or GET only' });
  try {
    const params = req.method === 'POST' ? (req.body || {}) : (req.query || {});
    const { code, playerId, token } = params;
    if (!code || !playerId) return res.status(400).json({ error: 'code and playerId required' });

    const game = await getGame(code.toUpperCase());
    if (!game) return res.status(404).json({ error: 'Game not found' });

    const p = game.players.find(x => x.id === playerId);
    if (token && p && p.token !== token) return res.status(403).json({ error: 'Invalid token' });

    res.setHeader('Cache-Control', 'no-store');
    res.json(redactState(game, playerId));
  } catch (e) {
    console.error('feud/state error:', e);
    res.status(500).json({ error: e.message });
  }
}
