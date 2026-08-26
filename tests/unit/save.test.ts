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

/** v1 payload (마이그레이션 테스트용) */
function makeV1Payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
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

/** v2 payload (라운드트립 테스트용) */
function makeV2State(overrides: Partial<Omit<RunSaveState, 'version'>> = {}): Omit<RunSaveState, 'version'> {
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
    critChance: 0.1,
    critMultiplier: 1.7,
    damageTakenMultiplier: 0.9,
    dodgeChance: 0.05,
    bonusFlatDamage: 4,
    slamCooldownMultiplier: 0.7,
    furyDurationMultiplier: 1.5,
    extraRegenBonus: 1,
    extraScanRangePerLevel: 12,
    collectRadiusMultiplier: 1.5,
    scanRangeMultiplier: 1.3,
    suppressFlee: true,
    lastSlamAt: 1500,
    lastFuryAt: 2000,
    furyActiveUntil: 4500,
    regenTimer: 800,
	    mastery: {
	      speciesCounts: { Goblin: 7, Skeleton: 3 },
	      bossCount: 1,
	      triggeredKeys: ['Goblin:5', 'boss:1'],
	      activeBonus: { scanBonus: 15, critChanceBonus: 0.03, critMultiplierBonus: 0.3, attackBonus: 3, damageTakenMultiplier: 0.9 },
	    },
	    unlockedSkillNodes: ['attack.slam.cooldown', 'defense.dodge'],
	    unlockedPassiveNodeIds: ['passive.kills.25', 'passive.goblin.15'],
	    speciesKills: { Goblin: 7, Skeleton: 3 },
	    bossKills: 1,
	    cardChoiceCount: 6,
	    dayReached: 4,
	    levelReached: 7,
	    position: [12, -3],
	    gameNowMs: 312345,
    ...overrides,
  }
}

describe('run save state', () => {
  it('round-trips a saved v2 run with buildings and progress', () => {
    const storage = new MemoryStorage()
    const state = makeV2State()
    saveRunState(storage, state)
    expect(loadRunState(storage)).toEqual({ ...state, version: RUN_SAVE_VERSION })
  })

  it('normalizes a legacy caller without v2 fields before writing', () => {
    const storage = new MemoryStorage()
    saveRunState(storage, makeV1Payload() as unknown as Omit<RunSaveState, 'version'>)
    const loaded = loadRunState(storage)
    expect(loaded).not.toBeNull()
    expect(loaded?.critChance).toBe(0)
    expect(loaded?.unlockedPassiveNodeIds).toEqual([])
    expect(loaded?.position).toEqual([0, 0])
  })

  it('stamps the current save version when writing', () => {
    const storage = new MemoryStorage()
    saveRunState(storage, makeV2State())
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
      [RUN_SAVE_KEY]: JSON.stringify({ ...makeV2State(), version: RUN_SAVE_VERSION + 1 }),
    })
    expect(loadRunState(storage)).toBeNull()
    const old = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify({ ...makeV2State(), version: RUN_SAVE_VERSION - 2 }),
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
    ['weaponTier', Number.NaN],
  ])('rejects non-finite %s (%p)', (field, value) => {
    const storage = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify({ ...makeV2State({ [field]: value }), version: RUN_SAVE_VERSION }),
    })
    expect(loadRunState(storage)).toBeNull()
  })

  it('rejects an unknown preset', () => {
    const storage = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify({ ...makeV2State({ preset: 'tank' }), version: RUN_SAVE_VERSION }),
    })
    expect(loadRunState(storage)).toBeNull()
  })

  it('accepts every valid preset', () => {
    for (const preset of ['aggressive', 'balanced', 'survivor'] as const) {
      const storage = new MemoryStorage({
        [RUN_SAVE_KEY]: JSON.stringify({ ...makeV2State({ preset }), version: RUN_SAVE_VERSION }),
      })
      expect(loadRunState(storage)?.preset).toBe(preset)
    }
  })

  it('rejects empty buildings containers', () => {
    // 배열이 아니면 거부
    expect(
      loadRunState(new MemoryStorage({
        [RUN_SAVE_KEY]: JSON.stringify({ ...makeV2State({ buildings: {} }), version: RUN_SAVE_VERSION }),
      })),
    ).toBeNull()
    expect(
      loadRunState(new MemoryStorage({
        [RUN_SAVE_KEY]: JSON.stringify({ ...makeV2State({ buildings: 'none' }), version: RUN_SAVE_VERSION }),
      })),
    ).toBeNull()
  })

  it('accepts an empty building list', () => {
    const storage = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify({ ...makeV2State({ buildings: [] }), version: RUN_SAVE_VERSION }),
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
        ...makeV2State({ buildings: buildings as RunSaveBuilding[] }),
        version: RUN_SAVE_VERSION,
      }),
    })
    expect(loadRunState(storage)).toBeNull()
  })

  it('removes the stored key on clear', () => {
    const storage = new MemoryStorage()
    saveRunState(storage, makeV2State())
    clearRunState(storage)
    expect(storage.getItem(RUN_SAVE_KEY)).toBeNull()
    expect(loadRunState(storage)).toBeNull()
  })
})

describe('run save state v1 → v2 migration', () => {
  it('preserves all v1 fields and fills v2 defaults', () => {
    const storage = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify(makeV1Payload()),
    })
    const loaded = loadRunState(storage)
    expect(loaded).not.toBeNull()
    expect(loaded).toMatchObject({
      version: RUN_SAVE_VERSION,
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
      buildings: makeV1Payload().buildings,
    })
    // v2 신규 필드는 기본값
    expect(loaded?.critChance).toBe(0)
    expect(loaded?.critMultiplier).toBe(1.5)
    expect(loaded?.damageTakenMultiplier).toBe(1)
    expect(loaded?.dodgeChance).toBe(0)
    expect(loaded?.bonusFlatDamage).toBe(0)
    expect(loaded?.slamCooldownMultiplier).toBe(1)
    expect(loaded?.furyDurationMultiplier).toBe(1)
    expect(loaded?.extraRegenBonus).toBe(0)
    expect(loaded?.extraScanRangePerLevel).toBe(0)
    expect(loaded?.collectRadiusMultiplier).toBe(1)
    expect(loaded?.scanRangeMultiplier).toBe(1)
    expect(loaded?.suppressFlee).toBe(false)
    expect(loaded?.mastery).toEqual({
      speciesCounts: {},
      bossCount: 0,
      triggeredKeys: [],
      activeBonus: { scanBonus: 0, critChanceBonus: 0, critMultiplierBonus: 0, attackBonus: 0, damageTakenMultiplier: 1 },
    })
    expect(loaded?.unlockedSkillNodes).toEqual([])
    expect(loaded?.unlockedPassiveNodeIds).toEqual([])
    expect(loaded?.speciesKills).toEqual({})
    expect(loaded?.bossKills).toBe(0)
    expect(loaded?.cardChoiceCount).toBe(0)
    expect(loaded?.dayReached).toBe(4) // v1 day를 그대로 사용
    expect(loaded?.levelReached).toBe(5)
    expect(loaded?.position).toEqual([0, 0])
    expect(loaded?.gameNowMs).toBe((4 - 1) * 60_000 + 12345)
  })

  it('returns null when v1 has invalid core economy or health values', () => {
    const invalidMaxHealth = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify(makeV1Payload({ maxHealth: 0 })),
    })
    expect(loadRunState(invalidMaxHealth)).toBeNull()
    const negativeHealth = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify(makeV1Payload({ health: -1 })),
    })
    expect(loadRunState(negativeHealth)).toBeNull()
  })

  it('caps a legacy weapon tier to the current progression limit', () => {
    const storage = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify(makeV1Payload({ weaponTier: 99 })),
    })
    expect(loadRunState(storage)?.weaponTier).toBe(10)
  })

  it('returns null when v1 preset is invalid', () => {
    const storage = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify(makeV1Payload({ preset: 'tank' })),
    })
    expect(loadRunState(storage)).toBeNull()
  })

	it('returns null when v1 has malformed buildings', () => {
		const storage = new MemoryStorage({
			[RUN_SAVE_KEY]: JSON.stringify(makeV1Payload({ buildings: 'oops' })),
		})
		expect(loadRunState(storage)).toBeNull()
	})

	it('returns null when v1 building is malformed (inside array)', () => {
		const storage = new MemoryStorage({
			[RUN_SAVE_KEY]: JSON.stringify(makeV1Payload({
				buildings: [{ type: 'wall', position: [0, 0], bearing: 0, segmentIndex: 0, builtDay: 1 }],
			})),
		})
		expect(loadRunState(storage)).toBeNull()
	})

	it('returns null when v1 day is below 1', () => {
		const storage = new MemoryStorage({
			[RUN_SAVE_KEY]: JSON.stringify(makeV1Payload({ day: 0 })),
		})
		expect(loadRunState(storage)).toBeNull()
	})

  it('returns null when v1 numeric field is missing', () => {
    const payload = makeV1Payload()
    delete (payload as Record<string, unknown>).attackDamage
    const storage = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify(payload),
    })
    expect(loadRunState(storage)).toBeNull()
  })
})

describe('run save state v2 strict validation', () => {
  it.each([
    ['critChance', Number.NaN],
    ['critMultiplier', 'x'],
    ['damageTakenMultiplier', Number.NaN],
    ['dodgeChance', undefined],
    ['bonusFlatDamage', 'no'],
    ['slamCooldownMultiplier', null],
    ['furyDurationMultiplier', Number.NaN],
    ['extraRegenBonus', Number.NaN],
    ['extraScanRangePerLevel', 'no'],
    ['collectRadiusMultiplier', Number.NaN],
    ['scanRangeMultiplier', undefined],
    ['lastSlamAt', 'x'],
    ['lastFuryAt', Number.NaN],
    ['furyActiveUntil', Number.NaN],
    ['regenTimer', 'x'],
    ['bossKills', 'x'],
    ['cardChoiceCount', Number.NaN],
    ['dayReached', -1], // day < 1: 손상으로 보고 reject
    ['levelReached', 0], // level < 1: 손상으로 보고 reject
    ['gameNowMs', Number.NaN],
  ])('rejects malformed v2 field %s', (field, value) => {
    const storage = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify({
        ...makeV2State({ [field]: value }),
        version: RUN_SAVE_VERSION,
      }),
    })
    expect(loadRunState(storage)).toBeNull()
  })

  it('clamps out-of-range numeric v2 fields into safe defaults', () => {
    const storage = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify({
        ...makeV2State({
          critChance: 5,           // → 1 (상한)
          critMultiplier: 99,      // → 5 (상한)
          damageTakenMultiplier: 99, // → 2 (상한)
          dodgeChance: -1,         // → 0 (하한)
          bonusFlatDamage: -5,     // → 0 (하한)
          slamCooldownMultiplier: 0, // → 0.1 (하한)
          furyDurationMultiplier: 99, // → 10 (상한)
          extraRegenBonus: 1000,   // → 100 (상한)
          extraScanRangePerLevel: 99999, // → 10000 (상한)
          collectRadiusMultiplier: 0, // → 0.1 (하한)
          scanRangeMultiplier: 99, // → 10 (상한)
          regenTimer: -50,         // → 0 (하한)
          dayReached: 9999,        // → 1000000 (상한)
        }),
        version: RUN_SAVE_VERSION,
      }),
    })
    const loaded = loadRunState(storage)
    expect(loaded).not.toBeNull()
    expect(loaded?.critChance).toBe(0.75)
    expect(loaded?.critMultiplier).toBe(5)
    expect(loaded?.damageTakenMultiplier).toBe(2)
    expect(loaded?.dodgeChance).toBe(0)
    expect(loaded?.bonusFlatDamage).toBe(0)
    expect(loaded?.slamCooldownMultiplier).toBe(0.1)
    expect(loaded?.furyDurationMultiplier).toBe(10)
    expect(loaded?.extraRegenBonus).toBe(100)
    expect(loaded?.extraScanRangePerLevel).toBe(10_000)
    expect(loaded?.collectRadiusMultiplier).toBe(0.1)
    expect(loaded?.scanRangeMultiplier).toBe(10)
    expect(loaded?.regenTimer).toBe(0)
  })

  it('rejects v2 with non-boolean suppressFlee', () => {
    const storage = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify({
        ...makeV2State({ suppressFlee: 'yes' as never }),
        version: RUN_SAVE_VERSION,
      }),
    })
    expect(loadRunState(storage)).toBeNull()
  })

  it('rejects v2 with non-array unlockedSkillNodes', () => {
    const storage = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify({
        ...makeV2State({ unlockedSkillNodes: 'oops' as never }),
        version: RUN_SAVE_VERSION,
      }),
    })
    expect(loadRunState(storage)).toBeNull()
  })

  it('rejects v2 with non-string unlockedSkillNode entries', () => {
    const storage = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify({
        ...makeV2State({ unlockedSkillNodes: [1, 2] as never }),
        version: RUN_SAVE_VERSION,
      }),
    })
    expect(loadRunState(storage)).toBeNull()
  })

  it('rejects v2 with malformed unlockedPassiveNodeIds', () => {
    const storage = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify({
        ...makeV2State({ unlockedPassiveNodeIds: 'oops' as never }),
        version: RUN_SAVE_VERSION,
      }),
    })
    expect(loadRunState(storage)).toBeNull()
    const nonString = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify({
        ...makeV2State({ unlockedPassiveNodeIds: [1, 2] as never }),
        version: RUN_SAVE_VERSION,
      }),
    })
    expect(loadRunState(nonString)).toBeNull()
  })

  it('normalizes a negative v2 weapon tier to zero', () => {
    const storage = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify({
        ...makeV2State({ weaponTier: -1 }),
        version: RUN_SAVE_VERSION,
      }),
    })
    expect(loadRunState(storage)?.weaponTier).toBe(0)
  })

  it('normalizes out-of-range core health and time values', () => {
    const storage = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify({
        ...makeV2State({ health: 120, elapsedMsInDay: 90_000 }),
        version: RUN_SAVE_VERSION,
      }),
    })
    const loaded = loadRunState(storage)
    expect(loaded?.health).toBe(100)
    expect(loaded?.elapsedMsInDay).toBe(60_000)
  })

  it('rejects non-positive max health and negative core economy values', () => {
    const zeroMaxHealth = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify({
        ...makeV2State({ maxHealth: 0 }),
        version: RUN_SAVE_VERSION,
      }),
    })
    expect(loadRunState(zeroMaxHealth)).toBeNull()
    const negativeWood = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify({
        ...makeV2State({ wood: -1 }),
        version: RUN_SAVE_VERSION,
      }),
    })
    expect(loadRunState(negativeWood)).toBeNull()
  })

  it('rejects malformed mastery snapshots', () => {
    const base = makeV2State()
    const cases: Array<[string, unknown]> = [
      ['not an object', 'oops'],
      ['speciesCounts not an object', { ...base.mastery, speciesCounts: 'oops' }],
      ['negative species count', { ...base.mastery, speciesCounts: { ...base.mastery.speciesCounts, Goblin: -1 } }],
      ['negative boss count', { ...base.mastery, bossCount: -1 }],
      ['non-string triggered key', { ...base.mastery, triggeredKeys: [1] }],
      ['active bonus not an object', { ...base.mastery, activeBonus: 'oops' }],
    ]
    for (const [label, patch] of cases) {
      const storage = new MemoryStorage({
        [RUN_SAVE_KEY]: JSON.stringify({
          ...base,
          mastery: patch,
          version: RUN_SAVE_VERSION,
        }),
      })
      expect(loadRunState(storage), label).toBeNull()
    }
  })

  it('rejects non-finite mastery bonus fields and clamps damage multiplier', () => {
    const base = makeV2State()
    for (const field of ['scanBonus', 'critChanceBonus', 'critMultiplierBonus', 'attackBonus', 'damageTakenMultiplier'] as const) {
      const storage = new MemoryStorage({
        [RUN_SAVE_KEY]: JSON.stringify({
          ...base,
          mastery: {
            ...base.mastery,
            activeBonus: { ...base.mastery.activeBonus, [field]: 'bad' },
          },
          version: RUN_SAVE_VERSION,
        }),
      })
      expect(loadRunState(storage), field).toBeNull()
    }
    const storage = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify({
        ...base,
        mastery: {
          ...base.mastery,
          activeBonus: { ...base.mastery.activeBonus, damageTakenMultiplier: 0.1 },
        },
        version: RUN_SAVE_VERSION,
      }),
    })
    expect(loadRunState(storage)?.mastery.activeBonus.damageTakenMultiplier).toBe(0.3)
  })

  it('rejects v2 with non-object speciesKills', () => {
    const storage = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify({
        ...makeV2State({ speciesKills: 'oops' as never }),
        version: RUN_SAVE_VERSION,
      }),
    })
    expect(loadRunState(storage)).toBeNull()
  })

  it('rejects v2 with negative species kill count', () => {
    const storage = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify({
        ...makeV2State({ speciesKills: { Goblin: -1 } }),
        version: RUN_SAVE_VERSION,
      }),
    })
    expect(loadRunState(storage)).toBeNull()
  })

  it('rejects v2 with non-numeric species kill count', () => {
    const storage = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify({
        ...makeV2State({ speciesKills: { Goblin: 'no' } }),
        version: RUN_SAVE_VERSION,
      }),
    })
    expect(loadRunState(storage)).toBeNull()
  })

  it('rejects v2 with malformed position', () => {
    const storage = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify({
        ...makeV2State({ position: [1, 2, 3] }),
        version: RUN_SAVE_VERSION,
      }),
    })
    expect(loadRunState(storage)).toBeNull()
  })

  it('rejects v2 with non-finite position coordinate', () => {
    const storage = new MemoryStorage({
      [RUN_SAVE_KEY]: JSON.stringify({
        ...makeV2State({ position: [1, Number.NaN] }),
        version: RUN_SAVE_VERSION,
      }),
    })
    expect(loadRunState(storage)).toBeNull()
  })
})
