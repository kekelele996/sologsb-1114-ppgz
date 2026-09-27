/** SegmentSeal 复核封存记录：封存一刻的读数快照，落库后不可改、不可删 */
export interface SegmentSeal {
  id: string
  segmentId: string
  /** 复核人 */
  reviewer: string
  /** 封存时间（ISO 字符串） */
  sealedAt: string
  /** 封存时测点数 */
  stationCount: number
  /** 封存时闭合差（米） */
  closure: number
  /** 封存时采用的闭合差阈值（米） */
  threshold: number
  /** 封存时闭合差是否超限 */
  closureOver: boolean
  /** 封存时异常读数对应的桩号 */
  abnormalStakes: string[]
  /** 超限处理说明（闭合差超阈值时必填） */
  handlingNote: string
  /** 封存时测点指纹：之后测点增删改都会使指纹失配，封存即转为「已变更待复核」 */
  fingerprint: string
}

/**
 * 封存状态（由封存记录与当前测点实时比对得出，不落库）：
 * - active：已封存，测点与封存时一致
 * - stale：已变更待复核，测点在封存后被增删改
 */
export type SealStatus = 'active' | 'stale'
