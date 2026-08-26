import { describe, expect, it } from 'vitest'

import {
	META_CONFIG,
	META_SAVE_KEY,
	META_SAVE_VERSION,
	applyRunXp,
	availablePerks,
	clearMetaState,
	computeRunXp,
	emptyMetaState,
	loadMetaState,
	reconcileUnlockedPerks,
	saveMetaState,
	startBonusFor,
	type MetaPerkConfig,
	type MetaState,
} from '../../src/game/meta-progression'

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
	private map = new Map<string, string>()
	getItem(key: string): string | null { return this.map.get(key) ?? null }
	setItem(key: string, value: string): void { this.map.set(key, value) }
	removeItem(key: string): void { this.map.delete(key) }
}

describe('emptyMetaState', () => {
	it('returns identity state', () => {
		const s = emptyMetaState()
		expect(s.version).toBe(META_SAVE_VERSION)
		expect(s.totalXp).toBe(0)
		expect(s.metaLevel).toBe(0)
		expect(s.xpIntoLevel).toBe(0)
		expect(s.totalRuns).toBe(0)
		expect(s.unlockedSpecies).toEqual([])
		expect(s.unlockedPerks).toEqual([])
	})
})

describe('computeRunXp', () => {
	it('uses weighted contribution of each stat', () => {
		expect(computeRunXp({ days: 10, kills: 20, bosses: 2, buildings: 5, goldenTrees: 1 })).toBe(
			10 * META_CONFIG.xpPerDay
			+ 20 * META_CONFIG.xpPerKill
			+ 2 * META_CONFIG.xpPerBoss
			+ 5 * META_CONFIG.xpPerBuilding
			+ 1 * META_CONFIG.xpPerGoldenTree,
		)
	})

	it('clamps negative inputs to zero', () => {
		expect(computeRunXp({ days: -5, kills: 10, bosses: 0, buildings: 0, goldenTrees: 0 }))
			.toBe(META_CONFIG.xpPerKill * 10)
	})

	it('returns zero for empty summary', () => {
		expect(computeRunXp({ days: 0, kills: 0, bosses: 0, buildings: 0, goldenTrees: 0 })).toBe(0)
	})
})

describe('applyRunXp', () => {
	it('increments totalRuns and merges species even when xp is zero', () => {
		const s = applyRunXp(emptyMetaState(), 0, ['Goblin'])
		expect(s.totalRuns).toBe(1)
		expect(s.unlockedSpecies).toEqual(['Goblin'])
	})

	it('adds xp and levels up once threshold is crossed', () => {
		const initial = emptyMetaState()
		const xpForLevel1 = META_CONFIG.metaLevelXp(1) // 200
		const next = applyRunXp(initial, xpForLevel1, [])
		expect(next.metaLevel).toBe(1)
		expect(next.totalXp).toBe(xpForLevel1)
		expect(next.xpIntoLevel).toBe(0)
	})

	it('chains multiple level-ups in one call when xp is large', () => {
		const initial = emptyMetaState()
		// 200 + 300 + 450 = 950 → L1 + L2 + L3
		const next = applyRunXp(initial, 1100, [])
		expect(next.metaLevel).toBe(3)
		expect(next.totalXp).toBe(1100)
		// 1100 - 950 = 150 remainder
		expect(next.xpIntoLevel).toBe(150)
	})

	it('leaves xpIntoLevel as the remainder when below the next threshold', () => {
		const next = applyRunXp(emptyMetaState(), 150, [])
		expect(next.metaLevel).toBe(0)
		expect(next.xpIntoLevel).toBe(150)
	})

	it('deduplicates unlocked species and sorts the result', () => {
		const next = applyRunXp(emptyMetaState(), 100, ['Goblin', 'Demon', 'Goblin', 'Zombie'])
		expect(next.unlockedSpecies).toEqual(['Demon', 'Goblin', 'Zombie'])
	})

	it('merges with prior unlocked list (does not overwrite)', () => {
		const initial = applyRunXp(emptyMetaState(), 50, ['Goblin'])
		const next = applyRunXp(initial, 50, ['Demon', 'Skeleton'])
		expect(next.unlockedSpecies).toEqual(['Demon', 'Goblin', 'Skeleton'])
	})

	it('does not mutate the input state', () => {
		const initial = emptyMetaState()
		const original = JSON.stringify(initial)
		applyRunXp(initial, 500, ['X'])
		expect(JSON.stringify(initial)).toBe(original)
	})
})

describe('startBonusFor', () => {
	it('returns zero bonuses at meta level 0', () => {
		expect(startBonusFor(0)).toEqual({
			extraHealth: 0,
			extraAttack: 0,
			extraWood: 0,
			extraCritChance: 0,
			extraCritMultiplier: 0,
			extraCollectRadiusMultiplier: 1,
		})
	})

	it('scales bonuses with meta level', () => {
		expect(startBonusFor(5)).toEqual({
			extraHealth: 25,
			extraAttack: 2.5,
			extraWood: 3, // floor(5/5)*3
			extraCritChance: 0,
			extraCritMultiplier: 0,
			extraCollectRadiusMultiplier: 1,
		})
	})

	it('handles large meta levels without floating drift', () => {
		const b = startBonusFor(20)
		expect(b.extraHealth).toBe(100)
		expect(b.extraAttack).toBe(10)
		expect(b.extraWood).toBe(12) // floor(20/5)*3
	})

	it('clamps negative meta level to zero', () => {
		expect(startBonusFor(-5)).toEqual({
			extraHealth: 0,
			extraAttack: 0,
			extraWood: 0,
			extraCritChance: 0,
			extraCritMultiplier: 0,
			extraCollectRadiusMultiplier: 1,
		})
	})
})

describe('save/load round trip', () => {
	it('saves and loads an equivalent state', () => {
		const storage = new MemoryStorage()
		const state: MetaState = {
			version: META_SAVE_VERSION,
			totalXp: 1500,
			metaLevel: 4,
			xpIntoLevel: 200,
			totalRuns: 7,
			unlockedSpecies: ['Goblin', 'Skeleton'],
			unlockedPerks: ['vitality'],
		}
		saveMetaState(storage, state)
		expect(loadMetaState(storage)).toEqual(state)
	})

	it('returns null when key is missing', () => {
		expect(loadMetaState(new MemoryStorage())).toBeNull()
	})

	it('returns null when JSON is corrupt', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, '{not json')
		expect(loadMetaState(storage)).toBeNull()
	})

	it('returns null when version is wrong', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, JSON.stringify({ version: 99, totalXp: 0, metaLevel: 0, xpIntoLevel: 0, totalRuns: 0, unlockedSpecies: [], unlockedPerks: [] }))
		expect(loadMetaState(storage)).toBeNull()
	})

	it('returns null when any field is non-numeric', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, JSON.stringify({ version: META_SAVE_VERSION, totalXp: 'oops', metaLevel: 0, xpIntoLevel: 0, totalRuns: 0, unlockedSpecies: [], unlockedPerks: [] }))
		expect(loadMetaState(storage)).toBeNull()
	})

	it('returns null when metaLevel is non-numeric', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, JSON.stringify({ version: META_SAVE_VERSION, totalXp: 0, metaLevel: 'x', xpIntoLevel: 0, totalRuns: 0, unlockedSpecies: [], unlockedPerks: [] }))
		expect(loadMetaState(storage)).toBeNull()
	})

	it('returns null when xpIntoLevel is non-numeric', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, JSON.stringify({ version: META_SAVE_VERSION, totalXp: 0, metaLevel: 0, xpIntoLevel: 'x', totalRuns: 0, unlockedSpecies: [], unlockedPerks: [] }))
		expect(loadMetaState(storage)).toBeNull()
	})

	it('returns null when totalRuns is non-numeric', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, JSON.stringify({ version: META_SAVE_VERSION, totalXp: 0, metaLevel: 0, xpIntoLevel: 0, totalRuns: 'x', unlockedSpecies: [], unlockedPerks: [] }))
		expect(loadMetaState(storage)).toBeNull()
	})

	it('returns null when xpIntoLevel is negative', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, JSON.stringify({ version: META_SAVE_VERSION, totalXp: 0, metaLevel: 0, xpIntoLevel: -1, totalRuns: 0, unlockedSpecies: [], unlockedPerks: [] }))
		expect(loadMetaState(storage)).toBeNull()
	})

	it('returns null when totalRuns is negative', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, JSON.stringify({ version: META_SAVE_VERSION, totalXp: 0, metaLevel: 0, xpIntoLevel: 0, totalRuns: -1, unlockedSpecies: [], unlockedPerks: [] }))
		expect(loadMetaState(storage)).toBeNull()
	})

	it('returns null when metaLevel is negative', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, JSON.stringify({ version: META_SAVE_VERSION, totalXp: 0, metaLevel: -1, xpIntoLevel: 0, totalRuns: 0, unlockedSpecies: [], unlockedPerks: [] }))
		expect(loadMetaState(storage)).toBeNull()
	})

	it('returns null when unlockedSpecies contains non-strings', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, JSON.stringify({ version: META_SAVE_VERSION, totalXp: 0, metaLevel: 0, xpIntoLevel: 0, totalRuns: 0, unlockedSpecies: [1, 2], unlockedPerks: [] }))
		expect(loadMetaState(storage)).toBeNull()
	})

	it('returns null when unlockedPerks contains non-strings', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, JSON.stringify({ version: META_SAVE_VERSION, totalXp: 0, metaLevel: 0, xpIntoLevel: 0, totalRuns: 0, unlockedSpecies: [], unlockedPerks: [1, 2] }))
		expect(loadMetaState(storage)).toBeNull()
	})

	it('returns null when numeric fields are negative', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, JSON.stringify({ version: META_SAVE_VERSION, totalXp: -1, metaLevel: 0, xpIntoLevel: 0, totalRuns: 0, unlockedSpecies: [], unlockedPerks: [] }))
		expect(loadMetaState(storage)).toBeNull()
	})

	it('returns null when top-level value is not an object', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, JSON.stringify('hello'))
		expect(loadMetaState(storage)).toBeNull()
	})

	it('returns null when unlockedSpecies is not an array', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, JSON.stringify({ version: META_SAVE_VERSION, totalXp: 0, metaLevel: 0, xpIntoLevel: 0, totalRuns: 0, unlockedSpecies: 'oops', unlockedPerks: [] }))
		expect(loadMetaState(storage)).toBeNull()
	})

	it('returns null when unlockedPerks is not an array', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, JSON.stringify({ version: META_SAVE_VERSION, totalXp: 0, metaLevel: 0, xpIntoLevel: 0, totalRuns: 0, unlockedSpecies: [], unlockedPerks: 'oops' }))
		expect(loadMetaState(storage)).toBeNull()
	})

	it('clears the key', () => {
		const storage = new MemoryStorage()
		saveMetaState(storage, emptyMetaState())
		expect(storage.getItem(META_SAVE_KEY)).not.toBeNull()
		clearMetaState(storage)
		expect(storage.getItem(META_SAVE_KEY)).toBeNull()
	})
})

describe('v1 → v2 migration', () => {
	it('preserves v1 fields and adds unlockedPerks default', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, JSON.stringify({
			version: 1,
			totalXp: 1500,
			metaLevel: 4,
			xpIntoLevel: 200,
			totalRuns: 7,
			unlockedSpecies: ['Goblin', 'Skeleton'],
		}))
		const loaded = loadMetaState(storage)
		expect(loaded).toEqual({
			version: META_SAVE_VERSION,
			totalXp: 1500,
			metaLevel: 4,
			xpIntoLevel: 200,
			totalRuns: 7,
			unlockedSpecies: ['Goblin', 'Skeleton'],
			unlockedPerks: [],
		})
	})

	it('rejects v1 with invalid fields', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, JSON.stringify({
			version: 1,
			totalXp: 'oops',
			metaLevel: 0,
			xpIntoLevel: 0,
			totalRuns: 0,
			unlockedSpecies: [],
		}))
		expect(loadMetaState(storage)).toBeNull()
	})

	it('rejects v1 with negative numeric field', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, JSON.stringify({
			version: 1,
			totalXp: 0,
			metaLevel: -1,
			xpIntoLevel: 0,
			totalRuns: 0,
			unlockedSpecies: [],
		}))
		expect(loadMetaState(storage)).toBeNull()
	})

	it('rejects v1 with non-array unlockedSpecies', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, JSON.stringify({
			version: 1,
			totalXp: 0,
			metaLevel: 0,
			xpIntoLevel: 0,
			totalRuns: 0,
			unlockedSpecies: 'oops',
		}))
		expect(loadMetaState(storage)).toBeNull()
	})

	it('rejects v1 with non-string unlockedSpecies entries', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, JSON.stringify({
			version: 1,
			totalXp: 0,
			metaLevel: 0,
			xpIntoLevel: 0,
			totalRuns: 0,
			unlockedSpecies: [1, 2],
		}))
		expect(loadMetaState(storage)).toBeNull()
	})
})

describe('meta perks', () => {
	const PERK_CONFIG: MetaPerkConfig = {
		perks: [
			{ id: 'vitality', unlockMetaLevel: 2, effects: { startHealth: 20 }, labelKey: 'metaPerk.vitality' },
			{ id: 'edge', unlockMetaLevel: 5, effects: { startAttack: 2 }, labelKey: 'metaPerk.edge' },
			{ id: 'stockpile', unlockMetaLevel: 8, effects: { startWood: 10 }, labelKey: 'metaPerk.stockpile' },
			{ id: 'crit-mastery', unlockMetaLevel: 10, effects: { startCritChance: 0.05, startCritMultiplier: 0.2 }, labelKey: 'metaPerk.crit-mastery' },
			{ id: 'magnet', unlockMetaLevel: 12, effects: { startCollectRadiusMultiplier: 1.1 }, labelKey: 'metaPerk.magnet' },
		],
		startHealthPerLevelCap: 60,
		startAttackPerLevelCap: 8,
		startWoodPerFiveLevelsCap: 30,
		startCritChanceCap: 0.2,
		startCritMultiplierCap: 0.5,
		startCollectRadiusMultiplierCap: 1.5,
	}

	it('availablePerks lists perks whose threshold is at or below meta level', () => {
		expect(availablePerks(PERK_CONFIG, 0)).toEqual([])
		expect(availablePerks(PERK_CONFIG, 2)).toEqual(['vitality'])
		expect(availablePerks(PERK_CONFIG, 6)).toEqual(['vitality', 'edge'])
		expect(availablePerks(PERK_CONFIG, 13)).toEqual([
			'vitality', 'edge', 'stockpile', 'crit-mastery', 'magnet',
		])
	})

	it('startBonusFor applies perk effects and caps them', () => {
		// 메타 레벨 13: vitality + edge + stockpile + magnet + crit-mastery 전부 활성
		const bonus = startBonusFor(13, PERK_CONFIG)
		// health: 13*5 + 20 = 85, cap 60 → 60
		expect(bonus.extraHealth).toBe(60)
		// attack: 13*0.5 + 2 = 8.5, cap 8 → 8
		expect(bonus.extraAttack).toBe(8)
		// wood: floor(13/5)*3 + 10 = 6 + 10 = 16, cap 30 → 16
		expect(bonus.extraWood).toBe(16)
		expect(bonus.extraCritChance).toBe(0.05)
		expect(bonus.extraCritMultiplier).toBe(0.2)
		expect(bonus.extraCollectRadiusMultiplier).toBeCloseTo(1.1)
	})

	it('startBonusFor skips perks above meta level', () => {
		// 메타 레벨 1: vitality(threshold 2)는 아직 해금 안 됨 → 적용 없음
		const bonus = startBonusFor(1, PERK_CONFIG)
		expect(bonus.extraHealth).toBe(5) // 1 * 5
		expect(bonus.extraAttack).toBe(0.5) // 1 * 0.5
		expect(bonus.extraCritChance).toBe(0)
		expect(bonus.extraCollectRadiusMultiplier).toBe(1)
	})

	it('startBonusFor without config has no perk effects', () => {
		const bonus = startBonusFor(12)
		expect(bonus.extraHealth).toBe(60) // 12 * 5
		expect(bonus.extraAttack).toBe(6) // 12 * 0.5
		expect(bonus.extraWood).toBe(6)
		expect(bonus.extraCritChance).toBe(0)
	})

	it('reconcileUnlockedPerks retroactively adds perks when meta level rises', () => {
		const state: MetaState = { ...emptyMetaState(), metaLevel: 4 }
		const next = reconcileUnlockedPerks(state, PERK_CONFIG)
		expect(next.unlockedPerks).toEqual(['vitality'])
		const state2 = { ...next, metaLevel: 13 }
		const next2 = reconcileUnlockedPerks(state2, PERK_CONFIG)
		// reconcileUnlockedPerks는 정렬된 목록을 돌려준다
		expect(next2.unlockedPerks).toEqual([
			'crit-mastery', 'edge', 'magnet', 'stockpile', 'vitality',
		])
	})

	it('reconcileUnlockedPerks preserves manually unlocked perks even if meta level drops', () => {
		const state: MetaState = { ...emptyMetaState(), metaLevel: 0, unlockedPerks: ['edge'] }
		const next = reconcileUnlockedPerks(state, PERK_CONFIG)
		expect(next.unlockedPerks).toEqual(['edge'])
	})

  it('applyRunXp keeps unlockedPerks intact and adds newly reached perks', () => {
    const initial: MetaState = { ...emptyMetaState(), metaLevel: 5, unlockedPerks: ['vitality'] }
    const next = applyRunXp(initial, 1000, [])
    expect(next.unlockedPerks).toEqual(['edge', 'vitality'])
  })
})
