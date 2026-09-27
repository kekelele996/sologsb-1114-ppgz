/** 封存时留档的单站读数快照（复核时数字仍以此为准，不随后续改动变化） */
export interface SealedStationSnapshot {
  code: string
  bearing: number
  dip: number
  slopeDistance: number
  horizontalDistance: number
  verticalDistance: number
  /** 封存时该读数是否异常 */
  abnormal: boolean
}

/** 洞段复核封存记录：随洞段一并持久化，封存后只读留档 */
export interface SegmentReview {
  /** 复核人 */
  reviewer: string
  /** 封存时间（ISO 字符串） */
  sealedAt: string
  /** 封存时测点数 */
  stationCount: number
  /** 封存时闭合差（米） */
  closure: number
  /** 闭合差阈值（米） */
  threshold: number
  /** 闭合差是否超限 */
  overThreshold: boolean
  /** 异常读数对应桩号 */
  abnormalStakes: string[]
  /** 超限处理说明（闭合差超限时必填） */
  treatmentNote: string
  /** 封存时的闭合差计算过程说明 */
  detail: string
  /** 封存时刻的读数快照 */
  snapshots: SealedStationSnapshot[]
  /** 封存后测点是否发生过新增/更新/移除 */
  changed: boolean
}
