import { describe, expect, it } from 'vitest'

import {
	applySkillNodeEffects,
	findNewUnlocks,
	type SkillNode,
	type SkillNodeEffectsTarget,
	type SkillTreeConfig,
} from '../../src/game/player/skill-tree'

const CFG: SkillTreeConfig = {
	branches: {
		attack: {
			label: 'attack',
			nodes: [
				{ id: 'attack.a', unlockLevel: 3, effects: { slamCooldownMultiplier: 0.7 } },
				{ id: 'attack.b', unlockLevel: 6, effects: { furyDurationMultiplier: 1.5 } },
				{ id: 'attack.c', unlockLevel: 10, effects: { bonusFlatDamage: 4 } },
			],
		},
		defense: {
			label: 'defense',
			nodes: [
				{ id: 'defense.a', unlockLevel: 4, effects: { dodgeChance: 0.1 } },
				{ id: 'defense.b', unlockLevel: 7, effects: { damageTakenMultiplier: 0.88 } },
				{ id: 'defense.c', unlockLevel: 12, effects: { extraRegenBonus: 1 } },
			],
		},
		utility: {
			label: 'utility',
			nodes: [
				{ id: 'utility.a', unlockLevel: 5, effects: { collectRadiusMultiplier: 1.5 } },
				{ id: 'utility.b', unlockLevel: 8, effects: { scanRangeMultiplier: 1.3 } },
				{ id: 'utility.c', unlockLevel: 11, effects: { suppressFlee: true } },
			],
		},
	},
}

function emptyTarget(): SkillNodeEffectsTarget {
	return {
		slamCooldownMultiplier: 1,
		furyDurationMultiplier: 1,
		bonusFlatDamage: 0,
		dodgeChance: 0,
		damageTakenMultiplier: 1,
		extraRegenBonus: 0,
		collectRadiusMultiplier: 1,
		scanRangeMultiplier: 1,
		suppressFlee: false,
	}
}

describe('findNewUnlocks', () => {
	it('returns empty when level did not change', () => {
		expect(findNewUnlocks(CFG, 5, 5, [])).toEqual([])
	})

	it('returns nodes whose threshold lies inside (prevLevel, currentLevel]', () => {
		const result = findNewUnlocks(CFG, 2, 5, [])
		const ids = result.map(n => n.id)
		expect(ids).toContain('attack.a') // Lv3
		expect(ids).toContain('defense.a') // Lv4
		expect(ids).toContain('utility.a') // Lv5
		expect(ids).not.toContain('attack.b') // Lv6 > 5
	})

	it('skips already-unlocked nodes even if they would unlock again', () => {
		const result = findNewUnlocks(CFG, 2, 5, ['attack.a', 'defense.a'])
		expect(result.map(n => n.id)).toEqual(['utility.a'])
	})

	it('handles multi-level jumps (e.g., xp gives 2 levels at once)', () => {
		const result = findNewUnlocks(CFG, 1, 10, [])
		const ids = result.map(n => n.id)
		// 1 < unlockLevel ≤ 10
		expect(ids).toEqual([
			'attack.a',   // Lv3
			'defense.a',  // Lv4
			'utility.a',  // Lv5
			'attack.b',   // Lv6
			'defense.b',  // Lv7
			'utility.b',  // Lv8
			'attack.c',   // Lv10
		])
	})

	it('returns nodes in unlockLevel order', () => {
		const result = findNewUnlocks(CFG, 1, 12, [])
		const levels = result.map(n => n.unlockLevel)
		const sorted = [...levels].sort((a, b) => a - b)
		expect(levels).toEqual(sorted)
	})

	it('treats exact prevLevel/currentLevel boundary correctly (level-up from 3 to 3 = none)', () => {
		expect(findNewUnlocks(CFG, 3, 3, [])).toEqual([])
	})
})

describe('applySkillNodeEffects', () => {
	it('multiplies multipliers', () => {
		const target = emptyTarget()
		const node: SkillNode = { id: 'x', unlockLevel: 1, effects: { slamCooldownMultiplier: 0.5 } }
		applySkillNodeEffects(target, node)
		expect(target.slamCooldownMultiplier).toBe(0.5)
		applySkillNodeEffects(target, node) // double-apply (defensive in case caller misuses)
		expect(target.slamCooldownMultiplier).toBe(0.25)
	})

	it('adds additive fields', () => {
		const target = emptyTarget()
		const node: SkillNode = { id: 'x', unlockLevel: 1, effects: { bonusFlatDamage: 5, extraRegenBonus: 2 } }
		applySkillNodeEffects(target, node)
		expect(target.bonusFlatDamage).toBe(5)
		expect(target.extraRegenBonus).toBe(2)
	})

	it('clamps dodgeChance to [0, 1]', () => {
		const target = emptyTarget()
		const node: SkillNode = { id: 'x', unlockLevel: 1, effects: { dodgeChance: 0.6 } }
		applySkillNodeEffects(target, node)
		applySkillNodeEffects(target, node) // 1.2 → clamp
		expect(target.dodgeChance).toBe(1)
	})

	it('multiplies damageTakenMultiplier', () => {
		const target = emptyTarget()
		const node: SkillNode = { id: 'x', unlockLevel: 1, effects: { damageTakenMultiplier: 0.5 } }
		applySkillNodeEffects(target, node)
		applySkillNodeEffects(target, node)
		expect(target.damageTakenMultiplier).toBe(0.25)
	})

	it('OR-combines suppressFlee (any true sticks)', () => {
		const target = emptyTarget()
		const node: SkillNode = { id: 'x', unlockLevel: 1, effects: { suppressFlee: true } }
		applySkillNodeEffects(target, node)
		expect(target.suppressFlee).toBe(true)
		// 이후 false 노드로는 다시 꺼지지 않음 (OR)
		applySkillNodeEffects(target, { id: 'y', unlockLevel: 1, effects: { suppressFlee: false } })
		expect(target.suppressFlee).toBe(true)
	})

	it('applies collectRadiusMultiplier and scanRangeMultiplier', () => {
		const target = emptyTarget()
		applySkillNodeEffects(target, { id: 'a', unlockLevel: 1, effects: { collectRadiusMultiplier: 1.5 } })
		applySkillNodeEffects(target, { id: 'b', unlockLevel: 1, effects: { scanRangeMultiplier: 1.3 } })
		expect(target.collectRadiusMultiplier).toBe(1.5)
		expect(target.scanRangeMultiplier).toBe(1.3)
	})

	it('ignores nodes with no effects defined (empty effects object)', () => {
		const target = emptyTarget()
		applySkillNodeEffects(target, { id: 'x', unlockLevel: 1, effects: {} })
		// 모든 필드가 기본값 유지
		expect(target.slamCooldownMultiplier).toBe(1)
		expect(target.bonusFlatDamage).toBe(0)
		expect(target.dodgeChance).toBe(0)
		expect(target.damageTakenMultiplier).toBe(1)
		expect(target.suppressFlee).toBe(false)
	})

	it('applies furyDurationMultiplier', () => {
		const target = emptyTarget()
		applySkillNodeEffects(target, { id: 'x', unlockLevel: 1, effects: { furyDurationMultiplier: 1.5 } })
		expect(target.furyDurationMultiplier).toBe(1.5)
	})
})
