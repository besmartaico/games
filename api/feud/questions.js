// GET /api/feud/questions — full question list from the Google Sheet.
// Used by Classroom Mode, where a single host screen shows and judges everything,
// so there is no per-viewer redaction. The sheet is public anyway.
import { fetchQuestions } from './_lib.js';

export default async function handler(req, res) {
  try {
    const questions = await fetchQuestions();
    res.json({ count: questions.length, questions });
  } catch (e) {
    console.error('feud/questions error:', e);
    res.status(500).json({ error: e.message });
  }
}
