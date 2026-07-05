// GET /api/memory/cards — Q/A pairs for Memory Match, from a Google Sheet.
// Sheet columns (header row required, case-insensitive): id | question | answer
// The id column is optional — row number is used when missing.
// Until a sheet is configured, built-in sample cards are served so the game stays playable.

const SHEET_ID = process.env.MEMORY_SHEET_ID || '';

const SAMPLE_CARDS = [
  { id: '1', question: 'What planet is known as the Red Planet?', answer: 'Mars' },
  { id: '2', question: 'How many legs does a spider have?', answer: '8' },
  { id: '3', question: 'What is the largest ocean on Earth?', answer: 'Pacific Ocean' },
  { id: '4', question: 'What do bees make?', answer: 'Honey' },
  { id: '5', question: 'What is the capital of France?', answer: 'Paris' },
  { id: '6', question: 'How many sides does a triangle have?', answer: '3' },
  { id: '7', question: 'What animal is the tallest in the world?', answer: 'Giraffe' },
  { id: '8', question: 'What color do you get mixing blue and yellow?', answer: 'Green' },
  { id: '9', question: 'How many continents are there?', answer: '7' },
  { id: '10', question: 'What is frozen water called?', answer: 'Ice' },
  { id: '11', question: 'Which bird is known for repeating words?', answer: 'Parrot' },
  { id: '12', question: 'How many minutes are in an hour?', answer: '60' },
  { id: '13', question: 'What is the closest star to Earth?', answer: 'The Sun' },
  { id: '14', question: 'What do caterpillars turn into?', answer: 'Butterflies' },
  { id: '15', question: 'Which country is home to kangaroos?', answer: 'Australia' }
];

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

async function fetchSheetCards() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=0`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Sheet fetch failed: ' + resp.status);
  const csv = await resp.text();
  const rows = parseCsv(csv).filter(r => r.length && r.some(c => c && c.trim()));
  if (!rows.length) return [];
  const headers = rows[0].map(h => (h || '').trim().toLowerCase());
  const idI = headers.indexOf('id');
  const qI = headers.indexOf('question');
  const aI = headers.indexOf('answer');
  if (qI < 0 || aI < 0) {
    throw new Error('Sheet needs header row with columns: question, answer (found: ' + headers.join(', ') + ')');
  }
  const cards = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const question = (r[qI] || '').trim();
    const answer = (r[aI] || '').trim();
    if (!question || !answer) continue;
    const id = idI >= 0 && (r[idI] || '').trim() ? (r[idI] || '').trim() : String(i);
    cards.push({ id, question, answer });
  }
  return cards;
}

export default async function handler(req, res) {
  try {
    if (!SHEET_ID) {
      return res.json({ count: SAMPLE_CARDS.length, cards: SAMPLE_CARDS, source: 'sample' });
    }
    const cards = await fetchSheetCards();
    res.json({ count: cards.length, cards, source: 'sheet' });
  } catch (e) {
    console.error('memory/cards error:', e);
    res.status(500).json({ error: e.message });
  }
}
