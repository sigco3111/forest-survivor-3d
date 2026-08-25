import { describe, expect, it } from 'vitest'

import {
	META_CONFIG,
	META_SAVE_KEY,
	applyRunXp,
	clearMetaState,
	computeRunXp,
	emptyMetaState,
	loadMetaState,
	saveMetaState,
	startBonusFor,
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
		expect(s.version).toBe(1)
		expect(s.totalXp).toBe(0)
		expect(s.metaLevel).toBe(0)
		expect(s.xpIntoLevel).toBe(0)
		expect(s.totalRuns).toBe(0)
		expect(s.unlockedSpecies).toEqual([])
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
		expect(startBonusFor(0)).toEqual({ extraHealth: 0, extraAttack: 0, extraWood: 0 })
	})

	it('scales bonuses with meta level', () => {
		expect(startBonusFor(5)).toEqual({
			extraHealth: 25,
			extraAttack: 2.5,
			extraWood: 3, // floor(5/5)*3
		})
	})

	it('handles large meta levels without floating drift', () => {
		const b = startBonusFor(20)
		expect(b.extraHealth).toBe(100)
		expect(b.extraAttack).toBe(10)
		expect(b.extraWood).toBe(12) // floor(20/5)*3
	})

	it('clamps negative meta level to zero', () => {
		expect(startBonusFor(-5)).toEqual({ extraHealth: 0, extraAttack: 0, extraWood: 0 })
	})
})

describe('save/load round trip', () => {
	it('saves and loads an equivalent state', () => {
		const storage = new MemoryStorage()
		const state: MetaState = {
			version: 1,
			totalXp: 1500,
			metaLevel: 4,
			xpIntoLevel: 200,
			totalRuns: 7,
			unlockedSpecies: ['Goblin', 'Skeleton'],
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
		storage.setItem(META_SAVE_KEY, JSON.stringify({ version: 99, totalXp: 0, metaLevel: 0, xpIntoLevel: 0, totalRuns: 0, unlockedSpecies: [] }))
		expect(loadMetaState(storage)).toBeNull()
	})

	it('returns null when any field is non-numeric', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, JSON.stringify({ version: 1, totalXp: 'oops', metaLevel: 0, xpIntoLevel: 0, totalRuns: 0, unlockedSpecies: [] }))
		expect(loadMetaState(storage)).toBeNull()
	})

	it('returns null when metaLevel is non-numeric', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, JSON.stringify({ version: 1, totalXp: 0, metaLevel: 'x', xpIntoLevel: 0, totalRuns: 0, unlockedSpecies: [] }))
		expect(loadMetaState(storage)).toBeNull()
	})

	it('returns null when xpIntoLevel is non-numeric', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, JSON.stringify({ version: 1, totalXp: 0, metaLevel: 0, xpIntoLevel: 'x', totalRuns: 0, unlockedSpecies: [] }))
		expect(loadMetaState(storage)).toBeNull()
	})

	it('returns null when totalRuns is non-numeric', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, JSON.stringify({ version: 1, totalXp: 0, metaLevel: 0, xpIntoLevel: 0, totalRuns: 'x', unlockedSpecies: [] }))
		expect(loadMetaState(storage)).toBeNull()
	})

	it('returns null when xpIntoLevel is negative', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, JSON.stringify({ version: 1, totalXp: 0, metaLevel: 0, xpIntoLevel: -1, totalRuns: 0, unlockedSpecies: [] }))
		expect(loadMetaState(storage)).toBeNull()
	})

	it('returns null when totalRuns is negative', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, JSON.stringify({ version: 1, totalXp: 0, metaLevel: 0, xpIntoLevel: 0, totalRuns: -1, unlockedSpecies: [] }))
		expect(loadMetaState(storage)).toBeNull()
	})

	it('returns null when metaLevel is negative', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, JSON.stringify({ version: 1, totalXp: 0, metaLevel: -1, xpIntoLevel: 0, totalRuns: 0, unlockedSpecies: [] }))
		expect(loadMetaState(storage)).toBeNull()
	})

	it('returns null when unlockedSpecies contains non-strings', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, JSON.stringify({ version: 1, totalXp: 0, metaLevel: 0, xpIntoLevel: 0, totalRuns: 0, unlockedSpecies: [1, 2] }))
		expect(loadMetaState(storage)).toBeNull()
	})

	it('returns null when numeric fields are negative', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, JSON.stringify({ version: 1, totalXp: -1, metaLevel: 0, xpIntoLevel: 0, totalRuns: 0, unlockedSpecies: [] }))
		expect(loadMetaState(storage)).toBeNull()
	})

	it('returns null when top-level value is not an object', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, JSON.stringify('hello'))
		expect(loadMetaState(storage)).toBeNull()
	})

	it('returns null when unlockedSpecies is not an array', () => {
		const storage = new MemoryStorage()
		storage.setItem(META_SAVE_KEY, JSON.stringify({ version: 1, totalXp: 0, metaLevel: 0, xpIntoLevel: 0, totalRuns: 0, unlockedSpecies: 'oops' }))
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
