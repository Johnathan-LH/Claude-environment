import { expect, test } from 'claude-code/testing'

import { addTurn, billable, buildSnapshot, HOUR, newRecord, trackWindows } from './ledger'

const t0 = Date.parse('2026-10-06T10:00:00Z')
const turn = (t: number, n: number) => ({ t, i: n, o: n, cr: 1000, cw: 0 })
const account = [
  { kind: 'five_hour', percentUsed: 30, resetsAt: '2026-10-06T12:00:00Z' },
  { kind: 'seven_day', percentUsed: 50, resetsAt: '2026-10-10T00:00:00Z' },
]

test('只計入目前 5 小時與一週窗口內的 token', () => {
  let r = newRecord('a', t0 - 6 * HOUR)
  r = addTurn(r, turn(t0 - 6 * HOUR, 100)) // 5h 窗口（07:00 起）之前
  r = addTurn(r, turn(t0, 10))
  const [row] = buildSnapshot([r], account, 'a', t0).rows
  expect(billable(row!.fiveHour)).toBe(20)
  expect(billable(row!.week)).toBe(220)
  expect(row!.week.cr).toBe(2000)
})

test('額度百分比只累計同一窗口內的增量，重置後歸零', () => {
  let r = newRecord('a', t0)
  r = trackWindows(r, [{ kind: 'five_hour', percentUsed: 20, resetsAt: 'A' }])
  r = trackWindows(r, [{ kind: 'five_hour', percentUsed: 23.5, resetsAt: 'A' }])
  r = trackWindows(r, [{ kind: 'five_hour', percentUsed: 25, resetsAt: 'A' }])
  expect(r.windows.five_hour!.used).toBe(5)
  r = trackWindows(r, [{ kind: 'five_hour', percentUsed: 2, resetsAt: 'B' }])
  expect(r.windows.five_hour!.used).toBe(0)
})

test('一週沒動的其他 session 不列出，目前 session 排在最近', () => {
  const old = addTurn(newRecord('old', t0 - 10 * 24 * HOUR), turn(t0 - 10 * 24 * HOUR, 5))
  const other = addTurn(newRecord('b', t0 - HOUR), turn(t0 - HOUR, 5))
  const me = addTurn(newRecord('me', t0), turn(t0, 5))
  const rows = buildSnapshot([old, other, me], account, 'me', t0).rows
  expect(rows.map(r => r.id)).toEqual(['me', 'b'])
  expect(rows[0]!.isCurrent).toBe(true)
})
