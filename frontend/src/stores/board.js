import { defineStore } from 'pinia'
import { ref } from 'vue'
import { boardApi, columnApi, cardApi } from '../api/index.js'

export const useBoardStore = defineStore('board', () => {
  const boards = ref([])
  const currentBoard = ref(null)
  const columns = ref([])
  const cards = ref({}) // keyed by columnId -> [cards]
  const loading = ref(false)

  // Merge a board summary (as returned by list/detail/batch endpoints) into
  // the boards list so every view reads the same counts.
  function upsertBoard(board) {
    const idx = boards.value.findIndex(b => b.id === board.id)
    if (idx === -1) {
      boards.value.unshift(board)
    } else {
      boards.value[idx] = board
    }
  }

  // Board actions
  async function fetchBoards() {
    loading.value = true
    try {
      const res = await boardApi.list()
      boards.value = res.data
      return res.data
    } finally {
      loading.value = false
    }
  }

  // Single consolidated read for the board page: board meta (with counts),
  // columns and cards all come from one request, so the counts can never
  // disagree with the columns/cards rendered on screen and there is no
  // partial success / partial failure to reconcile.
  async function fetchBoardDetail(boardId) {
    loading.value = true
    try {
      const res = await boardApi.detail(boardId)
      const { board, columns: cols, cards: allCards } = res.data

      currentBoard.value = board
      upsertBoard(board)
      columns.value = cols

      const cardsByColumn = {}
      for (const col of cols) {
        cardsByColumn[col.id] = []
      }
      for (const card of allCards) {
        if (!cardsByColumn[card.column_id]) cardsByColumn[card.column_id] = []
        cardsByColumn[card.column_id].push(card)
      }
      cards.value = cardsByColumn
      return res.data
    } finally {
      loading.value = false
    }
  }

  // Verify/summarize several boards in one request. Successful summaries are
  // merged back into the boards list; per-item results and the aggregate are
  // returned so callers can report partial failures precisely.
  async function fetchBoardSummaries(ids) {
    const res = await boardApi.batchSummary(ids)
    const { results, summary } = res.data
    for (const item of results) {
      if (item.ok) upsertBoard(item.board)
    }
    return { results, summary }
  }

  async function createBoard(name, description) {
    const res = await boardApi.create(name, description)
    // The create response has the same shape as a list item (with counts and
    // default column), so it can be appended directly.
    upsertBoard(res.data)
    return res.data
  }

  async function deleteBoard(id) {
    await boardApi.delete(id)
    boards.value = boards.value.filter(b => b.id !== id)
  }

  // Column actions
  async function fetchColumns(boardId) {
    loading.value = true
    try {
      const res = await columnApi.list(boardId)
      columns.value = res.data
      // Initialize cards map
      cards.value = {}
      for (const col of res.data) {
        cards.value[col.id] = []
      }
    } finally {
      loading.value = false
    }
  }

  async function addColumn(boardId, name) {
    const res = await columnApi.create(boardId, name)
    columns.value.push(res.data)
    cards.value[res.data.id] = []
    const board = boards.value.find(b => b.id === boardId)
    if (board) board.column_count = (board.column_count || 0) + 1
    if (currentBoard.value?.id === boardId) {
      currentBoard.value.column_count = (currentBoard.value.column_count || 0) + 1
    }
    return res.data
  }

  async function renameColumn(colId, name) {
    const res = await columnApi.update(colId, { name })
    const idx = columns.value.findIndex(c => c.id === colId)
    if (idx !== -1) columns.value[idx] = res.data
    return res.data
  }

  async function deleteColumn(colId) {
    const removed = columns.value.find(c => c.id === colId)
    await columnApi.delete(colId)
    columns.value = columns.value.filter(c => c.id !== colId)
    const removedCards = cards.value[colId]?.length || 0
    delete cards.value[colId]

    if (removed && currentBoard.value?.id === removed.board_id) {
      const board = currentBoard.value
      board.column_count = Math.max(0, (board.column_count || 0) - 1)
      board.card_count = Math.max(0, (board.card_count || 0) - removedCards)
      if (board.default_column_id === colId) {
        const next = columns.value[0] || null
        board.default_column_id = next ? next.id : null
        board.default_column_name = next ? next.name : null
      }
    }
  }

  async function reorderColumn(colId, newPosition) {
    const res = await columnApi.update(colId, { position: newPosition })
    // Refresh columns to get correct order
    if (currentBoard.value) {
      await fetchColumns(currentBoard.value.id)
    }
    return res.data
  }

  // Card actions
  async function fetchCards(columnId) {
    const res = await cardApi.list(columnId)
    cards.value[columnId] = res.data
    return res.data
  }

  // Kept for compatibility; the board page now loads cards together with the
  // board detail in one request, but merging individual column reads still
  // tolerates per-column failures instead of discarding everything.
  async function fetchAllCards(boardId) {
    const cols = columns.value
    const results = await Promise.allSettled(cols.map(col => cardApi.list(col.id)))
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        cards.value[cols[i].id] = result.value.data
      }
    })
    const failed = results.filter(r => r.status === 'rejected').length
    if (failed > 0) {
      throw new Error(`Failed to load cards for ${failed} of ${cols.length} columns`)
    }
  }

  async function addCard(columnId, data) {
    const res = await cardApi.create(columnId, data)
    if (!cards.value[columnId]) cards.value[columnId] = []
    cards.value[columnId].push(res.data)
    if (currentBoard.value) {
      currentBoard.value.card_count = (currentBoard.value.card_count || 0) + 1
    }
    const col = columns.value.find(c => c.id === columnId)
    const board = col ? boards.value.find(b => b.id === col.board_id) : null
    if (board) board.card_count = (board.card_count || 0) + 1
    return res.data
  }

  async function updateCard(cardId, data) {
    const res = await cardApi.update(cardId, data)
    // Update card in the local state
    for (const colId in cards.value) {
      const idx = cards.value[colId].findIndex(c => c.id === cardId)
      if (idx !== -1) {
        cards.value[colId][idx] = res.data
        break
      }
    }
    return res.data
  }

  async function deleteCard(cardId) {
    let columnId = null
    for (const colId in cards.value) {
      if (cards.value[colId].some(c => c.id === cardId)) {
        columnId = colId
        break
      }
    }
    await cardApi.delete(cardId)
    if (columnId) {
      cards.value[columnId] = cards.value[columnId].filter(c => c.id !== cardId)
    }
    if (currentBoard.value) {
      currentBoard.value.card_count = Math.max(0, (currentBoard.value.card_count || 0) - 1)
    }
    if (columnId) {
      const col = columns.value.find(c => c.id === Number(columnId))
      const board = col ? boards.value.find(b => b.id === col.board_id) : null
      if (board) board.card_count = Math.max(0, (board.card_count || 0) - 1)
    }
  }

  async function moveCard(cardId, targetColumnId, position) {
    const res = await cardApi.move(cardId, targetColumnId, position)
    // Remove card from old column and add to new column
    let movedCard = null
    for (const colId in cards.value) {
      const idx = cards.value[colId].findIndex(c => c.id === cardId)
      if (idx !== -1) {
        movedCard = cards.value[colId].splice(idx, 1)[0]
        break
      }
    }
    if (movedCard) {
      movedCard.column_id = targetColumnId
      movedCard.position = position
      if (!cards.value[targetColumnId]) cards.value[targetColumnId] = []
      // Insert at position
      cards.value[targetColumnId].splice(position, 0, movedCard)
    }
    // Moving does not change the board's total card count.
    return res.data
  }

  function clearBoard() {
    currentBoard.value = null
    columns.value = []
    cards.value = {}
  }

  return {
    boards, currentBoard, columns, cards, loading,
    fetchBoards, fetchBoardDetail, fetchBoardSummaries,
    createBoard, deleteBoard,
    fetchColumns, addColumn, renameColumn, deleteColumn, reorderColumn,
    fetchCards, fetchAllCards, addCard, updateCard, deleteCard, moveCard,
    clearBoard
  }
})
