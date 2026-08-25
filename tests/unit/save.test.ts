import { describe, expect, it } from 'vitest'

import {
  RUN_SAVE_VERSION,
  clearRunState,
  loadRunState,
  saveRunState,
  type RunSaveBuilding,
  type RunSaveState,
} from '../../src/game/save'

const RUN_SAVE_KEY = 'forest-survivor-run'

/** 전역 localStorage를 건드리지 않는 메모리 Storage 스텁 */
class MemoryStorage {
  private store: Map<string, string>

  constructor(initial: Record<string, string> = {}) {
    this.store = new Map<string, string>(Object.entries(initial))
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    void this.store.set(key, value)
  }

  removeItem(key: string): void {
    void this.store.delete(key)
  }
}

function makeBuilding(overrides: Partial<RunSaveBuilding> = {}): RunSaveBuilding {
  return {
    type: 'campfire',
    position: [3, -4],
    bearing: Math.PI / 2,
    segmentIndex: 2,
    builtDay: 3,
    ...overrides,
  }
}

function makeState(overrides: Partial<Omit<RunSaveState, 'version'>> = {}): Omit<RunSaveState, 'version'> {
  return {
    savedAtMs: 1724500000000,
    day: 4,
    elapsedMsInDay: 12345,
    preset: 'balanced',
    level: 5,
    exp: 320,
    health: 80,
    maxHealth: 100,
    attackDamage: 12,
    speed: 6,
    wood: 42,
    kills: 17,
    weaponTier: 2,
    buildings: [makeBuilding(), makeBuilding({ type: 'fence', position: [10, 20], segmentIndex: 0, builtDay: 4 })],
    ...overrides,
  }
}

describe('run save state', () => {
  it('round-trips a saved run with buildings', () => {
    const storage = new MemoryStorage()
    const state = makeState()
    saveRunState(storage, state)
    expect(loadRunState(storage)).toEqual({ ...state, version: RUN_SAVE_VERSION })
  })

  it('stamps the current save version when writing', () => {
    const storage = new MemoryStorage()
    saveRunState(storage, makeState())
    const raw = JSON.parse(storage.getItem(RUN_SAVE_KEY) ?? '{}') as Record<string, unknown>
    expect(raw.version).toBe(RUN_SAVE_VERSION)
  })

  it('returns null when no run is stored', () => {
    expect(loadRunState(new MemoryStorage())).toBeNull()
  })

  it('tolerates corrupted JSON', () => {
    const storage = new MemoryStorage({ [RUN_SAVE_KEY]: '{not json' })
    expect(loadRunState(storage)).toBeNull()
  })

  it('rejects payloads that are not plain objects', () => {
    // null / 원시값 / 배열은 전부 거부한다
    expect(loadRunState(new MemoryStorage({ [RUN_SAVE_KEY]: 'null' }))).toBeNull()
    expect(loadRunState(new MemoryStorage({ [RUN_SAVE_KEY]: '42' }))).toBeNull()
    expect(loadRunState(new MemoryStorage({ [RUN_SAVE_KEY]: '"run"' }))).toBeNull()
    expect(loadRunState(new MemoryStorage({ [RUN_SAVE_KEY]: '[1,2]' }))).toBeNull()
  })

  it('rejects a mismatched save version', () => {
    const storage = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify({ ...makeState(), version: RUN_SAVE_VERSION + 1 }),
    })
    expect(loadRunState(storage)).toBeNull()
    const old = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify({ ...makeState(), version: RUN_SAVE_VERSION - 1 }),
    })
    expect(loadRunState(old)).toBeNull()
  })

  it.each([
    ['savedAtMs', Number.NaN],
    ['day', 0],
    ['elapsedMsInDay', -5],
    ['level', 0],
    ['exp', Number.NaN],
    ['health', Number.POSITIVE_INFINITY],
    ['maxHealth', Number.NaN],
    ['attackDamage', 'strong'],
    ['speed', null],
    ['wood', Number.NaN],
    ['kills', undefined],
    ['weaponTier', Number.NEGATIVE_INFINITY],
  ])('rejects non-finite %s (%p)', (field, value) => {
    const storage = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify({ ...makeState({ [field]: value }), version: RUN_SAVE_VERSION }),
    })
    expect(loadRunState(storage)).toBeNull()
  })

  it('rejects an unknown preset', () => {
    const storage = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify({ ...makeState({ preset: 'tank' }), version: RUN_SAVE_VERSION }),
    })
    expect(loadRunState(storage)).toBeNull()
  })

  it('accepts every valid preset', () => {
    for (const preset of ['aggressive', 'balanced', 'survivor'] as const) {
      const storage = new MemoryStorage({
        [RUN_SAVE_KEY]: JSON.stringify({ ...makeState({ preset }), version: RUN_SAVE_VERSION }),
      })
      expect(loadRunState(storage)?.preset).toBe(preset)
    }
  })

  it('rejects empty buildings containers', () => {
    // 배열이 아니면 거부
    expect(
      loadRunState(new MemoryStorage({
        [RUN_SAVE_KEY]: JSON.stringify({ ...makeState({ buildings: {} }), version: RUN_SAVE_VERSION }),
      })),
    ).toBeNull()
    expect(
      loadRunState(new MemoryStorage({
        [RUN_SAVE_KEY]: JSON.stringify({ ...makeState({ buildings: 'none' }), version: RUN_SAVE_VERSION }),
      })),
    ).toBeNull()
  })

  it('accepts an empty building list', () => {
    // 빈 배열도 유효한 상태로 복원된다
    const storage = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify({ ...makeState({ buildings: [] }), version: RUN_SAVE_VERSION }),
    })
    expect(loadRunState(storage)?.buildings).toEqual([])
  })

  it.each([
    ['null 항목', [null]],
    ['배열 항목', [[1, 2]]],
    ['원시 항목', [7]],
    ['필드 누락 항목', [{ type: 'campfire', position: [1, 2], bearing: 0, segmentIndex: 0 }]],
    ['잘못된 type', [makeBuilding({ type: 'wall' as never })]],
    ['position 길이 3', [makeBuilding({ position: [1, 2, 3] })]],
    ['position 비숫자', [makeBuilding({ position: ['a', 2] })]],
    ['bearing 비숫자', [makeBuilding({ bearing: undefined as never })]],
    ['segmentIndex NaN', [makeBuilding({ segmentIndex: Number.NaN })]],
    ['builtDay Infinity', [makeBuilding({ builtDay: Number.POSITIVE_INFINITY })]],
  ])('rejects malformed buildings: %s', (_label, buildings) => {
    const storage = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify({
        ...makeState({ buildings: buildings as RunSaveBuilding[] }),
        version: RUN_SAVE_VERSION,
      }),
    })
    expect(loadRunState(storage)).toBeNull()
  })

  it('removes the stored key on clear', () => {
    const storage = new MemoryStorage()
    saveRunState(storage, makeState())
    clearRunState(storage)
    expect(storage.getItem(RUN_SAVE_KEY)).toBeNull()
    expect(loadRunState(storage)).toBeNull()
  })
})
