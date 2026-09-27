import { createStore } from 'zustand/vanilla'
import type { SegmentSeal } from '@/types'
import { db, syncAll, syncPut } from '@/hooks/usePersistentStore'

export interface SealState {
  seals: SegmentSeal[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 追加一条封存记录；封存不可改不可删，只随洞段删除级联清理 */
  seal: (seal: SegmentSeal) => Promise<void>
  removeBySegment: (segmentId: string) => Promise<void>
}

export const sealStore = createStore<SealState>((set, get) => ({
  seals: [],
  loaded: false,
  hydrate: async () => {
    const seals = await syncAll<SegmentSeal>(db.seals)
    // 新的封存在前，便于取每个洞段的最新一条
    seals.sort((a, b) => b.sealedAt.localeCompare(a.sealedAt))
    set({ seals, loaded: true })
  },
  seal: async (seal) => {
    await syncPut<SegmentSeal>(db.seals, seal)
    await get().hydrate()
  },
  removeBySegment: async (segmentId) => {
    await db.seals.where('segmentId').equals(segmentId).delete()
    await get().hydrate()
  }
}))
