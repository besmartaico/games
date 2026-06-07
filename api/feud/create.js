// POST /api/feud/create — host creates a new game
import { newGame, newPlayerId, newToken, saveGame } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const { name, settings } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });

    const host = {
      id: newPlayerId(),
      token: newToken(),
      name: name.substring(0, 24).trim(),
      teamId: 'A',
      connected: true
    };
    const game = newGame(host, settings || {});
    await saveGame(game);

    res.json({
      code: game.code,
      playerId: host.id,
      token: host.token
    });
  } catch (e) {
    console.error('feud/create error:', e);
    res.status(500).json({ error: e.message });
  }
}
