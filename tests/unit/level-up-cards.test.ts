import { describe, expect, it } from 'vitest'

import {
	affinityFor,
	affinityFromPresetWeights,
	drawCandidates,
	flattenEffects,
	pickBest,
	pickWeighted,
	rollLevelUp,
	type LevelUpChoice,
	type LevelUpPool,
	type PresetAffinity,
} from '../../src/game/player/level-up-cards'

const POOL: LevelUpPool = {
	cardCount: 3,
	choices: [
		{ id: 'attack', pickWeight: 1.0, effects: { attackBonus: 5 } },
		{ id: 'health', pickWeight: 1.0, effects: { healthBonus: 30 } },
		{ id: 'speed', pickWeight: 0.8, effects: { speedBonus: 1 } },
		{ id: 'crit', pickWeight: 0.6, effects: { critChanceBonus: 0.04 } },
		{ id: 'regen', pickWeight: 0.6, effects: { regenBonus: 1 } },
		{ id: 'scan', pickWeight: 0.8, effects: { scanBonus: 12 } },
	],
}

const BALANCED: PresetAffinity = { attack: 1, health: 1, speed: 1, crit: 1, regen: 1, scan: 1 }

describe('drawCandidates', () => {
	it('returns the configured number of distinct cards', () => {
		const result = drawCandidates(POOL, 5)
		expect(result).toHaveLength(3)
		expect(new Set(result.map(c => c.id)).size).toBe(3)
	})

	it('is deterministic per level (same input = same output)', () => {
		expect(drawCandidates(POOL, 7)).toEqual(drawCandidates(POOL, 7))
		expect(drawCandidates(POOL, 11)).toEqual(drawCandidates(POOL, 11))
	})

	it('different levels yield different candidate orderings in general', () => {
		// 6장 풀에서 3장 추출이면 level 차이에 따라 다른 부분집합이 나와야 한다.
		// 결정성 회귀 방지: 최소한 한 level 쌍에서 두 결과가 다르다.
		const seen = new Set<string>()
		for (let level = 1; level <= 30; level++) {
			seen.add(drawCandidates(POOL, level).map(c => c.id).join(','))
		}
		expect(seen.size).toBeGreaterThan(3)
	})

	it('handles cardCount larger than pool by returning all cards without duplicates', () => {
		const pool: LevelUpPool = { cardCount: 99, choices: POOL.choices.slice(0, 2) }
		const result = drawCandidates(pool, 1)
		expect(result).toHaveLength(2)
		expect(new Set(result.map(c => c.id)).size).toBe(2)
	})

	it('survives a single-card pool', () => {
		const result = drawCandidates({ cardCount: 3, choices: [POOL.choices[0]] }, 5)
		expect(result).toEqual([POOL.choices[0]])
	})

	it('returns an empty array for an empty pool', () => {
		const result = drawCandidates({ cardCount: 3, choices: [] }, 5)
		expect(result).toEqual([])
	})

	it('falls back to the first remaining item when every weight is zero', () => {
		const zeroPool: LevelUpPool = {
			cardCount: 2,
			choices: [
				{ id: 'attack', pickWeight: 0, effects: { attackBonus: 1 } },
				{ id: 'health', pickWeight: 0, effects: { healthBonus: 1 } },
			],
		}
		const result = drawCandidates(zeroPool, 5)
		expect(result).toHaveLength(2)
		// pickWeighted returns items[0] of remaining; first pick removes 'attack', so second pick returns 'health'.
		expect(result[0]).toBe(zeroPool.choices[0])
		expect(result[1]).toBe(zeroPool.choices[1])
	})
})

describe('pickBest', () => {
	it('chooses the highest score (pickWeight × affinity)', () => {
		const candidates: LevelUpChoice[] = [POOL.choices[0], POOL.choices[3], POOL.choices[2]]
		const affinity: PresetAffinity = { ...BALANCED, crit: 10, attack: 0.1, speed: 0.1 }
		expect(pickBest(candidates, affinity)).toBe(POOL.choices[3])
	})

	it('tie-break falls back to first candidate with the higher score', () => {
		const candidates: LevelUpChoice[] = [POOL.choices[0], POOL.choices[1]]
		expect(pickBest(candidates, BALANCED)).toBe(POOL.choices[0])
	})

	it('handles missing affinity keys as neutral 1', () => {
		const candidates: LevelUpChoice[] = [POOL.choices[3]]
		const empty = {} as PresetAffinity
		expect(pickBest(candidates, empty)).toBe(POOL.choices[3])
	})
})

describe('rollLevelUp', () => {
	it('returns the chosen card and the candidate list', () => {
		const result = rollLevelUp(POOL, BALANCED, 5)
		expect(result.candidates).toHaveLength(3)
		expect(result.candidates).toContain(result.chosen)
	})

	it('aggressive affinity biases the choice toward attack/crit', () => {
		const aggressive: PresetAffinity = { ...BALANCED, attack: 5, crit: 5, health: 0.1, regen: 0.1 }
		const picks = new Set<string>()
		for (let level = 1; level <= 30; level++) {
			picks.add(rollLevelUp(POOL, aggressive, level).chosen.id)
		}
		// 공격 계열이 최소 한 번은 채택되어야 한다.
		expect(['attack', 'crit'].some(id => picks.has(id))).toBe(true)
	})

	it('survivor affinity biases toward health/regen', () => {
		const survivor: PresetAffinity = { ...BALANCED, health: 5, regen: 5, attack: 0.1, crit: 0.1 }
		const picks = new Set<string>()
		for (let level = 1; level <= 30; level++) {
			picks.add(rollLevelUp(POOL, survivor, level).chosen.id)
		}
		expect(['health', 'regen'].some(id => picks.has(id))).toBe(true)
	})
})

describe('affinityFor', () => {
	it('returns the row for the preset and fills missing keys with 1', () => {
		const table = {
			aggressive: { attack: 2, health: 0.5, speed: 1.4, crit: 1.5, regen: 0.6, scan: 1.3 },
			balanced: BALANCED,
			survivor: { attack: 0.7, health: 1.5, speed: 0.8, crit: 0.8, regen: 1.4, scan: 0.8 },
		}
		expect(affinityFor('aggressive', table).attack).toBe(2)
		expect(affinityFor('survivor', table).health).toBe(1.5)
	})

	it('falls back to balanced when preset is unknown', () => {
		const table = { aggressive: BALANCED, balanced: BALANCED, survivor: BALANCED }
		const a = affinityFor('aggressive', table)
		// mock unknown: cast through any for safety
		const got = affinityFor('aggressive' as never, { balanced: BALANCED })
		expect(got.attack).toBe(a.attack)
	})
})

describe('flattenEffects', () => {
	it('returns only defined numeric effects', () => {
		const card: LevelUpChoice = { id: 'attack', pickWeight: 1, effects: { attackBonus: 7 } }
		const out = flattenEffects(card)
		expect(out).toEqual({ attackBonus: 7 })
		expect(out.healthBonus).toBeUndefined()
	})

	it('handles multi-effect cards', () => {
		const card: LevelUpChoice = {
			id: 'crit',
			pickWeight: 1,
			effects: { critChanceBonus: 0.05, scanBonus: 10 },
		}
		expect(flattenEffects(card)).toEqual({ critChanceBonus: 0.05, scanBonus: 10 })
	})

	it('skips entries whose value is undefined', () => {
		const card: LevelUpChoice = {
			id: 'mixed',
			pickWeight: 1,
			effects: {
				attackBonus: undefined,
				healthBonus: 10,
				speedBonus: undefined,
			} as LevelUpChoice['effects'],
		}
		expect(flattenEffects(card)).toEqual({ healthBonus: 10 })
	})
})

describe('affinityFromPresetWeights', () => {
	it('mirrors preset weights into card affinities (crit stays neutral)', () => {
		const weights = { attackWeight: 2, healthWeight: 0.5, speedWeight: 1.4, scanWeight: 1.8, regenBonus: 4 }
		const affinity = affinityFromPresetWeights(weights)
		expect(affinity.attack).toBe(2)
		expect(affinity.health).toBe(0.5)
		expect(affinity.speed).toBe(1.4)
		expect(affinity.scan).toBe(1.8)
		expect(affinity.crit).toBe(1)
		// regenBonus 4 → 1 + 4*0.5 = 3
		expect(affinity.regen).toBe(3)
	})

	it('returns 1 for regen when no bonus', () => {
		const weights = { attackWeight: 1, healthWeight: 1, speedWeight: 1, scanWeight: 1, regenBonus: 0 }
		expect(affinityFromPresetWeights(weights).regen).toBe(1)
	})
})

describe('pickWeighted', () => {
	const cardA: LevelUpChoice = { id: 'attack', pickWeight: 1, effects: { attackBonus: 1 } }
	const cardB: LevelUpChoice = { id: 'health', pickWeight: 3, effects: { healthBonus: 1 } }
	const cardC: LevelUpChoice = { id: 'speed', pickWeight: 6, effects: { speedBonus: 1 } }

	it('returns undefined when the list is empty', () => {
		expect(pickWeighted<LevelUpChoice>([], () => 0.5)).toBeUndefined()
	})

	it('returns the first item when every weight is zero', () => {
		const zeroA: LevelUpChoice = { id: 'zeroA', pickWeight: 0, effects: {} }
		const zeroB: LevelUpChoice = { id: 'zeroB', pickWeight: 0, effects: {} }
		expect(pickWeighted([zeroA, zeroB], () => 0.5)).toBe(zeroA)
	})

	it('distributes picks proportionally to weights (statistical sanity)', () => {
		const counts = { attack: 0, health: 0, speed: 0 }
		for (let i = 0; i < 2000; i++) {
			const r = pickWeighted([cardA, cardB, cardC], Math.random)
			if (r) counts[r.id]++
		}
		// attack:health:speed ≈ 1:3:6 (out of 10). Loose tolerance (±8pp) to avoid CI flake.
		expect(counts.attack / 2000).toBeLessThan(0.20)
		expect(counts.health / 2000).toBeGreaterThan(0.20)
		expect(counts.speed / 2000).toBeGreaterThan(0.40)
		// weighted ordering must hold
		expect(counts.speed).toBeGreaterThan(counts.health)
		expect(counts.health).toBeGreaterThan(counts.attack)
	})

	it('uses the loop tail fallback when no boundary matches (rand exceeds 1)', () => {
		// rand returns 1.5 → target = 6 > total=4; loop accumulates without matching, fallback returns the last item.
		const r = pickWeighted([cardA, cardB, cardC], () => 1.5)
		expect(r).toBe(cardC)
	})
})
