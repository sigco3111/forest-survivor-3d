import { describe, expect, it } from 'vitest'

import {
  applyStatus,
  isStunned,
  makeStatus,
  slowFactorFor,
  updateStatuses,
  type StatusEffect,
} from '../../src/game/combat/status-effects'

const NOW = 10_000

describe('makeStatus', () => {
  it('builds a stun effect with unit potency', () => {
    expect(makeStatus({ kind: 'stun', durationMs: 1500 }, NOW)).toEqual({
      kind: 'stun',
      potency: 1,
      expiresAt: NOW + 1500,
    })
  })

  it('builds a slow effect with the given movement multiplier', () => {
    expect(makeStatus({ kind: 'slow', durationMs: 2000, potency: 0.55 }, NOW)).toEqual({
      kind: 'slow',
      potency: 0.55,
      expiresAt: NOW + 2000,
    })
  })

  it('schedules the first bleed tick one interval away and clamps non-positive intervals', () => {
    expect(makeStatus({ kind: 'bleed', durationMs: 5000, potency: 3, tickIntervalMs: 800 }, NOW)).toEqual({
      kind: 'bleed',
      potency: 3,
      expiresAt: NOW + 5000,
      tickIntervalMs: 800,
      nextTickInMs: 800,
    })

    const clamped = makeStatus({ kind: 'bleed', durationMs: 5000, potency: 3, tickIntervalMs: 0 }, NOW)
    expect(clamped.tickIntervalMs).toBe(1)
    expect(clamped.nextTickInMs).toBe(1)
  })
})

describe('applyStatus', () => {
  it('appends a new kind as a defensive copy without touching the input array', () => {
    const stun = makeStatus({ kind: 'stun', durationMs: 1000 }, NOW)
    const existing: StatusEffect[] = [stun]
    const slow = makeStatus({ kind: 'slow', durationMs: 2000, potency: 0.6 }, NOW)

    const next = applyStatus(existing, slow)

    expect(existing).toEqual([stun])
    expect(next).toHaveLength(2)
    expect(next[1]).toEqual(slow)
    expect(next[1]).not.toBe(slow)
  })

  it('merges duplicates keeping longest duration and strongest potency independently', () => {
    const current: StatusEffect = { kind: 'slow', potency: 0.4, expiresAt: NOW + 3000 }
    const incoming: StatusEffect = { kind: 'slow', potency: 0.7, expiresAt: NOW + 1000 }

    const [merged] = applyStatus([current], incoming)

    expect(merged.potency).toBe(0.7)
    expect(merged.expiresAt).toBe(NOW + 3000)
  })

  it('passes unrelated kinds through untouched while merging another kind', () => {
    const stun = makeStatus({ kind: 'stun', durationMs: 1000 }, NOW)
    const bleed: StatusEffect = { kind: 'bleed', potency: 2, expiresAt: NOW + 4000, tickIntervalMs: 500, nextTickInMs: 100 }
    const incoming: StatusEffect = { kind: 'bleed', potency: 6, expiresAt: NOW + 2000 }

    const merged = applyStatus([stun, bleed], incoming)

    expect(merged[0]).toBe(stun) // 병합 대상이 아닌 상태는 참조 그대로
    expect(merged[1].potency).toBe(6)
    expect(merged[1].expiresAt).toBe(NOW + 4000)
  })

  it('keeps the longer-expiry bleed schedule while taking the max potency', () => {
    const current: StatusEffect = { kind: 'bleed', potency: 2, expiresAt: NOW + 4000, tickIntervalMs: 500, nextTickInMs: 100 }

    // 새 출혈이 더 오래 남는 경우: 일정도 새 것을 따른다
    const longerIncoming: StatusEffect = { kind: 'bleed', potency: 1, expiresAt: NOW + 9000, tickIntervalMs: 2000, nextTickInMs: 1800 }
    expect(applyStatus([current], longerIncoming)[0]).toEqual({
      kind: 'bleed',
      potency: 2,
      expiresAt: NOW + 9000,
      tickIntervalMs: 2000,
      nextTickInMs: 1800,
    })

    // 기존 출혈이 더 오래 남는 경우: 기존 일정을 유지하고 세기만 갱신된다
    const shorterIncoming: StatusEffect = { kind: 'bleed', potency: 9, expiresAt: NOW + 1000, tickIntervalMs: 250, nextTickInMs: 50 }
    const merged = applyStatus([current], shorterIncoming)[0]
    expect(merged.potency).toBe(9)
    expect(merged.expiresAt).toBe(NOW + 4000)
    expect(merged.tickIntervalMs).toBe(500)
    expect(merged.nextTickInMs).toBe(100)
  })
})

describe('updateStatuses', () => {
  it('returns empty results for an empty list', () => {
    expect(updateStatuses([], 100, NOW)).toEqual({ statuses: [], tickDamage: 0 })
  })

  it('drops statuses expiring at or before now and passes survivors through untouched', () => {
    const expired: StatusEffect = { kind: 'slow', potency: 0.5, expiresAt: NOW }
    const active: StatusEffect = { kind: 'stun', potency: 1, expiresAt: NOW + 100 }
    const input = [expired, active]

    const result = updateStatuses(input, 100, NOW)

    expect(result.statuses).toEqual([active])
    expect(result.statuses[0]).toBe(active)
    expect(result.tickDamage).toBe(0)
    expect(input).toEqual([expired, active]) // 입력 불변
  })

  it('advances a not-yet-due bleed countdown without dealing damage', () => {
    const bleed: StatusEffect = { kind: 'bleed', potency: 3, expiresAt: NOW + 6000, tickIntervalMs: 1000, nextTickInMs: 900 }

    const result = updateStatuses([bleed], 100, NOW)

    expect(result.tickDamage).toBe(0)
    expect(result.statuses).toEqual([{ ...bleed, nextTickInMs: 800 }])
  })

  it('fires exactly one tick when the countdown reaches zero and resets the interval', () => {
    const bleed: StatusEffect = { kind: 'bleed', potency: 3, expiresAt: NOW + 6000, tickIntervalMs: 1000, nextTickInMs: 100 }

    const result = updateStatuses([bleed], 100, NOW)

    expect(result.tickDamage).toBe(3)
    expect(result.statuses[0]?.nextTickInMs).toBe(1000)
  })

  it('catches up every missed tick when a large delta spans multiple intervals', () => {
    const bleed: StatusEffect = { kind: 'bleed', potency: 2, expiresAt: NOW + 60_000, tickIntervalMs: 1000, nextTickInMs: 2500 }

    const result = updateStatuses([bleed], 5200, NOW)

    // 2500/3500/4500ms 지점의 3틱 — 5500ms은 미도달
    expect(result.tickDamage).toBe(6)
    expect(result.statuses[0]?.nextTickInMs).toBe(300)
  })

  it('keeps a malformed bleed without tick data alive but harmless', () => {
    const broken: StatusEffect = { kind: 'bleed', potency: 5, expiresAt: NOW + 1000 }

    const result = updateStatuses([broken], 500, NOW)

    expect(result.tickDamage).toBe(0)
    expect(result.statuses).toEqual([broken])
  })

  it('survives a manually built zero-interval bleed without looping forever', () => {
    const zero: StatusEffect = { kind: 'bleed', potency: 1, expiresAt: NOW + 10_000, tickIntervalMs: 0, nextTickInMs: 0 }

    const result = updateStatuses([zero], 5, NOW)

    expect(result.tickDamage).toBeGreaterThan(0)
    expect(Number.isFinite(result.statuses[0]?.nextTickInMs)).toBe(true)
  })
})

describe('combat predicates', () => {
  it('isStunned reports only lists containing a stun', () => {
    expect(isStunned([])).toBe(false)
    expect(isStunned([{ kind: 'slow', potency: 0.5, expiresAt: NOW + 100 }])).toBe(false)
    expect(isStunned([{ kind: 'stun', potency: 1, expiresAt: NOW + 100 }])).toBe(true)
  })

  it('slowFactorFor picks the strongest multiplier, ignoring non-slows and buffs', () => {
    expect(slowFactorFor([])).toBe(1)
    expect(slowFactorFor([{ kind: 'stun', potency: 1, expiresAt: NOW + 100 }])).toBe(1)
    expect(slowFactorFor([
      { kind: 'slow', potency: 0.7, expiresAt: NOW + 100 },
      { kind: 'slow', potency: 0.4, expiresAt: NOW + 200 },
    ])).toBe(0.4)
    // 배율 1 초과 slow는 이동을 가속시키지 않는다 (하한 1 유지)
    expect(slowFactorFor([{ kind: 'slow', potency: 1.2, expiresAt: NOW + 100 }])).toBe(1)
  })
})
