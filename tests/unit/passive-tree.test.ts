import { describe, expect, it } from 'vitest'

import {
	applyPassiveNodeEffects,
	applyPassiveUnlock,
	createPassiveTreeState,
	emptyPassiveProgress,
	findPassiveUnlocks,
	recordPassiveCardChoice,
	recordPassiveDayReached,
	recordPassiveKill,
	recordPassiveLevelReached,
	type PassiveTreeConfig,
	type PassiveTreeState,
} from '../../src/game/player/passive-tree'
import type { SkillNodeEffectsTarget } from '../../src/game/player/skill-tree'

	const CFG: PassiveTreeConfig = {
	nodes: [
		{ id: 'level.5', trigger: { level: 5 }, effects: { damageTakenMultiplier: 0.98 }, labelKey: 'level.5' },
		{ id: 'kills.25', trigger: { totalKills: 25 }, effects: { bonusFlatDamage: 2 }, labelKey: 'kills.25' },
		{ id: 'kills.50', trigger: { totalKills: 50 }, effects: { dodgeChance: 0.05 }, labelKey: 'kills.50' },
		{ id: 'boss.1', trigger: { bossKills: 1 }, effects: { critMultiplierBonus: 0.2 }, labelKey: 'boss.1' },
		{ id: 'cards.15', trigger: { cardChoiceCount: 15 }, effects: { slamCooldownMultiplier: 0.85 }, labelKey: 'cards.15' },
		{ id: 'day.10', trigger: { dayReached: 10 }, effects: { collectRadiusMultiplier: 1.15 }, labelKey: 'day.10' },
		{ id: 'goblin.15', trigger: { speciesKills: { name: 'Goblin', count: 15 } }, effects: { dodgeChance: 0.05 }, labelKey: 'goblin.15' },
		{ id: 'multi.10', trigger: { totalKills: 10, cardChoiceCount: 5 }, effects: { extraRegenBonus: 1 }, labelKey: 'multi.10' },
	],
}

function emptyTarget(): SkillNodeEffectsTarget {
	return {
		slamCooldownMultiplier: 1,
		furyDurationMultiplier: 1,
		bonusFlatDamage: 0,
		critChance: 0,
		critMultiplier: 1.5,
		dodgeChance: 0,
		damageTakenMultiplier: 1,
		extraRegenBonus: 0,
		collectRadiusMultiplier: 1,
		scanRangeMultiplier: 1,
		suppressFlee: false,
	}
}

describe('emptyPassiveProgress', () => {
	it('returns zeros and identity', () => {
		const p = emptyPassiveProgress()
		expect(p).toEqual({
			level: 0,
			totalKills: 0,
			speciesKills: {},
			bossKills: 0,
			cardChoiceCount: 0,
			dayReached: 0,
		})
	})
})

describe('createPassiveTreeState', () => {
	it('returns identity', () => {
		const s = createPassiveTreeState()
		expect(s.unlockedIds).toEqual([])
		expect(s.pendingUnlocks).toEqual([])
		expect(s.progress).toEqual(emptyPassiveProgress())
	})
})

describe('findPassiveUnlocks', () => {
	it('returns empty when no trigger is satisfied', () => {
		const s = createPassiveTreeState()
		expect(findPassiveUnlocks(CFG, s)).toEqual([])
	})

	it('returns nodes whose totalKills threshold is satisfied', () => {
		const s: PassiveTreeState = {
			...createPassiveTreeState(),
			progress: { ...emptyPassiveProgress(), totalKills: 25 },
		}
		const found = findPassiveUnlocks(CFG, s)
		expect(found.map(n => n.id)).toEqual(['kills.25'])
	})

	it('returns nodes whose species threshold is satisfied', () => {
		const s: PassiveTreeState = {
			...createPassiveTreeState(),
			progress: { ...emptyPassiveProgress(), speciesKills: { Goblin: 15 } },
		}
		const found = findPassiveUnlocks(CFG, s)
		expect(found.map(n => n.id)).toEqual(['goblin.15'])
	})

	it('skips already-unlocked nodes', () => {
		const s: PassiveTreeState = {
			unlockedIds: ['kills.25'],
			pendingUnlocks: [],
			progress: { ...emptyPassiveProgress(), totalKills: 100 },
		}
		const found = findPassiveUnlocks(CFG, s)
		expect(found.map(n => n.id)).toEqual(['kills.50'])
	})

	it('requires all conditions in a multi-trigger node', () => {
		const s: PassiveTreeState = {
			...createPassiveTreeState(),
			progress: { ...emptyPassiveProgress(), totalKills: 10, cardChoiceCount: 4 },
		}
		const found = findPassiveUnlocks(CFG, s)
		expect(found).toEqual([])
	})

	it('passes once both conditions of a multi-trigger node are satisfied', () => {
		const s: PassiveTreeState = {
			...createPassiveTreeState(),
			progress: { ...emptyPassiveProgress(), totalKills: 10, cardChoiceCount: 5 },
		}
		const found = findPassiveUnlocks(CFG, s)
		expect(found.map(n => n.id)).toEqual(['multi.10'])
	})
})

describe('applyPassiveUnlock', () => {
	it('does not duplicate unlocked IDs', () => {
		const s: PassiveTreeState = {
			unlockedIds: ['kills.25'],
			pendingUnlocks: [],
			progress: emptyPassiveProgress(),
		}
		const next = applyPassiveUnlock(s, {
			id: 'kills.25',
			trigger: {},
			effects: {},
			labelKey: 'k',
		})
		expect(next.unlockedIds).toEqual(['kills.25'])
		expect(next).not.toBe(s)
	})

	it('adds new ID', () => {
		const s = createPassiveTreeState()
		const next = applyPassiveUnlock(s, {
			id: 'x',
			trigger: {},
			effects: {},
			labelKey: 'x',
		})
		expect(next.unlockedIds).toEqual(['x'])
	})
})

describe('applyPassiveNodeEffects', () => {
	it('forwards to applySkillNodeEffects (multipliers + clamps + suppressFlee)', () => {
		const target = emptyTarget()
		applyPassiveNodeEffects(target, { id: 'a', trigger: {}, effects: { slamCooldownMultiplier: 0.5, dodgeChance: 0.4 }, labelKey: 'a' })
		applyPassiveNodeEffects(target, { id: 'b', trigger: {}, effects: { dodgeChance: 0.4, suppressFlee: true }, labelKey: 'b' })
		expect(target.slamCooldownMultiplier).toBe(0.5)
		expect(target.dodgeChance).toBeCloseTo(0.8)
		expect(target.suppressFlee).toBe(true)
	})

	it('handles empty effects', () => {
		const target = emptyTarget()
		applyPassiveNodeEffects(target, { id: 'x', trigger: {}, effects: {}, labelKey: 'x' })
		expect(target.slamCooldownMultiplier).toBe(1)
		expect(target.bonusFlatDamage).toBe(0)
	})
})

describe('recordPassiveKill', () => {
	it('increments total and species counts', () => {
		const s = createPassiveTreeState()
		const { state } = recordPassiveKill(s, CFG, 'Goblin', false, emptyTarget())
		expect(state.progress.totalKills).toBe(1)
		expect(state.progress.speciesKills.Goblin).toBe(1)
		expect(state.progress.bossKills).toBe(0)
	})

	it('counts boss kills and applies crit multiplier', () => {
		const target = emptyTarget()
		const s = createPassiveTreeState()
		const { state } = recordPassiveKill(s, CFG, 'Giant', true, target)
		expect(state.progress.totalKills).toBe(1)
		expect(state.progress.bossKills).toBe(1)
		expect(target.critMultiplier).toBe(1.7)
	})

	it('does not mutate the previous state', () => {
		const s = createPassiveTreeState()
		const original = JSON.stringify(s.progress)
		recordPassiveKill(s, CFG, 'Goblin', false, emptyTarget())
		expect(JSON.stringify(s.progress)).toBe(original)
	})

	it('applies node effects to the target and queues pendingUnlocks when threshold reached', () => {
		const target = emptyTarget()
		let state = createPassiveTreeState()
		for (let i = 0; i < 25; i++) {
			const result = recordPassiveKill(state, CFG, 'Goblin', false, target)
			state = result.state
		}
		expect(state.unlockedIds).toContain('kills.25')
		expect(target.bonusFlatDamage).toBe(2) // kills.25
		expect(state.pendingUnlocks).toContain('kills.25')
	})

	it('does not re-apply effects when the same node is re-evaluated', () => {
		const target = emptyTarget()
		let state = createPassiveTreeState()
		for (let i = 0; i < 25; i++) {
			const result = recordPassiveKill(state, CFG, 'Goblin', false, target)
			state = result.state
		}
		const flatBefore = target.bonusFlatDamage
		// 한 번 더: 추가 가산 없음
		const again = recordPassiveKill(state, CFG, 'Goblin', false, target)
		expect(again.newUnlocks).toEqual([])
		expect(target.bonusFlatDamage).toBe(flatBefore)
	})

	it('fires species trigger at exact count', () => {
		const target = emptyTarget()
		let state = createPassiveTreeState()
		for (let i = 0; i < 14; i++) {
			const result = recordPassiveKill(state, CFG, 'Goblin', false, target)
			state = result.state
		}
		expect(state.unlockedIds).not.toContain('goblin.15')
		const final = recordPassiveKill(state, CFG, 'Goblin', false, target)
		expect(final.state.unlockedIds).toContain('goblin.15')
		expect(target.dodgeChance).toBeCloseTo(0.05)
	})
})

describe('recordPassiveLevelReached', () => {
	it('takes the maximum reached level and applies the milestone', () => {
		const target = emptyTarget()
		const state = recordPassiveLevelReached(createPassiveTreeState(), CFG, 3, target).state
		expect(state.unlockedIds).toEqual([])
		const reached = recordPassiveLevelReached(state, CFG, 5, target)
		expect(reached.state.unlockedIds).toContain('level.5')
		expect(target.damageTakenMultiplier).toBe(0.98)
	})

	it('does not re-apply an already unlocked level node', () => {
		const target = emptyTarget()
		const first = recordPassiveLevelReached(createPassiveTreeState(), CFG, 5, target)
		const second = recordPassiveLevelReached(first.state, CFG, 8, target)
		expect(second.newUnlocks).not.toContain('level.5')
		expect(target.damageTakenMultiplier).toBe(0.98)
	})
})

describe('recordPassiveCardChoice', () => {
	it('increments cardChoiceCount', () => {
		const s = createPassiveTreeState()
		const { state } = recordPassiveCardChoice(s, CFG, emptyTarget())
		expect(state.progress.cardChoiceCount).toBe(1)
	})

	it('unlocks card-based node', () => {
		const target = emptyTarget()
		let state = createPassiveTreeState()
		for (let i = 0; i < 15; i++) {
			const result = recordPassiveCardChoice(state, CFG, target)
			state = result.state
		}
		expect(state.unlockedIds).toContain('cards.15')
		expect(target.slamCooldownMultiplier).toBeCloseTo(0.85)
	})

	it('does not mutate the previous state', () => {
		const s = createPassiveTreeState()
		const original = JSON.stringify(s.progress)
		recordPassiveCardChoice(s, CFG, emptyTarget())
		expect(JSON.stringify(s.progress)).toBe(original)
	})
})

describe('recordPassiveDayReached', () => {
	it('takes the max of stored and incoming day', () => {
		const s: PassiveTreeState = {
			...createPassiveTreeState(),
			progress: { ...emptyPassiveProgress(), dayReached: 15 },
		}
		const { state } = recordPassiveDayReached(s, CFG, 8, emptyTarget())
		expect(state.progress.dayReached).toBe(15)
	})

	it('updates when incoming day is larger', () => {
		const s: PassiveTreeState = {
			...createPassiveTreeState(),
			progress: { ...emptyPassiveProgress(), dayReached: 5 },
		}
		const { state } = recordPassiveDayReached(s, CFG, 12, emptyTarget())
		expect(state.progress.dayReached).toBe(12)
		expect(state.unlockedIds).toContain('day.10')
	})

	it('does not mutate the previous state', () => {
		const s = createPassiveTreeState()
		const original = JSON.stringify(s.progress)
		recordPassiveDayReached(s, CFG, 12, emptyTarget())
		expect(JSON.stringify(s.progress)).toBe(original)
	})
})

describe('pending queue', () => {
	it('accumulates pendingUnlocks across multiple record calls', () => {
		const target = emptyTarget()
		let state = createPassiveTreeState()
		// 1st call: kills.25 + goblin.15 (25마리 처치 + Goblin 25마리)
		let result = recordPassiveKill(state, CFG, 'Goblin', false, target)
		for (let i = 0; i < 24; i++) result = recordPassiveKill(result.state, CFG, 'Goblin', false, target)
		state = result.state
		// 2nd call: kills.50 (cumulative 50) — 추가
		result = recordPassiveKill(state, CFG, 'Goblin', false, target)
		for (let i = 0; i < 24; i++) result = recordPassiveKill(result.state, CFG, 'Goblin', false, target)
		state = result.state
		expect(state.unlockedIds).toEqual(expect.arrayContaining(['kills.25', 'kills.50', 'goblin.15']))
		// pendingUnlocks는 매 호출에 누적 (호출자가 비우는 책임)
		expect(state.pendingUnlocks.length).toBeGreaterThanOrEqual(3)
	})
})

describe('integration: effects applied to agent-like target', () => {
	it('multi-trigger nodes require ALL conditions across events', () => {
		const target = emptyTarget()
		let state = createPassiveTreeState()
		// multi.10 requires totalKills>=10 AND cardChoiceCount>=5
		for (let i = 0; i < 10; i++) {
			state = recordPassiveKill(state, CFG, 'Goblin', false, target).state
		}
		// 10 처치, 카드 0 → multi.10 미발동
		expect(state.unlockedIds).not.toContain('multi.10')
		for (let i = 0; i < 5; i++) {
			state = recordPassiveCardChoice(state, CFG, target).state
		}
		expect(state.unlockedIds).toContain('multi.10')
		expect(target.extraRegenBonus).toBe(1)
	})
})
