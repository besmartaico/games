// POST /api/feud/join — player joins existing game by code
import { getGame, saveGame, addPlayer } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const { code, name } = req.body || {};
    if (!code || !name) return res.status(400).json({ error: 'code and name required' });

    const game = await getGame(code.toUpperCase());
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (game.status !== 'lobby') return res.status(400).json({ error: 'Game already started' });

    const player = addPlayer(game, name);
    await saveGame(game);

    res.json({
      code: game.code,
      playerId: player.id,
      token: player.token
    });
  } catch (e) {
    console.error('feud/join error:', e);
    res.status(500).json({ error: e.message });
  }
}
