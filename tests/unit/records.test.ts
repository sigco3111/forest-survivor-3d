import { describe, expect, it } from 'vitest'

import {
  loadBestRecord,
  saveBestRecord,
} from '../../src/game/records'

function makeStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial))
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  }
}

describe('best records', () => {
  it('returns null when no record is stored', () => {
    expect(loadBestRecord(makeStorage())).toBeNull()
  })

  it('round-trips a saved record', () => {
    const storage = makeStorage()
    const saved = saveBestRecord(storage, { days: 7, kills: 12 })
    expect(saved).toEqual({ days: 7, kills: 12 })
    expect(loadBestRecord(storage)).toEqual({ days: 7, kills: 12 })
  })

  it('keeps the better record: more days wins, ties break by kills', () => {
    const storage = makeStorage()
    saveBestRecord(storage, { days: 5, kills: 20 })
    // 더 적은 일차 → 기존 유지
    expect(saveBestRecord(storage, { days: 3, kills: 99 })).toEqual({ days: 5, kills: 20 })
    // 같은 일차, 더 많은 처치 → 갱신
    expect(saveBestRecord(storage, { days: 5, kills: 30 })).toEqual({ days: 5, kills: 30 })
    // 더 긴 일차 → 갱신
    expect(saveBestRecord(storage, { days: 9, kills: 1 })).toEqual({ days: 9, kills: 1 })
  })

  it('tolerates corrupted stored values', () => {
    const storage = makeStorage({ 'forest-survivor-best': '{not-json' })
    expect(loadBestRecord(storage)).toBeNull()
    const saved = saveBestRecord(storage, { days: 2, kills: 3 })
    expect(saved).toEqual({ days: 2, kills: 3 })
  })

  it('rejects records with missing fields', () => {
    const storage = makeStorage({ 'forest-survivor-best': JSON.stringify({ days: 3 }) })
    expect(loadBestRecord(storage)).toBeNull()
    const storage2 = makeStorage({ 'forest-survivor-best': JSON.stringify([1, 2]) })
    expect(loadBestRecord(storage2)).toBeNull()
  })
})
