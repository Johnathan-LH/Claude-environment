export type Tokens = { i: number; o: number; cr: number; cw: number }

/** 一個 turn 的用量（主迴圈或 subagent），t 為結束時間 ms。 */
export type TurnEntry = Tokens & { t: number }

/** 一個額度窗口在本 session 的百分比追蹤。 */
export type WindowTrack = { resetsAt?: string; last: number; used: number }

/** 存在 $.store 的 `s:<sessionId>`。 */
export type SessionRecord = {
  id: string
  title: string
  startedAt: number
  lastAt: number
  turns: TurnEntry[]
  total: Tokens
  costUsd?: number
  windows: Record<string, WindowTrack>
}

export type AccountWindow = { kind: string; percentUsed: number; resetsAt?: string }

export type Row = {
  id: string
  title: string
  isCurrent: boolean
  lastAt: number
  fiveHour: Tokens
  week: Tokens
  fiveHourPct: number
  weekPct: number
  costUsd?: number
}

export type Snapshot = { now: number; account: AccountWindow[]; rows: Row[] }

declare module 'claude-code' {
  interface PluginState {
    'token-meter': { snapshot: Snapshot }
  }
}
