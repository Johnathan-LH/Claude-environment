import { atom, read } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AccountWindow, SessionRecord, Snapshot } from '../types'
import {
  addTurn,
  billable,
  buildSnapshot,
  fmt,
  fmtPct,
  fmtReset,
  isStale,
  newRecord,
  trackWindows,
} from './ledger'

const PANE = 'token-meter'
const TITLE = 'Token 用量（5 小時 / 一週）'
const snapshot = atom({ plugin: 'token-meter', key: 'snapshot' } as const, {
  now: 0,
  account: [],
  rows: [],
} as Snapshot)
const ref = { plugin: 'token-meter', key: 'snapshot' } as const

const keyOf = (id: string) => `s:${id}`

// 同一個 session 的寫入依序進行，避免 turn.complete 與 session.measure 互相覆蓋
let chain: Promise<unknown> = Promise.resolve()
const serial = <T,>(fn: () => Promise<T>): Promise<T> => {
  const run = chain.then(fn, fn)
  chain = run.catch(() => undefined)
  return run
}

const loadOwn = async ($: EngineInterface, id: string, now: number) =>
  ((await $.store.get(keyOf(id))) as SessionRecord | undefined) ?? newRecord(id, now)

const mutate = ($: EngineInterface, fn: (r: SessionRecord, now: number) => SessionRecord) =>
  serial(async () => {
    const id = await $.session.id()
    const now = await $.clock.now()
    await $.store.set(keyOf(id), fn(await loadOwn($, id, now), now))
  })

const refresh = async ($: EngineInterface) => {
  const id = await $.session.id()
  const now = await $.clock.now()
  const usage = await $.session.usage()
  const account: AccountWindow[] = usage.rateLimits.map(l => ({
    kind: l.kind,
    percentUsed: l.percentUsed,
    resetsAt: l.resetsAt,
  }))
  const records: SessionRecord[] = []
  for (const key of await $.store.keys()) {
    if (!key.startsWith('s:')) continue
    const rec = (await $.store.get(key)) as SessionRecord | undefined
    if (rec) records.push(rec)
  }
  const snap = buildSnapshot(records, account, id, now)
  await $.state.set(ref, snap)

  const mine = snap.rows.find(r => r.isCurrent)
  if (mine) {
    $.ui.status(
      `本 task：5h ${fmt(billable(mine.fiveHour))} tok (≈${fmtPct(mine.fiveHourPct)}) · ` +
        `週 ${fmt(billable(mine.week))} tok (≈${fmtPct(mine.weekPct)})`,
    )
  }
  return snap
}

const report = (snap: Snapshot) => {
  const lines = ['**帳號額度**']
  for (const a of snap.account) {
    const name = a.kind === 'five_hour' ? '5 小時' : a.kind === 'seven_day' ? '一週' : a.kind
    lines.push(`- ${name}：${fmtPct(a.percentUsed)} ${fmtReset(a.resetsAt, snap.now)}`)
  }
  if (snap.account.length === 0) lines.push('- 尚無讀數（需訂閱帳號且已送出至少一個請求）')
  lines.push('', '| Task | 5h tokens | 5h ≈% | 週 tokens | 週 ≈% | 快取讀取(週) |', '|---|---|---|---|---|---|')
  for (const r of snap.rows) {
    lines.push(
      `| ${r.isCurrent ? '● ' : ''}${r.title.replace(/\|/g, '/')} | ${fmt(billable(r.fiveHour))} | ` +
        `${fmtPct(r.fiveHourPct)} | ${fmt(billable(r.week))} | ${fmtPct(r.weekPct)} | ${fmt(r.week.cr)} |`,
    )
  }
  lines.push('', 'tokens = 輸入 + 輸出 + 快取寫入；≈% 為本 task 期間帳號額度百分比的增量（估計）。')
  return lines.join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: 'token-meter',
      description: '顯示每個 task 在 5 小時與一週窗口內消耗的 token',
    })
    // 清掉 30 天沒動過的紀錄
    const now = await $.clock.now()
    for (const key of await $.store.keys()) {
      const rec = (await $.store.get(key)) as SessionRecord | undefined
      if (key.startsWith('s:') && rec && isStale(rec, now)) await $.store.delete(key)
    }
    await refresh($)
    // 其他 session 也會寫入 store，定時重讀
    $.clock.every(60_000, () => void refresh($))
    return result
  })

  on('turn.start', async ($, e, next) => {
    const text = e.text.trim().replace(/\s+/g, ' ')
    if (text) await mutate($, r => (r.title ? r : { ...r, title: text.slice(0, 40) }))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const u = e.usage
    if (u) {
      await mutate($, (r, now) =>
        addTurn(r, {
          t: now,
          i: u.input_tokens,
          o: u.output_tokens,
          cr: u.cache_read_input_tokens,
          cw: u.cache_creation_input_tokens,
        }),
      )
      await refresh($)
    }
    return result
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    await mutate($, r => ({
      ...trackWindows(
        r,
        e.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
      ),
      costUsd: e.cost?.usd ?? r.costUsd,
    }))
    await refresh($)
    return result
  })

  on('command.run', { command: 'token-meter' }, async $ => {
    const snap = await refresh($)
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: report(snap) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const snap = await read($, snapshot)
    const cols = e.props.bodyColumns
    const titleW = Math.max(8, cols - 34)
    const pad = (s: string, w: number) => (s.length > w ? s.slice(0, w - 1) + '…' : s.padEnd(w))
    const num = (s: string, w: number) => s.padStart(w)
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 7)

    return (
      <Box flexDirection="column">
        {snap.account.length === 0 ? (
          <Text dimColor>帳號額度：尚無讀數</Text>
        ) : (
          snap.account.map(a => (
            <Text>
              <Text bold>{a.kind === 'five_hour' ? '5 小時' : a.kind === 'seven_day' ? '一週  ' : a.kind}</Text>
              {` ${fmtPct(a.percentUsed).padStart(6)}  `}
              <Text dimColor>{fmtReset(a.resetsAt, snap.now)}</Text>
            </Text>
          ))
        )}
        <Text> </Text>
        <Text bold>
          {pad('Task', titleW)}
          {num('5h tok', 8)}
          {num('≈%', 6)}
          {num('週 tok', 9)}
          {num('≈%', 6)}
        </Text>
        {snap.rows.length === 0 && <Text dimColor>還沒有紀錄。</Text>}
        {snap.rows.slice(0, room).map(r => (
          <Text color={r.isCurrent ? 'cyan' : undefined} dimColor={!r.isCurrent && billable(r.fiveHour) === 0}>
            {pad((r.isCurrent ? '● ' : '  ') + r.title, titleW)}
            {num(fmt(billable(r.fiveHour)), 8)}
            {num(fmtPct(r.fiveHourPct), 6)}
            {num(fmt(billable(r.week)), 9)}
            {num(fmtPct(r.weekPct), 6)}
          </Text>
        ))}
        <Text dimColor>tok = 輸入+輸出+快取寫入；≈% 為估計</Text>
      </Box>
    )
  })
}
