// Family Feud — shared game logic + Supabase storage + question fetching
// Used by all /api/feud/* endpoints.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// ============ Storage (Supabase) ============
let _sb = null;
function getSupabase() {
  if (_sb) return _sb;
  _sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
  return _sb;
}

export async function getGame(code) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('games')
    .select('state, expires_at')
    .eq('code', code)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  return data ? data.state : null;
}

export async function saveGame(game) {
  game.updatedAt = Date.now();
  const sb = getSupabase();
  const { error } = await sb
    .from('games')
    .upsert({
      code: game.code,
      state: game,
      expires_at: new Date(Date.now() + 86400 * 1000).toISOString(),
      updated_at: new Date().toISOString()
    });
  if (error) throw error;
}

// ============ ID generation ============
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export function newGameCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}
export function newPlayerId() { return 'p_' + crypto.randomBytes(8).toString('hex'); }
export function newToken() { return crypto.randomBytes(16).toString('hex'); }

// ============ Question fetching from Google Sheets ============
const SHEET_ID = '1LjT4WU36_B8WQA4UVzVEtBYaxvGl6UdONYFK5MIJFZ4';

export async function fetchQuestions() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=0`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Sheet fetch failed: ' + resp.status);
  const csv = await resp.text();
  return parseQuestionsCsv(csv);
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i+1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cell += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c === '\r') { /* skip */ }
      else cell += c;
    }
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function parseQuestionsCsv(csv) {
  const rows = parseCsv(csv).filter(r => r.length && r.some(c => c && c.trim()));
  if (!rows.length) return [];
  const headers = rows[0].map(h => (h || '').trim());
  const questions = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = (name) => {
      const idx = headers.indexOf(name);
      return idx >= 0 ? (r[idx] || '').trim() : '';
    };
    const question = get('Question');
    if (!question) continue;
    const answers = [];
    for (let a = 1; a <= 8; a++) {
      const text = get('Answer ' + a);
      const ptsRaw = get('Points ' + a);
      const points = parseInt(ptsRaw, 10);
      if (text && !isNaN(points) && points > 0) {
        answers.push({ text, points, rank: answers.length });
      }
    }
    if (!answers.length) continue;
    const round = parseInt(get('Round'), 10) || 1;
    questions.push({ id: i, question, answers, round });
  }
  return questions;
}

// ============ Fuzzy matching ============
function normalize(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const v0 = new Array(b.length + 1);
  const v1 = new Array(b.length + 1);
  for (let i = 0; i <= b.length; i++) v0[i] = i;
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= b.length; j++) v0[j] = v1[j];
  }
  return v1[b.length];
}

// Returns index of matched answer or -1.
export function matchGuess(guess, answers) {
  const ng = normalize(guess);
  if (!ng) return -1;
  for (let i = 0; i < answers.length; i++) {
    if (normalize(answers[i].text) === ng) return i;
  }
  for (let i = 0; i < answers.length; i++) {
    const na = normalize(answers[i].text);
    if (ng.length >= 3 && na.length >= 3 && (na.includes(ng) || ng.includes(na))) return i;
  }
  let bestIdx = -1, bestScore = Infinity;
  for (let i = 0; i < answers.length; i++) {
    const na = normalize(answers[i].text);
    const dist = levenshtein(ng, na);
    const maxLen = Math.max(ng.length, na.length);
    if (maxLen >= 4 && dist / maxLen < 0.25 && dist < bestScore) {
      bestScore = dist; bestIdx = i;
    }
  }
  return bestIdx;
}

// ============ Game phases ============
export const PHASES = {
  LOBBY: 'lobby',
  FACEOFF: 'faceoff',
  CONTROL: 'control',
  STEAL: 'steal',
  REVEAL: 'reveal',
  BETWEEN: 'between',
  GAME_OVER: 'gameOver'
};

// ============ Game lifecycle ============
export function newGame(hostPlayer, settings) {
  const code = newGameCode();
  return {
    code,
    host: hostPlayer.id,
    status: 'lobby',
    players: [hostPlayer],
    teams: {
      A: { name: 'Family A', score: 0 },
      B: { name: 'Family B', score: 0 }
    },
    questions: [],
    settings: { roundsTotal: (settings && settings.roundsTotal) || 3 },
    currentRound: -1,
    state: { phase: PHASES.LOBBY },
    chat: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

export function addChat(game, playerId, text) {
  const p = game.players.find(x => x.id === playerId);
  if (!p) return;
  game.chat.push({
    id: crypto.randomBytes(4).toString('hex'),
    playerId, name: p.name, text: (text || '').substring(0, 200), ts: Date.now()
  });
  if (game.chat.length > 100) game.chat = game.chat.slice(-100);
}

export function startGame(game, questions) {
  if (game.players.length < 2) throw new Error('Need at least 2 players to start');
  // Need at least 1 player per team
  const aCount = game.players.filter(p => p.teamId === 'A').length;
  const bCount = game.players.filter(p => p.teamId === 'B').length;
  if (aCount < 1 || bCount < 1) throw new Error('Each team needs at least 1 player');
  const shuffled = [...questions].sort(() => Math.random() - 0.5);
  game.questions = shuffled.slice(0, game.settings.roundsTotal).map((q, i) => ({
    id: q.id,
    question: q.question,
    answers: q.answers,
    round: q.round,
    multiplier: i + 1,
    revealed: q.answers.map(() => false),
    answeredBy: {}
  }));
  game.status = 'playing';
  game.currentRound = 0;
  beginRound(game);
}

function beginRound(game) {
  game.state = {
    phase: PHASES.FACEOFF,
    strikes: 0,
    pot: 0,
    controllingTeam: null,
    faceoffGuesses: {},
    turnOrder: null,
    turnIdx: 0,
    lastResult: null
  };
}

export function submitGuess(game, playerId, guessText) {
  const player = game.players.find(p => p.id === playerId);
  if (!player) throw new Error('Not a player');
  const phase = game.state.phase;
  const q = game.questions[game.currentRound];
  if (!q) throw new Error('No active question');
  const matchIdx = matchGuess(guessText, q.answers);
  if (phase === PHASES.FACEOFF) return handleFaceoffGuess(game, player, guessText, matchIdx);
  if (phase === PHASES.CONTROL) return handleControlGuess(game, player, guessText, matchIdx);
  if (phase === PHASES.STEAL) return handleStealGuess(game, player, guessText, matchIdx);
  throw new Error('Not accepting guesses in current phase');
}

function handleFaceoffGuess(game, player, guessText, matchIdx) {
  const teamId = player.teamId;
  if (!teamId) throw new Error('Player not on a team');
  if (game.state.faceoffGuesses[teamId]) throw new Error('Your team already submitted a face-off guess');
  const q = game.questions[game.currentRound];
  game.state.faceoffGuesses[teamId] = {
    playerId: player.id, playerName: player.name, guess: guessText,
    matchIdx, points: matchIdx >= 0 ? q.answers[matchIdx].points : 0
  };
  if (game.state.faceoffGuesses.A && game.state.faceoffGuesses.B) {
    return resolveFaceoff(game);
  }
  return { ok: true, phase: 'faceoff', matchIdx };
}

function resolveFaceoff(game) {
  const q = game.questions[game.currentRound];
  const gA = game.state.faceoffGuesses.A;
  const gB = game.state.faceoffGuesses.B;
  let winner = null, winnerGuess = null;
  if (gA.matchIdx >= 0 && gB.matchIdx >= 0) {
    winner = gA.matchIdx <= gB.matchIdx ? 'A' : 'B';
    winnerGuess = winner === 'A' ? gA : gB;
  } else if (gA.matchIdx >= 0) { winner = 'A'; winnerGuess = gA; }
  else if (gB.matchIdx >= 0) { winner = 'B'; winnerGuess = gB; }
  if (!winner) {
    // Neither correct — random control
    winner = Math.random() < 0.5 ? 'A' : 'B';
    game.state.phase = PHASES.CONTROL;
    game.state.controllingTeam = winner;
    setTurnOrder(game);
    return { ok: true, faceoffResolved: true, winner, neitherCorrect: true };
  }
  q.revealed[winnerGuess.matchIdx] = true;
  q.answeredBy[winnerGuess.matchIdx] = winnerGuess.playerId;
  game.state.pot = winnerGuess.points;
  game.state.controllingTeam = winner;
  game.state.phase = PHASES.CONTROL;
  setTurnOrder(game);
  return { ok: true, faceoffResolved: true, winner, revealed: winnerGuess.matchIdx };
}

function setTurnOrder(game) {
  const team = game.state.controllingTeam;
  const tp = game.players.filter(p => p.teamId === team);
  game.state.turnOrder = tp.map(p => p.id);
  game.state.turnIdx = 0;
}

function handleControlGuess(game, player, guessText, matchIdx) {
  if (player.teamId !== game.state.controllingTeam) {
    throw new Error('Only the controlling team can guess right now');
  }
  const q = game.questions[game.currentRound];
  if (matchIdx >= 0 && !q.revealed[matchIdx]) {
    q.revealed[matchIdx] = true;
    q.answeredBy[matchIdx] = player.id;
    const pts = q.answers[matchIdx].points;
    game.state.pot += pts;
    game.state.lastResult = { type: 'correct', playerId: player.id, playerName: player.name, guess: guessText, matchIdx, points: pts };
    if (q.revealed.every(r => r)) return endRoundForControl(game);
    return { ok: true, type: 'correct', matchIdx, points: pts };
  } else {
    const dup = matchIdx >= 0 && q.revealed[matchIdx];
    game.state.lastResult = { type: dup ? 'duplicate' : 'wrong', playerId: player.id, playerName: player.name, guess: guessText };
    game.state.strikes++;
    if (game.state.strikes >= 3) {
      game.state.phase = PHASES.STEAL;
      return { ok: true, type: 'strike', strikes: 3, stealPhase: true };
    }
    return { ok: true, type: 'strike', strikes: game.state.strikes };
  }
}

function endRoundForControl(game) {
  const team = game.state.controllingTeam;
  const q = game.questions[game.currentRound];
  const pts = game.state.pot * q.multiplier;
  game.teams[team].score += pts;
  game.state.phase = PHASES.REVEAL;
  game.state.lastResult = { type: 'roundWonByControl', team, points: pts };
  return { ok: true, type: 'roundEnd', team, points: pts };
}

function handleStealGuess(game, player, guessText, matchIdx) {
  const stealingTeam = game.state.controllingTeam === 'A' ? 'B' : 'A';
  if (player.teamId !== stealingTeam) throw new Error('Only the stealing team can guess now');
  const q = game.questions[game.currentRound];
  const pts = game.state.pot * q.multiplier;
  if (matchIdx >= 0 && !q.revealed[matchIdx]) {
    q.revealed[matchIdx] = true;
    q.answeredBy[matchIdx] = player.id;
    game.teams[stealingTeam].score += pts;
    game.state.phase = PHASES.REVEAL;
    game.state.lastResult = { type: 'stealSuccess', team: stealingTeam, playerId: player.id, playerName: player.name, guess: guessText, matchIdx, points: pts };
    return { ok: true, type: 'stealSuccess', team: stealingTeam, points: pts };
  } else {
    game.teams[game.state.controllingTeam].score += pts;
    game.state.phase = PHASES.REVEAL;
    game.state.lastResult = { type: 'stealFail', team: game.state.controllingTeam, points: pts };
    return { ok: true, type: 'stealFail', team: game.state.controllingTeam, points: pts };
  }
}

export function nextRound(game) {
  if (game.state.phase !== PHASES.REVEAL) throw new Error('Not in reveal phase');
  game.currentRound++;
  if (game.currentRound >= game.questions.length) return endGame(game);
  beginRound(game);
  return { ok: true, round: game.currentRound };
}

function endGame(game) {
  game.status = 'finished';
  game.state.phase = PHASES.GAME_OVER;
  game.state.winnerTeam = game.teams.A.score > game.teams.B.score ? 'A' :
                         game.teams.B.score > game.teams.A.score ? 'B' : null;
  return { ok: true, gameOver: true, winnerTeam: game.state.winnerTeam };
}

// ============ Player management ============
export function addPlayer(game, name) {
  if (game.players.length >= 10) throw new Error('Game full');
  if (game.status !== 'lobby') throw new Error('Game already started');
  const id = newPlayerId();
  const token = newToken();
  const aCount = game.players.filter(p => p.teamId === 'A').length;
  const bCount = game.players.filter(p => p.teamId === 'B').length;
  const teamId = bCount < aCount ? 'B' : 'A';
  const player = { id, token, name: (name || '').substring(0, 24).trim(), teamId, connected: true };
  game.players.push(player);
  return player;
}

export function switchTeam(game, playerId, newTeam) {
  const p = game.players.find(x => x.id === playerId);
  if (!p) throw new Error('Player not found');
  if (newTeam !== 'A' && newTeam !== 'B') throw new Error('Invalid team');
  p.teamId = newTeam;
}

// ============ State redaction (per-viewer) ============
export function redactState(game, viewerId) {
  return {
    code: game.code,
    host: game.host,
    status: game.status,
    players: game.players.map(p => ({ id: p.id, name: p.name, teamId: p.teamId, connected: p.connected })),
    teams: game.teams,
    settings: game.settings,
    currentRound: game.currentRound,
    questions: (game.questions || []).map((q, i) => {
      if (i > game.currentRound) return { id: q.id, hidden: true };
      const isGameOver = game.state.phase === 'gameOver';
      const isPast = i < game.currentRound;
      return {
        id: q.id,
        question: q.question,
        multiplier: q.multiplier,
        revealed: q.revealed,
        answers: q.answers.map((a, ai) => {
          const r = q.revealed[ai] || isPast || isGameOver;
          return r ? { text: a.text, points: a.points, rank: ai } : { rank: ai, hidden: true };
        }),
        answeredBy: q.answeredBy
      };
    }),
    state: game.state,
    chat: game.chat,
    you: game.players.find(p => p.id === viewerId) || null,
    updatedAt: game.updatedAt
  };
}

export function playerById(game, id) {
  return game.players.find(p => p.id === id);
}
