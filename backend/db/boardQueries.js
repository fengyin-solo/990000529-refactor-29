// Default columns created together with every new board. This is the single
// source of truth for both the API responses and the seeded data.
const DEFAULT_COLUMNS = [
  { name: 'To Do', position: 0 },
  { name: 'In Progress', position: 1 },
  { name: 'Done', position: 2 }
];

// Shared SELECT fragment that decorates a board row with its column/card
// counts and its default column. Both the list/detail endpoints and the batch
// endpoint use it so that a per-board summary can never disagree with the
// single-board detail.
const BOARD_SUMMARY_SELECT = `
  SELECT
    b.*,
    (SELECT COUNT(*) FROM columns WHERE board_id = b.id) AS column_count,
    (
      SELECT COUNT(*)
      FROM cards c
      JOIN columns col ON c.column_id = col.id
      WHERE col.board_id = b.id
    ) AS card_count,
    (
      SELECT col.id FROM columns col
      WHERE col.board_id = b.id
      ORDER BY col.position ASC, col.id ASC
      LIMIT 1
    ) AS default_column_id,
    (
      SELECT col.name FROM columns col
      WHERE col.board_id = b.id
      ORDER BY col.position ASC, col.id ASC
      LIMIT 1
    ) AS default_column_name
  FROM boards b
`;

// Columns of one board together with their card counts, ordered for display.
const BOARD_COLUMNS_SELECT = `
  SELECT
    col.*,
    (SELECT COUNT(*) FROM cards WHERE column_id = col.id) AS card_count
  FROM columns col
  WHERE col.board_id = ?
  ORDER BY col.position ASC, col.id ASC
`;

// All cards of one board (joined so a single query suffices).
const BOARD_CARDS_SELECT = `
  SELECT c.*
  FROM cards c
  JOIN columns col ON c.column_id = col.id
  WHERE col.board_id = ?
  ORDER BY c.column_id ASC, c.position ASC, c.id ASC
`;

function listBoardSummaries(db, userId) {
  return db.prepare(`
    ${BOARD_SUMMARY_SELECT}
    WHERE b.user_id = ?
    ORDER BY b.created_at DESC, b.id DESC
  `).all(userId);
}

function getBoardSummary(db, boardId, userId) {
  return db.prepare(`
    ${BOARD_SUMMARY_SELECT}
    WHERE b.id = ? AND b.user_id = ?
  `).get(boardId, userId);
}

function getBoardColumns(db, boardId) {
  return db.prepare(BOARD_COLUMNS_SELECT).all(boardId);
}

function getBoardCards(db, boardId) {
  return db.prepare(BOARD_CARDS_SELECT).all(boardId);
}

// Full single-board snapshot: board meta (with counts + default column),
// columns (with per-column card counts) and cards. Everything is read in one
// place, so the summary counts always match the nested columns/cards.
function getBoardDetail(db, boardId, userId) {
  const board = getBoardSummary(db, boardId, userId);
  if (!board) return null;

  const columns = getBoardColumns(db, boardId);
  const cards = getBoardCards(db, boardId);

  return { board, columns, cards };
}

module.exports = {
  DEFAULT_COLUMNS,
  listBoardSummaries,
  getBoardSummary,
  getBoardColumns,
  getBoardCards,
  getBoardDetail
};
