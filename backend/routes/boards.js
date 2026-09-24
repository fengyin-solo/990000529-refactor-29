const express = require('express');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');
const {
  DEFAULT_COLUMNS,
  listBoardSummaries,
  getBoardSummary,
  getBoardDetail
} = require('../db/boardQueries');

const router = express.Router();

// All board routes require authentication
router.use(authMiddleware);

// GET /api/boards - List user's boards (with counts + default column)
router.get('/', (req, res) => {
  const db = getDb();
  try {
    const boards = listBoardSummaries(db, req.user.id);
    db.close();
    res.json(boards);
  } catch (err) {
    db.close();
    res.status(500).json({ error: 'Failed to fetch boards' });
  }
});

// POST /api/boards/batch-summary - Summarize several boards in one request.
// Body: { ids: number[] }
//
// Returns one result per requested id (in request order) with an `ok` flag so
// that callers can handle partial failures per board, plus a single aggregate
// that is computed from the successful items only. The counts are produced by
// the same query as GET /api/boards and GET /api/boards/:id, so the totals
// always match the individual board details.
router.post('/batch-summary', (req, res) => {
  let ids = req.body && req.body.ids;
  if (!Array.isArray(ids)) {
    return res.status(400).json({ error: 'Request body must contain an "ids" array' });
  }

  const db = getDb();
  try {
    // Deduplicate while preserving order; an empty selection is a valid
    // (successful, zeroed) result.
    const seen = new Set();
    const normalizedIds = [];
    const invalid = [];
    for (const raw of ids) {
      const id = Number(raw);
      if (!Number.isInteger(id) || id <= 0) {
        invalid.push(raw);
        continue;
      }
      if (!seen.has(id)) {
        seen.add(id);
        normalizedIds.push(id);
      }
    }

    const results = normalizedIds.map((id) => {
      try {
        const board = getBoardSummary(db, id, req.user.id);
        if (!board) {
          return { id, ok: false, status: 404, error: 'Board not found' };
        }
        return {
          id,
          ok: true,
          status: 200,
          board,
          column_count: board.column_count,
          card_count: board.card_count,
          default_column_id: board.default_column_id,
          default_column_name: board.default_column_name
        };
      } catch (err) {
        // A failure for one board must not fail the whole batch.
        return { id, ok: false, status: 500, error: 'Failed to fetch board' };
      }
    });

    // Re-surface invalid entries alongside board ids, still without failing
    // the otherwise successful items.
    for (const raw of invalid) {
      results.push({ id: raw, ok: false, status: 400, error: 'Invalid board id' });
    }

    const succeeded = results.filter(r => r.ok);
    const summary = {
      requested: ids.length,
      succeeded: succeeded.length,
      failed: results.length - succeeded.length,
      board_count: succeeded.length,
      column_count: succeeded.reduce((sum, r) => sum + r.column_count, 0),
      card_count: succeeded.reduce((sum, r) => sum + r.card_count, 0)
    };

    db.close();
    res.json({ results, summary });
  } catch (err) {
    db.close();
    res.status(500).json({ error: 'Failed to fetch board summaries' });
  }
});

// GET /api/boards/:id - Single board detail: board summary, columns and cards
// in one response. Counts in `board` are computed from the same columns/cards
// included here, so the summary and the nested detail always agree.
router.get('/:id', (req, res) => {
  const db = getDb();
  try {
    const detail = getBoardDetail(db, req.params.id, req.user.id);
    db.close();
    if (!detail) {
      return res.status(404).json({ error: 'Board not found' });
    }
    res.json(detail);
  } catch (err) {
    db.close();
    res.status(500).json({ error: 'Failed to fetch board' });
  }
});

// POST /api/boards - Create board with its default columns in one transaction.
// Responds with the same shape as the board list items (counts + default
// column) so the frontend can append the response directly without refetch.
router.post('/', (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Board name is required' });
  }

  const db = getDb();
  try {
    const boardId = db.transaction(() => {
      const result = db.prepare(
        'INSERT INTO boards (user_id, name, description) VALUES (?, ?, ?)'
      ).run(req.user.id, name.trim(), description || '');

      const insertCol = db.prepare(
        'INSERT INTO columns (board_id, name, position) VALUES (?, ?, ?)'
      );
      for (const col of DEFAULT_COLUMNS) {
        insertCol.run(result.lastInsertRowid, col.name, col.position);
      }
      return result.lastInsertRowid;
    })();

    // Read back through the shared summary query so the create response carries
    // the exact same column_count/card_count/default_column_* fields as the
    // list endpoint.
    const board = getBoardSummary(db, boardId, req.user.id);
    db.close();
    res.status(201).json(board);
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
