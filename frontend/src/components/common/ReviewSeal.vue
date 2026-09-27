<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { ClosureResult, Segment, Station } from '@/types'
import { computeClosure, formatDms, isAbnormalStation } from '@/utils/survey'
import { CLOSURE_THRESHOLD, reviewStore } from '@/stores/reviewStore'
import ClosureBadge from './ClosureBadge.vue'

const props = defineProps<{ segment: Segment; stations: Station[] }>()

const dialogVisible = ref(false)
/** view = 查看已封存记录；seal = 填写复核信息并封存 */
const mode = ref<'view' | 'seal'>('view')

const form = reactive({
  reviewer: '',
  treatmentNote: ''
})

function sortByCode(list: Station[]): Station[] {
  return [...list].sort(
    (a, b) => Number((a.code.match(/\d+/) ?? ['0'])[0]) - Number((b.code.match(/\d+/) ?? ['0'])[0])
  )
}

const currentStations = computed(() => sortByCode(props.stations))
const closure = computed<ClosureResult>(() => computeClosure(currentStations.value, CLOSURE_THRESHOLD))
const abnormalStakes = computed(() => currentStations.value.filter(isAbnormalStation).map((station) => station.code))

const review = computed(() => props.segment.review)
const changed = computed(() => review.value?.changed === true)

/** 已封存记录按当时闭合差回推误差等级，用于徽标展示 */
const sealedLevel = computed<ClosureResult['level']>(() => {
  const item = review.value
  if (!item) return '优'
  if (item.overThreshold) return '超限'
  return item.closure < item.threshold * 0.4 ? '优' : '良'
})

const canSeal = computed(
  () =>
    form.reviewer.trim().length > 0 &&
    currentStations.value.length > 0 &&
    (!closure.value.over || form.treatmentNote.trim().length > 0)
)

function openView(): void {
  mode.value = 'view'
  dialogVisible.value = true
}

function openSeal(): void {
  // 重新封存时沿用上一版的复核人与处理说明，便于核对修订
  form.reviewer = review.value?.reviewer ?? ''
  form.treatmentNote = review.value?.treatmentNote ?? ''
  mode.value = 'seal'
  dialogVisible.value = true
}

async function confirmSeal(): Promise<void> {
  try {
    await reviewStore.getState().seal(props.segment.id, {
      reviewer: form.reviewer,
      treatmentNote: form.treatmentNote
    })
    ElMessage.success(`洞段 ${props.segment.code} 已复核封存`)
    dialogVisible.value = false
  } catch (error) {
    ElMessage.error((error as Error).message)
  }
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <div class="review-cell">
    <el-button v-if="!review" link type="primary" size="small" @click="openSeal">复核封存</el-button>
    <el-tag
      v-else-if="!changed"
      type="success"
      effect="dark"
      size="small"
      class="seal-tag"
      @click="openView"
    >
      已封存 · {{ review.reviewer }}
    </el-tag>
    <el-tag v-else type="warning" effect="dark" size="small" class="seal-tag" @click="openView">
      已变更待复核
    </el-tag>
  </div>

  <el-dialog
    v-model="dialogVisible"
    :title="mode === 'seal' ? `复核封存 · ${segment.code}` : `封存记录 · ${segment.code}`"
    width="720px"
  >
    <!-- 封存表单 -->
    <div v-if="mode === 'seal'">
      <el-alert
        v-if="currentStations.length === 0"
        type="error"
        :closable="false"
        show-icon
        title="该洞段尚无测点读数，不能封存"
        class="block-alert"
      />
      <template v-else>
        <el-descriptions :column="2" border size="small" class="block-alert">
          <el-descriptions-item label="桩号区间">
            <span class="mono">{{ segment.startStake }} → {{ segment.endStake }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="封存测点数">{{ currentStations.length }} 站</el-descriptions-item>
        </el-descriptions>

        <ClosureBadge
          class="block-alert"
          :closure="closure.closure"
          :threshold="closure.threshold"
          :level="closure.level"
          :detail="closure.detail"
          :count="closure.count"
        />

        <el-alert
          v-if="abnormalStakes.length > 0"
          type="warning"
          :closable="false"
          show-icon
          class="block-alert"
          :title="`以下桩号读数异常：${abnormalStakes.join('、')}`"
          description="异常判定：方位角越界（0°–360°）、倾角越界（-90°–90°）、斜距非正或水平距大于斜距。"
        />

        <el-form label-width="96px" class="seal-form">
          <el-form-item label="复核人" required>
            <el-input v-model="form.reviewer" placeholder="收队复核人姓名" maxlength="20" />
          </el-form-item>
          <el-form-item label="封存时间">
            <span class="muted">点击「确认封存」时自动记录</span>
          </el-form-item>
          <el-form-item label="处理说明">
            <el-input
              v-model="form.treatmentNote"
              type="textarea"
              :rows="3"
              :placeholder="closure.over ? '闭合差已超限，必须填写复测/误差分配处理说明' : '闭合差在阈值内，可留空'"
            />
          </el-form-item>
        </el-form>
        <el-alert
          v-if="closure.over"
          type="error"
          :closable="false"
          show-icon
          class="block-alert"
          :title="`闭合差 ${closure.closure} m 超过阈值 ${closure.threshold} m，填写处理说明后才能封存`"
        />
      </template>
    </div>

    <!-- 已封存记录查看（数字以封存快照为准） -->
    <div v-else-if="review">
      <el-alert
        v-if="changed"
        type="warning"
        :closable="false"
        show-icon
        class="block-alert"
        title="封存后该洞段测点有新增、更新或移除，本记录为「已变更待复核」"
        description="以下读数为封存当时留档数字，不随后续改动变化；确认当前读数无误后可重新复核封存。"
      />
      <el-descriptions :column="2" border size="small" class="block-alert">
        <el-descriptions-item label="复核人">{{ review.reviewer }}</el-descriptions-item>
        <el-descriptions-item label="封存时间">{{ formatTime(review.sealedAt) }}</el-descriptions-item>
        <el-descriptions-item label="封存测点数">{{ review.stationCount }} 站</el-descriptions-item>
        <el-descriptions-item label="封存状态">
          <el-tag v-if="changed" type="warning" size="small" effect="dark">已变更待复核</el-tag>
          <el-tag v-else type="success" size="small" effect="dark">封存有效</el-tag>
        </el-descriptions-item>
      </el-descriptions>

      <ClosureBadge
        class="block-alert"
        :closure="review.closure"
        :threshold="review.threshold"
        :level="sealedLevel"
        :detail="review.detail"
        :count="review.stationCount"
      />

      <el-alert
        v-if="review.abnormalStakes.length > 0"
        type="warning"
        :closable="false"
        show-icon
        class="block-alert"
        :title="`封存时异常读数桩号：${review.abnormalStakes.join('、')}`"
      />
      <el-alert
        v-else
        type="success"
        :closable="false"
        show-icon
        class="block-alert"
        title="封存时全部读数正常"
      />

      <div v-if="review.treatmentNote" class="treatment">
        <b>超限处理说明：</b>{{ review.treatmentNote }}
      </div>

      <h4 class="snapshot-title">封存读数留档（{{ review.snapshots.length }} 站）</h4>
      <el-table :data="review.snapshots" border stripe size="small">
        <el-table-column prop="code" label="桩号" width="80" />
        <el-table-column label="方位角" width="150">
          <template #default="{ row }">{{ row.bearing }}° / {{ formatDms(row.bearing) }}</template>
        </el-table-column>
        <el-table-column label="倾角" width="80">
          <template #default="{ row }">{{ row.dip }}°</template>
        </el-table-column>
        <el-table-column prop="slopeDistance" label="斜距(m)" width="90" />
        <el-table-column prop="horizontalDistance" label="水平距(m)" width="100" />
        <el-table-column prop="verticalDistance" label="垂距(m)" width="90" />
        <el-table-column label="读数状态" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.abnormal" type="danger" size="small" effect="dark">异常</el-tag>
            <el-tag v-else type="success" size="small" effect="plain">正常</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <template #footer>
      <template v-if="mode === 'seal'">
        <el-button
          v-if="currentStations.length === 0"
          @click="review ? (mode = 'view') : (dialogVisible = false)"
        >
          {{ review ? '返回查看' : '取消' }}
        </el-button>
        <template v-else>
          <el-button @click="mode = 'view'">{{ review ? '返回查看' : '取消' }}</el-button>
          <el-button type="primary" :disabled="!canSeal" @click="confirmSeal">确认封存</el-button>
        </template>
      </template>
      <template v-else>
        <el-button @click="dialogVisible = false">关闭</el-button>
        <el-button v-if="changed" type="primary" @click="openSeal">重新复核封存</el-button>
      </template>
    </template>
  </el-dialog>
</template>

<style scoped>
.seal-tag {
  cursor: pointer;
}
.block-alert {
  margin-bottom: 12px;
}
.seal-form {
  margin-top: 4px;
}
.treatment {
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #fdf6ec;
  border: 1px solid #f5dab1;
  font-size: 13px;
  line-height: 1.7;
  color: #8a6d1f;
}
.snapshot-title {
  margin: 4px 0 8px;
  font-size: 13px;
  color: #4a5b6b;
}
</style>
