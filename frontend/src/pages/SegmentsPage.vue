<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Segment, SegmentSeal, SegmentType, SealStatus, Station } from '@/types'
import { SEGMENT_TYPES, segmentLength } from '@/types'
import SegmentTag from '@/components/common/SegmentTag.vue'
import { useStore } from '@/hooks/usePersistentStore'
import { caveStore } from '@/stores/caveStore'
import { segmentStore } from '@/stores/segmentStore'
import { stationStore } from '@/stores/stationStore'
import { sealStore } from '@/stores/sealStore'
import {
  abnormalReasons,
  computeClosure,
  fingerprintStations,
  isAbnormalStation,
  stakeRangeOverlap,
  stakeToNumber
} from '@/utils/survey'
import { uid } from '@/utils/id'

const caveState = useStore(caveStore)
const segmentState = useStore(segmentStore)
const stationState = useStore(stationStore)
const sealState = useStore(sealStore)

const filterCaveId = ref<string>('')
const filterType = ref<SegmentType | ''>('')
const rangeStart = ref<number | undefined>(undefined)
const rangeEnd = ref<number | undefined>(undefined)
const selectedIds = ref<string[]>([])
const batchType = ref<SegmentType>('廊道')

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)

const form = reactive({
  caveId: '',
  code: '',
  startStake: 'K0+000',
  endStake: 'K0+050',
  type: '廊道' as SegmentType,
  avgWidth: 1.5,
  avgHeight: 2,
  slopeTrend: '',
  closed: false,
  sketchNo: ''
})

const filtered = computed(() =>
  segmentState.segments.filter((segment) => {
    if (filterCaveId.value && segment.caveId !== filterCaveId.value) return false
    if (filterType.value && segment.type !== filterType.value) return false
    if (rangeStart.value !== undefined || rangeEnd.value !== undefined) {
      const lo = rangeStart.value ?? Number.NEGATIVE_INFINITY
      const hi = rangeEnd.value ?? Number.POSITIVE_INFINITY
      if (!stakeRangeOverlap(stakeToNumber(segment.startStake), stakeToNumber(segment.endStake), lo, hi)) return false
    }
    return true
  })
)

const totalLength = computed(() =>
  Math.round(filtered.value.reduce((sum, segment) => sum + segmentLength(segment), 0) * 10) / 10
)

function caveName(caveId: string): string {
  return caveState.caves.find((cave) => cave.id === caveId)?.name ?? '未归属洞穴'
}

function stationCount(segmentId: string): number {
  return stationState.stations.filter((station) => station.segmentId === segmentId).length
}

function stationsOf(segmentId: string): Station[] {
  return stationState.stations.filter((station) => station.segmentId === segmentId)
}

/** 该洞段的封存记录（sealStore 已按时间倒序） */
function sealsOf(segmentId: string): SegmentSeal[] {
  return sealState.seals.filter((seal) => seal.segmentId === segmentId)
}

function latestSeal(segmentId: string): SegmentSeal | undefined {
  return sealsOf(segmentId)[0]
}

/** 封存是否失效：封存后测点有增删改，指纹即失配 */
function sealStale(seal: SegmentSeal): boolean {
  return seal.fingerprint !== fingerprintStations(stationsOf(seal.segmentId))
}

function sealStatus(segmentId: string): SealStatus | 'none' {
  const seal = latestSeal(segmentId)
  if (!seal) return 'none'
  return sealStale(seal) ? 'stale' : 'active'
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN', { hour12: false })
}

const sealDialogVisible = ref(false)
const sealingSegment = ref<Segment | null>(null)
const sealReviewer = ref('')
const sealNote = ref('')

/** 封存对话框内的实时快照：当前测点、闭合差与异常读数 */
const sealStations = computed<Station[]>(() => (sealingSegment.value ? stationsOf(sealingSegment.value.id) : []))
const sealClosure = computed(() => computeClosure(sealStations.value))
const sealAbnormal = computed(() =>
  sealStations.value
    .filter((station) => isAbnormalStation(station))
    .map((station) => ({ code: station.code, reasons: abnormalReasons(station) }))
)
const sealingHistory = computed<SegmentSeal[]>(() =>
  sealingSegment.value ? sealsOf(sealingSegment.value.id) : []
)

function openSeal(segment: Segment): void {
  sealingSegment.value = segment
  sealReviewer.value = ''
  sealNote.value = ''
  sealDialogVisible.value = true
}

async function confirmSeal(): Promise<void> {
  const segment = sealingSegment.value
  if (!segment) return
  if (!sealReviewer.value.trim()) {
    ElMessage.warning('请填写复核人')
    return
  }
  const result = sealClosure.value
  if (result.over && !sealNote.value.trim()) {
    ElMessage.warning('闭合差超过阈值，请先填写处理说明再封存')
    return
  }
  const seal: SegmentSeal = {
    id: uid('seal'),
    segmentId: segment.id,
    reviewer: sealReviewer.value.trim(),
    sealedAt: new Date().toISOString(),
    stationCount: sealStations.value.length,
    closure: result.closure,
    threshold: result.threshold,
    closureOver: result.over,
    abnormalStakes: sealAbnormal.value.map((item) => item.code),
    handlingNote: sealNote.value.trim(),
    fingerprint: fingerprintStations(sealStations.value)
  }
  await sealStore.getState().seal(seal)
  sealDialogVisible.value = false
  ElMessage.success(`洞段「${segment.code}」已复核封存，共 ${seal.stationCount} 站`)
}

function resetForm(): void {
  editingId.value = null
  form.caveId = caveState.caves[0]?.id ?? ''
  form.code = `C-${String(segmentState.segments.length + 1).padStart(2, '0')}`
  form.startStake = 'K0+000'
  form.endStake = 'K0+050'
  form.type = '廊道'
  form.avgWidth = 1.5
  form.avgHeight = 2
  form.slopeTrend = ''
  form.closed = false
  form.sketchNo = ''
}

function openCreate(): void {
  resetForm()
  dialogVisible.value = true
}

function openEdit(segment: Segment): void {
  editingId.value = segment.id
  form.caveId = segment.caveId
  form.code = segment.code
  form.startStake = segment.startStake
  form.endStake = segment.endStake
  form.type = segment.type
  form.avgWidth = segment.avgWidth
  form.avgHeight = segment.avgHeight
  form.slopeTrend = segment.slopeTrend
  form.closed = segment.closed
  form.sketchNo = segment.sketchNo
  dialogVisible.value = true
}

async function submit(): Promise<void> {
  if (!form.caveId) {
    ElMessage.warning('请选择归属洞穴')
    return
  }
  if (!form.code.trim()) {
    ElMessage.warning('请填写洞段编号')
    return
  }
  if (stakeToNumber(form.endStake) <= stakeToNumber(form.startStake)) {
    ElMessage.warning('结束桩号必须大于起始桩号')
    return
  }
  const existing = segmentState.segments.find((item) => item.id === editingId.value)
  const segment: Segment = {
    id: existing?.id ?? uid('seg'),
    caveId: form.caveId,
    code: form.code.trim(),
    startStake: form.startStake.trim(),
    endStake: form.endStake.trim(),
    type: form.type,
    avgWidth: Number(form.avgWidth) || 0,
    avgHeight: Number(form.avgHeight) || 0,
    slopeTrend: form.slopeTrend.trim(),
    closed: form.closed,
    sketchNo: form.sketchNo.trim()
  }
  await segmentStore.getState().save(segment)
  dialogVisible.value = false
  ElMessage.success(existing ? '洞段已更新' : '洞段已建立')
}

async function applyBatchType(): Promise<void> {
  if (selectedIds.value.length === 0) {
    ElMessage.warning('请先勾选要调整的洞段')
    return
  }
  await segmentStore.getState().bulkSetType(selectedIds.value, batchType.value)
  ElMessage.success(`已把 ${selectedIds.value.length} 个洞段调整为「${batchType.value}」`)
}

async function applyBatchClosed(closed: boolean): Promise<void> {
  if (selectedIds.value.length === 0) {
    ElMessage.warning('请先勾选要调整的洞段')
    return
  }
  await segmentStore.getState().bulkSetClosed(selectedIds.value, closed)
  ElMessage.success(closed ? '已标记为闭合' : '已取消闭合标记')
}

async function removeSegment(segment: Segment): Promise<void> {
  const count = stationCount(segment.id)
  if (count > 0) {
    ElMessage.error(`洞段「${segment.code}」下仍有 ${count} 个测点，请先清理`)
    return
  }
  await ElMessageBox.confirm(`确认删除洞段「${segment.code}」？其封存记录将一并清除。`, '删除确认', { type: 'warning' })
  await segmentStore.getState().remove(segment.id)
  await sealStore.getState().removeBySegment(segment.id)
  ElMessage.success('洞段已删除')
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">洞段编目表</h2>
        <p class="page-sub">
          按桩号区间筛选洞段、批量调整洞段类型；洞段长度由起止桩号自动计算，并累计为洞穴实测总长。
        </p>
      </div>
      <el-button type="primary" @click="openCreate">
        <el-icon><Plus /></el-icon>新建洞段
      </el-button>
    </div>

    <div class="toolbar">
      <el-select v-model="filterCaveId" placeholder="全部洞穴" clearable style="width: 200px">
        <el-option v-for="cave in caveState.caves" :key="cave.id" :label="cave.name" :value="cave.id" />
      </el-select>
      <el-select v-model="filterType" placeholder="全部类型" clearable style="width: 140px">
        <el-option v-for="type in SEGMENT_TYPES" :key="type" :label="type" :value="type" />
      </el-select>
      <div class="range">
        <span class="muted">桩号区间筛选（米）</span>
        <el-input-number v-model="rangeStart" :min="0" :controls="false" placeholder="起" style="width: 110px" />
        <span>—</span>
        <el-input-number v-model="rangeEnd" :min="0" :controls="false" placeholder="止" style="width: 110px" />
      </div>
      <el-select v-model="batchType" style="width: 140px">
        <el-option v-for="type in SEGMENT_TYPES" :key="type" :label="type" :value="type" />
      </el-select>
      <el-button type="primary" plain @click="applyBatchType">批量调整类型</el-button>
      <el-button @click="applyBatchClosed(true)">标记闭合</el-button>
      <el-button @click="applyBatchClosed(false)">取消闭合</el-button>
      <el-tag type="info" effect="plain">命中共 {{ filtered.length }} 段 · 合计 {{ totalLength }} m</el-tag>
    </div>

    <el-table
      :data="filtered"
      border
      stripe
      row-key="id"
      @selection-change="(rows: Segment[]) => (selectedIds = rows.map((row) => row.id))"
    >
      <el-table-column type="selection" width="46" />
      <el-table-column label="洞段" width="120">
        <template #default="{ row }: { row: Segment }">
          <span class="mono">{{ row.code }}</span>
        </template>
      </el-table-column>
      <el-table-column label="归属洞穴" min-width="150">
        <template #default="{ row }: { row: Segment }">{{ caveName(row.caveId) }}</template>
      </el-table-column>
      <el-table-column label="类型" width="170">
        <template #default="{ row }: { row: Segment }">
          <SegmentTag :type="row.type" :closed="row.closed" size="small" />
        </template>
      </el-table-column>
      <el-table-column label="桩号区间" min-width="200">
        <template #default="{ row }: { row: Segment }">
          <span class="mono">{{ row.startStake }} → {{ row.endStake }}</span>
          <div class="muted">长度 {{ segmentLength(row) }} m</div>
        </template>
      </el-table-column>
      <el-table-column label="平均宽×高(m)" width="140">
        <template #default="{ row }: { row: Segment }">{{ row.avgWidth }} × {{ row.avgHeight }}</template>
      </el-table-column>
      <el-table-column prop="slopeTrend" label="坡度趋势" width="120" />
      <el-table-column label="测点数" width="90">
        <template #default="{ row }: { row: Segment }">{{ stationCount(row.id) }}</template>
      </el-table-column>
      <el-table-column prop="sketchNo" label="草图序号" width="100" />
      <el-table-column label="复核封存" min-width="210">
        <template #default="{ row }: { row: Segment }">
          <template v-if="latestSeal(row.id)">
            <el-tag :type="sealStatus(row.id) === 'active' ? 'success' : 'warning'" effect="dark" size="small">
              {{ sealStatus(row.id) === 'active' ? '已封存' : '已变更待复核' }}
            </el-tag>
            <div class="muted seal-line">
              {{ latestSeal(row.id)!.reviewer }} · {{ formatTime(latestSeal(row.id)!.sealedAt) }}
            </div>
            <div class="muted seal-line">
              封存时 {{ latestSeal(row.id)!.stationCount }} 站 · 闭合差 {{ latestSeal(row.id)!.closure.toFixed(3) }} m
              <template v-if="latestSeal(row.id)!.abnormalStakes.length > 0">
                · 异常 {{ latestSeal(row.id)!.abnormalStakes.join('、') }}
              </template>
            </div>
          </template>
          <el-tag v-else type="info" effect="plain" size="small">未封存</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }: { row: Segment }">
          <el-button link type="primary" size="small" @click="openSeal(row)">
            {{ sealStatus(row.id) === 'none' ? '复核封存' : '重新复核' }}
          </el-button>
          <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" size="small" @click="removeSegment(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑洞段' : '新建洞段'" width="620px">
      <el-form label-width="110px">
        <el-form-item label="归属洞穴" required>
          <el-select v-model="form.caveId" style="width: 100%">
            <el-option v-for="cave in caveState.caves" :key="cave.id" :label="cave.name" :value="cave.id" />
          </el-select>
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="洞段编号" required>
              <el-input v-model="form.code" placeholder="如 C-03" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="洞段类型">
              <el-select v-model="form.type" style="width: 100%">
                <el-option v-for="type in SEGMENT_TYPES" :key="type" :label="type" :value="type" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="起始桩号">
              <el-input v-model="form.startStake" placeholder="K0+000" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="结束桩号">
              <el-input v-model="form.endStake" placeholder="K0+050" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="平均宽(m)">
              <el-input-number v-model="form.avgWidth" :min="0" :step="0.1" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="平均高(m)">
              <el-input-number v-model="form.avgHeight" :min="0" :step="0.1" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="坡度趋势">
          <el-input v-model="form.slopeTrend" placeholder="如 缓升 3°" />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="草图序号">
              <el-input v-model="form.sketchNo" placeholder="如 S-03" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="是否已闭合">
              <el-switch v-model="form.closed" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="sealDialogVisible"
      :title="`复核封存 · ${sealingSegment?.code ?? ''}`"
      width="640px"
    >
      <template v-if="sealingSegment">
        <p class="muted seal-head">
          {{ sealingSegment.startStake }} → {{ sealingSegment.endStake }} · 封存一刻的复核人、测点数与闭合差将留档，
          之后测点增删改会使本次封存转为「已变更待复核」。
        </p>
        <div class="seal-summary">
          <el-tag effect="plain">当前测点 {{ sealStations.length }} 站</el-tag>
          <el-tag :type="sealClosure.over ? 'danger' : 'success'" effect="dark">
            闭合差 {{ sealClosure.closure.toFixed(3) }} m
          </el-tag>
          <el-tag :type="sealClosure.over ? 'danger' : 'info'" effect="plain">阈值 {{ sealClosure.threshold }} m</el-tag>
          <el-tag v-if="sealAbnormal.length > 0" type="danger" effect="plain">
            异常读数 {{ sealAbnormal.length }} 站
          </el-tag>
          <el-tag v-else type="success" effect="plain">读数无异常</el-tag>
        </div>
        <el-alert
          v-if="sealAbnormal.length > 0"
          class="seal-block"
          type="warning"
          :closable="false"
          title="以下桩号读数异常，将随封存一并留档"
        >
          <ul class="seal-abnormal">
            <li v-for="item in sealAbnormal" :key="item.code">
              <span class="mono">{{ item.code }}</span>：{{ item.reasons.join('；') }}
            </li>
          </ul>
        </el-alert>
        <el-alert
          v-if="sealClosure.over"
          class="seal-block"
          type="error"
          :closable="false"
          title="闭合差超过阈值"
          description="须填写处理说明（复测结论或误差分配方式）才能封存。"
        />
        <el-form label-width="90px" class="seal-block">
          <el-form-item label="复核人" required>
            <el-input v-model="sealReviewer" placeholder="复核人姓名" style="width: 240px" />
          </el-form-item>
          <el-form-item :label="sealClosure.over ? '处理说明' : '处理说明'" :required="sealClosure.over">
            <el-input
              v-model="sealNote"
              type="textarea"
              :rows="2"
              :placeholder="sealClosure.over ? '闭合差超限，必填：复测结论 / 误差分配方式' : '选填：复核结论或现场说明'"
            />
          </el-form-item>
        </el-form>
        <template v-if="sealingHistory.length > 0">
          <h4 class="seal-history-title">历史封存（{{ sealingHistory.length }} 次，留档不可改）</h4>
          <el-table :data="sealingHistory" border size="small" max-height="220">
            <el-table-column label="状态" width="120">
              <template #default="{ row }: { row: SegmentSeal }">
                <el-tag :type="sealStale(row) ? 'warning' : 'success'" size="small" effect="plain">
                  {{ sealStale(row) ? '已变更待复核' : '已封存' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="reviewer" label="复核人" width="90" />
            <el-table-column label="封存时间" width="160">
              <template #default="{ row }: { row: SegmentSeal }">{{ formatTime(row.sealedAt) }}</template>
            </el-table-column>
            <el-table-column label="测点数" width="80">
              <template #default="{ row }: { row: SegmentSeal }">{{ row.stationCount }}</template>
            </el-table-column>
            <el-table-column label="闭合差(m)" width="100">
              <template #default="{ row }: { row: SegmentSeal }">
                <span :class="{ 'seal-over': row.closureOver }">{{ row.closure.toFixed(3) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="异常桩号" min-width="110">
              <template #default="{ row }: { row: SegmentSeal }">
                <span v-if="row.abnormalStakes.length > 0" class="mono">{{ row.abnormalStakes.join('、') }}</span>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column prop="handlingNote" label="处理说明" min-width="130" show-overflow-tooltip>
              <template #default="{ row }: { row: SegmentSeal }">{{ row.handlingNote || '—' }}</template>
            </el-table-column>
          </el-table>
        </template>
      </template>
      <template #footer>
        <el-button @click="sealDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmSeal">确认封存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.range {
  display: flex;
  align-items: center;
  gap: 6px;
}
.seal-line {
  margin-top: 2px;
  line-height: 1.5;
}
.seal-head {
  margin: 0 0 12px;
  line-height: 1.6;
}
.seal-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.seal-block {
  margin-bottom: 12px;
}
.seal-abnormal {
  margin: 6px 0 0;
  padding-left: 18px;
  line-height: 1.8;
}
.seal-history-title {
  margin: 16px 0 8px;
  font-size: 13px;
  font-weight: 600;
}
.seal-over {
  color: #b03030;
  font-weight: 600;
}
</style>
