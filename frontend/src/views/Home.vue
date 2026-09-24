<template>
  <div class="home-page">
    <div class="home-container">
      <div class="home-header">
        <h1>My Boards</h1>
        <div class="header-actions">
          <el-button
            v-if="boardStore.boards.length > 0"
            :type="selectMode ? 'warning' : 'default'"
            @click="toggleSelectMode"
          >
            {{ selectMode ? 'Cancel Selection' : 'Select Boards' }}
          </el-button>
          <el-button type="primary" :icon="Plus" @click="showCreateDialog = true">
            New Board
          </el-button>
        </div>
      </div>

      <!-- Batch actions while in select mode -->
      <div v-if="selectMode" class="batch-bar">
        <el-checkbox
          :model-value="allSelected"
          :indeterminate="someSelected && !allSelected"
          @change="toggleSelectAll"
        >
          Select all
        </el-checkbox>
        <span class="batch-count">{{ selectedIds.length }} selected</span>
        <el-button
          type="primary"
          size="small"
          :loading="verifying"
          :disabled="selectedIds.length === 0"
          @click="verifySelected"
        >
          Verify Summary
        </el-button>
      </div>

      <div v-if="boardStore.loading" class="loading-state">
        <el-icon class="is-loading" :size="32"><Loading /></el-icon>
        <p>Loading boards...</p>
      </div>

      <div v-else-if="boardStore.boards.length === 0" class="empty-state">
        <el-empty description="No boards yet. Create your first board!">
          <el-button type="primary" @click="showCreateDialog = true">Create Board</el-button>
        </el-empty>
      </div>

      <div v-else class="boards-grid">
        <BoardCard
          v-for="board in boardStore.boards"
          :key="board.id"
          :board="board"
          :selectable="selectMode"
          :selected="selectedIds.includes(board.id)"
          @update:selected="(checked) => toggleBoardSelection(board.id, checked)"
          @open="openBoard"
          @delete="confirmDeleteBoard"
        />
      </div>
    </div>

    <!-- Create Board Dialog -->
    <el-dialog v-model="showCreateDialog" title="Create New Board" width="460px" :close-on-click-modal="false">
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-position="top">
        <el-form-item label="Board Name" prop="name">
          <el-input v-model="createForm.name" placeholder="Enter board name" maxlength="50" show-word-limit />
        </el-form-item>
        <el-form-item label="Description (optional)" prop="description">
          <el-input v-model="createForm.description" type="textarea" :rows="3" placeholder="Enter board description" maxlength="200" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">Cancel</el-button>
        <el-button type="primary" :loading="creating" @click="handleCreateBoard">Create</el-button>
      </template>
    </el-dialog>

    <!-- Batch Verification Result Dialog -->
    <el-dialog v-model="showVerifyResult" title="Board Summary Verification" width="560px">
      <div v-if="verifyResult">
        <el-alert
          v-if="verifyResult.summary.failed > 0"
          type="warning"
          :closable="false"
          show-icon
          :title="`${verifyResult.summary.succeeded} succeeded, ${verifyResult.summary.failed} failed`"
          class="verify-alert"
        />
        <el-alert
          v-else
          type="success"
          :closable="false"
          show-icon
          :title="`All ${verifyResult.summary.succeeded} board(s) verified`"
          class="verify-alert"
        />
        <el-table :data="verifyResult.results" size="small" max-height="300">
          <el-table-column label="Board" min-width="150">
            <template #default="{ row }">
              {{ row.ok ? row.board.name : `#${row.id}` }}
            </template>
          </el-table-column>
          <el-table-column label="Columns" width="90" align="center">
            <template #default="{ row }">{{ row.ok ? row.column_count : '—' }}</template>
          </el-table-column>
          <el-table-column label="Cards" width="80" align="center">
            <template #default="{ row }">{{ row.ok ? row.card_count : '—' }}</template>
          </el-table-column>
          <el-table-column label="Default column" min-width="120">
            <template #default="{ row }">{{ row.ok ? (row.default_column_name || '—') : '—' }}</template>
          </el-table-column>
          <el-table-column label="Status" width="90" align="center">
            <template #default="{ row }">
              <el-tag v-if="row.ok" size="small" type="success">OK</el-tag>
              <el-tooltip v-else :content="row.error" placement="top">
                <el-tag size="small" type="danger">Failed</el-tag>
              </el-tooltip>
            </template>
          </el-table-column>
        </el-table>
        <div class="verify-total">
          Total across {{ verifyResult.summary.succeeded }} board(s):
          <strong>{{ verifyResult.summary.column_count }}</strong> columns,
          <strong>{{ verifyResult.summary.card_count }}</strong> cards
        </div>
      </div>
      <template #footer>
        <el-button type="primary" @click="showVerifyResult = false">Close</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Loading } from '@element-plus/icons-vue'
import { useBoardStore } from '../stores/board.js'
import BoardCard from '../components/BoardCard.vue'

const router = useRouter()
const boardStore = useBoardStore()

const showCreateDialog = ref(false)
const creating = ref(false)
const createFormRef = ref(null)

const createForm = ref({ name: '', description: '' })
const createRules = {
  name: [{ required: true, message: 'Board name is required', trigger: 'blur' }]
}

// Multi-select batch verification
const selectMode = ref(false)
const selectedIds = ref([])
const verifying = ref(false)
const showVerifyResult = ref(false)
const verifyResult = ref(null)

const allSelected = computed(() =>
  boardStore.boards.length > 0 && selectedIds.value.length === boardStore.boards.length
)
const someSelected = computed(() => selectedIds.value.length > 0)

onMounted(() => {
  boardStore.fetchBoards()
})

function toggleSelectMode() {
  selectMode.value = !selectMode.value
  selectedIds.value = []
}

function toggleBoardSelection(id, checked) {
  if (checked) {
    if (!selectedIds.value.includes(id)) selectedIds.value.push(id)
  } else {
    selectedIds.value = selectedIds.value.filter(bid => bid !== id)
  }
}

function toggleSelectAll(checked) {
  selectedIds.value = checked ? boardStore.boards.map(b => b.id) : []
}

// One request summarizes every selected board; per-item failures stay visible
// while successful summaries are merged back into the board list.
async function verifySelected() {
  if (selectedIds.value.length === 0) return
  verifying.value = true
  try {
    const result = await boardStore.fetchBoardSummaries([...selectedIds.value])
    verifyResult.value = result
    showVerifyResult.value = true
    if (result.summary.failed > 0) {
      ElMessage.warning(`${result.summary.succeeded} verified, ${result.summary.failed} failed`)
    } else {
      ElMessage.success('Summary verified')
    }
  } catch (err) {
    ElMessage.error(err.response?.data?.error || 'Failed to verify boards')
  } finally {
    verifying.value = false
  }
}

function openBoard(board) {
  router.push(`/board/${board.id}`)
}

async function handleCreateBoard() {
  if (!createFormRef.value) return
  const valid = await createFormRef.value.validate().catch(() => false)
  if (!valid) return

  creating.value = true
  try {
    const board = await boardStore.createBoard(createForm.value.name, createForm.value.description)
    showCreateDialog.value = false
    createForm.value = { name: '', description: '' }
    ElMessage.success('Board created!')
    router.push(`/board/${board.id}`)
  } catch (err) {
    ElMessage.error(err.response?.data?.error || 'Failed to create board')
  } finally {
    creating.value = false
  }
}

async function confirmDeleteBoard(board) {
  try {
    await ElMessageBox.confirm(
      `Are you sure you want to delete "${board.name}"? All columns and cards will be permanently removed.`,
      'Delete Board',
      { type: 'warning', confirmButtonText: 'Delete', cancelButtonText: 'Cancel' }
    )
    await boardStore.deleteBoard(board.id)
    selectedIds.value = selectedIds.value.filter(id => id !== board.id)
    ElMessage.success('Board deleted')
  } catch (err) {
    if (err !== 'cancel') {
      ElMessage.error('Failed to delete board')
    }
  }
}
</script>

<style scoped>
.home-page {
  padding: 30px;
}

.home-container {
  max-width: 1200px;
  margin: 0 auto;
}

.home-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 30px;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.batch-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: -10px 0 20px;
  padding: 10px 14px;
  background: #f4f5f7;
  border-radius: 8px;
}

.batch-count {
  color: #909399;
  font-size: 13px;
}

.verify-alert {
  margin-bottom: 12px;
}

.verify-total {
  margin-top: 12px;
  color: #606266;
  font-size: 13px;
  text-align: right;
}

.home-header h1 {
  font-size: 28px;
  color: #303133;
}

.boards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
}

.loading-state {
  text-align: center;
  padding: 60px;
  color: #909399;
}

.loading-state p {
  margin-top: 12px;
}

.empty-state {
  padding: 60px 0;
}
</style>
