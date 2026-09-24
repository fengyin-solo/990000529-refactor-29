// Single source of truth for the columns created together with a new board.
// Board creation and batch summaries both read from here so the default
// columns can never drift between endpoints.
const DEFAULT_COLUMNS = ['To Do', 'In Progress', 'Done'];

module.exports = { DEFAULT_COLUMNS };
