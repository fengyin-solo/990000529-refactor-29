const express = require('express');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');
const { DEFAULT_COLUMNS } = require('../db/defaults');

const router = express.Router();

// All board routes require authentication
router.use(authMiddleware);

// One query produces the board row together with its column/card counts so
// the list and the batch summary can never disagree.
const BOARD_SUMMARY_SELECT = `
  SELECT b.*,
    (SELECT COUNT(*) FROM columns WHERE board_id = b.id) AS column_count,
    (SELECT COUNT(*) FROM cards c JOIN columns col ON c.column_id = col.id WHERE col.board_id = b.id) AS card_count
  FROM boards b
`;

// Fetch a single board (with counts), scoped to the requesting user.
function findBoardSummary(db, boardId, userId) {
  return db.prepare(`${BOARD_SUMMARY_SELECT} WHERE b.id = ? AND b.user_id = ?`).get(boardId, userId);
}

// GET /api/boards - List user's boards
router.get('/', (req, res) => {
  const db = getDb();
  try {
    const boards = db.prepare(`
      ${BOARD_SUMMARY_SELECT}
      WHERE b.user_id = ?
      ORDER BY b.created_at DESC
    `).all(req.user.id);
    db.close();
    res.json(boards);
  } catch (err) {
    db.close();
    res.status(500).json({ error: 'Failed to fetch boards' });
  }
});

// POST /api/boards/batch-summary
// Consolidated batch read: one request returns the column count, card count
// and actual/default columns for several boards. Each requested board is
// resolved independently, so one bad id never makes the whole call fail.
router.post('/batch-summary', (req, res) => {
  const { boardIds } = req.body || {};

  if (!Array.isArray(boardIds)) {
    return res.status(400).json({ error: 'boardIds must be an array' });
  }
  if (boardIds.some(id => !Number.isInteger(id) || id <= 0)) {
    return res.status(400).json({ error: 'boardIds must contain positive integer ids' });
  }
  if (boardIds.length > 100) {
    return res.status(400).json({ error: 'At most 100 boards can be requested at once' });
  }

  const db = getDb();
  try {
    const columnsStmt = db.prepare(`
      SELECT col.*,
        (SELECT COUNT(*) FROM cards WHERE column_id = col.id) AS card_count
      FROM columns col
      WHERE col.board_id = ?
      ORDER BY col.position ASC
    `);

    // Keep request order for the response, but read each board only once.
    const seen = new Set();
    const results = [];
    let successCount = 0;
    let failureCount = 0;
    let totalColumns = 0;
    let totalCards = 0;

    for (const rawId of boardIds) {
      if (seen.has(rawId)) continue;
      seen.add(rawId);

      const board = findBoardSummary(db, rawId, req.user.id);
      if (!board) {
        failureCount += 1;
        results.push({
          board_id: rawId,
          ok: false,
          error: 'Board not found'
        });
        continue;
      }

      // The columns table is the authoritative source for the default
      // columns: newly created boards report what actually got persisted.
      const columns = columnsStmt.all(board.id);

      successCount += 1;
      totalColumns += board.column_count;
      totalCards += board.card_count;
      results.push({
        board_id: board.id,
        ok: true,
        board,
        column_count: board.column_count,
        card_count: board.card_count,
        columns,
        // Per-column card counts must add up to the board total.
        default_column_names: DEFAULT_COLUMNS
      });
    }

    db.close();
    res.json({
      results,
      summary: {
        requested: boardIds.length,
        succeeded: successCount,
        failed: failureCount,
        total_columns: totalColumns,
        total_cards: totalCards
      }
    });
  } catch (err) {
    db.close();
    res.status(500).json({ error: 'Failed to fetch board summaries' });
  }
});

// POST /api/boards - Create board
router.post('/', (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Board name is required' });
  }

  const db = getDb();
  try {
    let boardId;

    // Board + default columns are one unit of work: a failure while seeding
    // columns rolls the board back instead of leaving an empty, broken board.
    const createBoard = db.transaction(() => {
      const result = db.prepare('INSERT INTO boards (user_id, name, description) VALUES (?, ?, ?)').run(
        req.user.id,
        name.trim(),
        description || ''
      );
      boardId = result.lastInsertRowid;

      const insertCol = db.prepare('INSERT INTO columns (board_id, name, position) VALUES (?, ?, ?)');
      DEFAULT_COLUMNS.forEach((colName, index) => insertCol.run(boardId, colName, index));
    });
    createBoard();

    // Return the same shape as the list/detail endpoints plus the seeded
    // columns, so the frontend can render the board immediately without a
    // follow-up round trip and without showing wrong zero counts.
    const board = findBoardSummary(db, boardId, req.user.id);
    const columns = db.prepare(`
      SELECT col.*,
        (SELECT COUNT(*) FROM cards WHERE column_id = col.id) AS card_count
      FROM columns col
      WHERE col.board_id = ?
      ORDER BY col.position ASC
    `).all(boardId);

    db.close();
    res.status(201).json({ ...board, columns });
  } catch (err) {
    db.close();
    res.status(500).json({ error: 'Failed to create board' });
  }
});

// DELETE /api/boards/:id - Delete board
router.delete('/:id', (req, res) => {
  const db = getDb();
  try {
    const board = db.prepare('SELECT * FROM boards WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!board) {
      db.close();
      return res.status(404).json({ error: 'Board not found' });
    }

    db.prepare('DELETE FROM boards WHERE id = ?').run(req.params.id);
    db.close();
    res.json({ message: 'Board deleted' });
  } catch (err) {
    db.close();
    res.status(500).json({ error: 'Failed to delete board' });
  }
});

module.exports = router;
