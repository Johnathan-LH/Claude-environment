import type { AccountWindow, Row, SessionRecord, Snapshot, Tokens, TurnEntry } from '../types'

export const HOUR = 3_600_000
export const FIVE_HOURS = 5 * HOUR
export const WEEK = 7 * 24 * HOUR
const KEEP_RECORD_MS = 30 * 24 * HOUR

export const zero = (): Tokens => ({ i: 0, o: 0, cr: 0, cw: 0 })

export const add = (a: Tokens, b: Tokens): Tokens => ({
  i: a.i + b.i,
  o: a.o + b.o,
  cr: a.cr + b.cr,
  cw: a.cw + b.cw,
})

/** 計入額度的主要數字：輸入 + 輸出 + 寫入快取（快取讀取另列）。 */
export const billable = (t: Tokens) => t.i + t.o + t.cw

export const newRecord = (id: string, now: number): SessionRecord => ({
  id,
  title: '',
  startedAt: now,
  lastAt: now,
  turns: [],
  total: zero(),
  windows: {},
})

export const addTurn = (rec: SessionRecord, turn: TurnEntry): SessionRecord => ({
  ...rec,
  lastAt: turn.t,
  turns: [...rec.turns.filter(x => x.t >= turn.t - WEEK), turn],
  total: add(rec.total, turn),
})

/**
 * 依 API 回報的帳號額度百分比，把同一窗口內的增量記在這個 session 上。
 * 窗口重置（resetsAt 改變）或第一次讀到時只建立基準，不計增量。
 */
export const trackWindows = (rec: SessionRecord, limits: AccountWindow[]): SessionRecord => {
  const windows = { ...rec.windows }
  for (const l of limits) {
    const prev = windows[l.kind]
    const isSame = prev !== undefined && prev.resetsAt === l.resetsAt
    const delta = isSame ? Math.max(0, l.percentUsed - prev.last) : 0
    windows[l.kind] = {
      resetsAt: l.resetsAt,
      last: l.percentUsed,
      used: Math.round(((isSame ? prev.used : 0) + delta) * 10) / 10,
    }
  }
  return { ...rec, windows }
}

/** 窗口起點：有 resetsAt 用它往前推，否則用滾動窗口。 */
export const windowStart = (account: AccountWindow[], kind: string, span: number, now: number) => {
  const w = account.find(a => a.kind === kind)
  const resets = w?.resetsAt ? Date.parse(w.resetsAt) : NaN
  return Number.isFinite(resets) ? resets - span : now - span
}

const sumSince = (turns: TurnEntry[], since: number) =>
  turns.filter(t => t.t >= since).reduce<Tokens>((acc, t) => add(acc, t), zero())

const pctIn = (rec: SessionRecord, kind: string, account: AccountWindow[]) => {
  const track = rec.windows[kind]
  const live = account.find(a => a.kind === kind)
  // 窗口已重置過的舊紀錄不算進目前窗口
  if (!track || (live && live.resetsAt !== track.resetsAt)) return 0
  return track.used
}

export const buildSnapshot = (
  records: SessionRecord[],
  account: AccountWindow[],
  currentId: string,
  now: number,
): Snapshot => {
  const fiveStart = windowStart(account, 'five_hour', FIVE_HOURS, now)
  const weekStart = windowStart(account, 'seven_day', WEEK, now)
  const rows: Row[] = records
    .filter(r => r.id === currentId || r.lastAt >= weekStart)
    .map(r => ({
      id: r.id,
      title: r.title || r.id.slice(0, 8),
      isCurrent: r.id === currentId,
      lastAt: r.lastAt,
      fiveHour: sumSince(r.turns, fiveStart),
      week: sumSince(r.turns, weekStart),
      fiveHourPct: pctIn(r, 'five_hour', account),
      weekPct: pctIn(r, 'seven_day', account),
      costUsd: r.costUsd,
    }))
    .sort((a, b) => b.lastAt - a.lastAt)
  return { now, account, rows }
}

export const isStale = (rec: SessionRecord, now: number) => rec.lastAt < now - KEEP_RECORD_MS

export const fmt = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`

export const fmtPct = (p: number) => `${p.toFixed(1)}%`

export const fmtReset = (iso: string | undefined, now: number) => {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const h = Math.floor(ms / HOUR)
  const m = Math.floor((ms % HOUR) / 60_000)
  return h >= 24 ? `${Math.floor(h / 24)}天${h % 24}時後重置` : `${h}時${m}分後重置`
}
