// POST /api/feud/action — game actions: startGame, switchTeam, submitGuess, nextRound, chat
import {
  getGame, saveGame, startGame, submitGuess, nextRound, switchTeam, addChat, fetchQuestions
} from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const { code, playerId, token, action, payload } = req.body || {};
    if (!code || !playerId || !action) return res.status(400).json({ error: 'code, playerId, action required' });

    const game = await getGame(code.toUpperCase());
    if (!game) return res.status(404).json({ error: 'Game not found' });

    const player = game.players.find(x => x.id === playerId);
    if (!player) return res.status(403).json({ error: 'Not a player' });
    if (token && player.token !== token) return res.status(403).json({ error: 'Invalid token' });

    let result = null;
    switch (action) {
      case 'startGame': {
        if (game.host !== playerId) throw new Error('Only host can start');
        const pool = await fetchQuestions();
        if (!pool.length) throw new Error('No questions available — check the source sheet');
        startGame(game, pool);
        result = { ok: true, started: true };
        break;
      }
      case 'switchTeam': {
        if (game.status !== 'lobby') throw new Error('Can only switch teams in lobby');
        switchTeam(game, playerId, payload && payload.team);
        result = { ok: true };
        break;
      }
      case 'submitGuess': {
        result = submitGuess(game, playerId, payload && payload.guess);
        break;
      }
      case 'nextRound': {
        if (game.host !== playerId) throw new Error('Only host can advance round');
        result = nextRound(game);
        break;
      }
      case 'chat': {
        addChat(game, playerId, payload && payload.text);
        result = { ok: true };
        break;
      }
      default:
        throw new Error('Unknown action: ' + action);
    }

    await saveGame(game);
    res.json(result);
  } catch (e) {
    console.error('feud/action error:', e);
    res.status(400).json({ error: e.message });
  }
}
