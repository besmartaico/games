import { getGame, addChat, saveGame, redactState } from './_lib.js';

// This endpoint proxies bot chat messages through Claude API.
// Only the host can trigger bot chat (prevents abuse).
// Requires ANTHROPIC_API_KEY env var.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { code, playerId, token, botId } = body;
    if (!code || !playerId || !token || !botId) {
      return res.status(400).json({ error: 'code, playerId, token, botId required' });
    }
    const upperCode = String(code).toUpperCase().trim();

    const game = await getGame(upperCode);
    if (!game) return res.status(404).json({ error: 'Game not found' });

    const host = game.players.find(p => p.id === playerId && p.token === token && p.id === game.host);
    if (!host) return res.status(403).json({ error: 'Only host can trigger bot chat' });

    if (!game.settings.aiChat) {
      return res.status(400).json({ error: 'AI chat is disabled for this game' });
    }

    const bot = game.players.find(p => p.id === botId && p.isBot);
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    if (!bot.alive) return res.status(400).json({ error: 'Bot is eliminated' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'AI chat not configured (no API key)' });
    }

    // Build context for the bot
    const recentChat = (game.chat || []).slice(-15).map(m =>
      `${m.system ? '[system]' : m.name}: ${m.text}`
    ).join('\n');
    const recentLog = (game.log || []).slice(-8).map(l => l.msg).join('\n');
    const aliveCount = game.players.filter(p => p.alive).length;
    const moleCount = game.players.filter(p => p.alive && (p.role === 'mole' || p.role === 'chief')).length;

    const persona = bot.role === 'loyalist'
      ? 'You are a loyal Agency operative trying to figure out who the moles are. You are sincere, slightly paranoid, and want to root out traitors. Speculate about who might be a mole based on recent actions.'
      : bot.role === 'mole'
        ? 'You are a MOLE secretly working for the rival faction. You must blend in, deflect suspicion, sow doubt about loyalists, and subtly support fellow moles WITHOUT obviously revealing yourself. Never explicitly admit you are a mole.'
        : 'You are the MOLE CHIEF. You are deep undercover. Act exactly like a loyal agent — be helpful, suspicious of others, and never let on that you are the chief. Your survival is paramount to your team winning.';

    const prompt = `You are playing "The Baddies", a social deduction game (Secret Hitler-style spy thriller). Your name in this game is "${bot.name}".

YOUR SECRET ROLE: ${bot.role}
${persona}

GAME STATE:
- ${aliveCount} agents alive
- Clean missions: ${game.state.missionTrack?.clean || 0}/5
- Compromised missions: ${game.state.missionTrack?.compromised || 0}/6
- Current phase: ${game.state.phase}

RECENT GAME LOG:
${recentLog}

RECENT CHAT:
${recentChat}

Write ONE short chat message (under 25 words) as ${bot.name}. Be conversational, make accusations, defend yourself, or bait others. Don't use quotation marks. Don't introduce yourself. Just the message text.`;

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error('Anthropic API error:', apiRes.status, errText);
      return res.status(500).json({ error: 'AI chat request failed' });
    }

    const apiData = await apiRes.json();
    let text = '';
    if (apiData.content && Array.isArray(apiData.content)) {
      for (const block of apiData.content) {
        if (block.type === 'text') text += block.text;
      }
    }
    text = text.trim().replace(/^["']|["']$/g, '').substring(0, 200);
    if (!text) return res.status(500).json({ error: 'Empty AI response' });

    addChat(game, botId, text);
    await saveGame(game);
    return res.status(200).json(redactState(game, playerId));
  } catch (e) {
    console.error('botchat error', e);
    return res.status(500).json({ error: e.message || 'Internal error' });
  }
}
