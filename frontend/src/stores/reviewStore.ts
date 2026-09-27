import { createStore } from 'zustand/vanilla'
import type { Segment, SegmentReview, SealedStationSnapshot, Station } from '@/types'
import { computeClosure, isAbnormalStation } from '@/utils/survey'
import { db, syncPut } from '@/hooks/usePersistentStore'
import { segmentStore } from './segmentStore'

/** 闭合差阈值（米），与全站默认阈值保持一致 */
export const CLOSURE_THRESHOLD = 0.25

export interface SealInput {
  /** 复核人 */
  reviewer: string
  /** 超限处理说明（闭合差超限时必填） */
  treatmentNote: string
}

export interface ReviewState {
  /**
   * 复核封存：定格当前读数、复核人与闭合差。
   * 封存只在洞段上挂接复核记录，不改动任何测点读数。
   */
  seal: (segmentId: string, input: SealInput) => Promise<SegmentReview>
  /**
   * 测点新增 / 更新 / 移除后调用：若洞段处于有效封存状态，
   * 将封存标记为「已变更待复核」，原封存数字仍留档。
   */
  markChanged: (segmentId: string) => Promise<void>
}

/** 测点按桩号序号排序，保证封存快照与页面读数顺序一致 */
function sortByCode(stations: Station[]): Station[] {
  return [...stations].sort(
    (a, b) => Number((a.code.match(/\d+/) ?? ['0'])[0]) - Number((b.code.match(/\d+/) ?? ['0'])[0])
  )
}

export function buildSnapshots(stations: Station[]): SealedStationSnapshot[] {
  return sortByCode(stations).map((station) => ({
    code: station.code,
    bearing: station.bearing,
    dip: station.dip,
    slopeDistance: station.slopeDistance,
    horizontalDistance: station.horizontalDistance,
    verticalDistance: station.verticalDistance,
    abnormal: isAbnormalStation(station)
  }))
}

export const reviewStore = createStore<ReviewState>(() => ({
  seal: async (segmentId, input) => {
    const reviewer = input.reviewer.trim()
    if (!reviewer) {
      throw new Error('请填写复核人')
    }
    const segment = await db.segments.get(segmentId)
    if (!segment) {
      throw new Error('洞段不存在，无法封存')
    }
    const stations = sortByCode(await db.stations.where('segmentId').equals(segmentId).toArray())
    if (stations.length === 0) {
      throw new Error('该洞段尚无测点读数，无法封存')
    }

    const closure = computeClosure(stations, CLOSURE_THRESHOLD)
    const treatmentNote = input.treatmentNote.trim()
    if (closure.over && !treatmentNote) {
      throw new Error(`闭合差 ${closure.closure} m 已超过阈值 ${CLOSURE_THRESHOLD} m，请先填写超限处理说明再封存`)
    }

    const review: SegmentReview = {
      reviewer,
      sealedAt: new Date().toISOString(),
      stationCount: stations.length,
      closure: closure.closure,
      threshold: closure.threshold,
      overThreshold: closure.over,
      abnormalStakes: stations.filter(isAbnormalStation).map((station) => station.code),
      treatmentNote,
      detail: closure.detail,
      snapshots: buildSnapshots(stations),
      changed: false
    }

    // 封存不写测点、不产生读数修改记录，仅把复核信息挂到洞段上
    const sealedSegment: Segment = { ...segment, review }
    await syncPut<Segment>(db.segments, sealedSegment)
    await segmentStore.getState().hydrate()
    return review
  },

  markChanged: async (segmentId) => {
    const segment = await db.segments.get(segmentId)
    if (!segment?.review || segment.review.changed) return
    const nextSegment: Segment = {
      ...segment,
      review: { ...segment.review, changed: true }
    }
    await syncPut<Segment>(db.segments, nextSegment)
    await segmentStore.getState().hydrate()
  }
}))
