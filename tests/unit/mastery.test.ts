import { describe, expect, it } from 'vitest'

import { MONSTER_CONFIG } from '../../src/config'
import {
	createMasteryState,
	emptyMasteryBonus,
	recordKill,
	toApplication,
	type MasteryConfig,
} from '../../src/game/player/mastery'
import type { MonsterResource } from '../../src/game/resources/monsters'

const CFG: MasteryConfig = {
	thresholds: [
		{ count: 5,  bonus: { scanBonus: 15 } },
		{ count: 15, bonus: { critChanceBonus: 0.03 } },
		{ count: 30, bonus: { attackBonus: 3 } },
		{ count: 50, bonus: { damageTakenMultiplier: 0.92 } },
	],
	bossThresholds: [
		{ count: 1, bonus: { critMultiplierBonus: 0.3 } },
		{ count: 3, bonus: { scanBonus: 25 } },
		{ count: 5, bonus: { damageTakenMultiplier: 0.9 } },
	],
}

function monster(overrides: Partial<MonsterResource> = {}): MonsterResource {
	return {
		id: 'm',
		modelName: 'Goblin',
		modelIndex: 0,
		position: [0, 0],
		rotation: 0,
		scale: 1,
		homePosition: [0, 0],
		patrolRadius: 50,
		speed: 10,
		detectionRadius: 120,
		health: 100,
		maxHealth: 100,
		attackDamage: 10,
		attackCooldownMs: 1_500,
		activityRadius: 170,
		hitStunMs: 700,
		isBoss: false,
		...overrides,
	}
}

describe('createMasteryState', () => {
	it('initializes with zero counts and identity bonus', () => {
		const s = createMasteryState()
		expect(s.bossCount).toBe(0)
		expect(s.speciesCounts.size).toBe(0)
		expect(s.activeBonus.damageTakenMultiplier).toBe(1)
		expect(s.activeBonus.scanBonus).toBe(0)
		expect(s.lastTriggeredKeys).toEqual([])
	})
})

describe('emptyMasteryBonus', () => {
	it('returns identity', () => {
		const b = emptyMasteryBonus()
		expect(b).toEqual({ scanBonus: 0, critChanceBonus: 0, critMultiplierBonus: 0, attackBonus: 0, damageTakenMultiplier: 1 })
	})
})

describe('recordKill', () => {
	it('accumulates species counts independently', () => {
		let s = createMasteryState()
		s = recordKill(s, monster({ modelName: 'Goblin' }), CFG)
		s = recordKill(s, monster({ modelName: 'Demon' }), CFG)
		expect(s.speciesCounts.get('Goblin')).toBe(1)
		expect(s.speciesCounts.get('Demon')).toBe(1)
	})

	it('triggers a threshold bonus exactly once per (species, count) pair', () => {
		let s = createMasteryState()
		for (let i = 0; i < 10; i++) {
			s = recordKill(s, monster({ modelName: 'Goblin' }), CFG)
		}
		// 5 도달 시점에 scanBonus +15 한 번만 발동 (중복 트리거 없음)
		expect(s.activeBonus.scanBonus).toBe(15)
		expect(s.lastTriggeredKeys).not.toContain('Goblin:5') // 발동 후 다음 호출 시 0
		s = recordKill(s, monster({ modelName: 'Goblin' }), CFG)
		expect(s.activeBonus.scanBonus).toBe(15) // 추가 가산 없음
	})

	it('triggers higher thresholds as the count grows', () => {
		let s = createMasteryState()
		for (let i = 0; i < 50; i++) {
			s = recordKill(s, monster({ modelName: 'Goblin' }), CFG)
		}
		expect(s.speciesCounts.get('Goblin')).toBe(50)
		expect(s.activeBonus.scanBonus).toBe(15)
		expect(s.activeBonus.critChanceBonus).toBe(0.03)
		expect(s.activeBonus.attackBonus).toBe(3)
		expect(s.activeBonus.damageTakenMultiplier).toBe(0.92)
	})

	it('multiplies damageTakenMultiplier across multiple triggers', () => {
		let s = createMasteryState()
		for (let i = 0; i < 50; i++) {
			s = recordKill(s, monster({ modelName: 'Goblin' }), CFG)
		}
		// 0.92 (from Goblin:50) and get a boss with damageTakenMultiplier 0.9
		for (let i = 0; i < 5; i++) {
			s = recordKill(s, monster({ isBoss: true }), CFG)
		}
		expect(s.activeBonus.damageTakenMultiplier).toBeCloseTo(0.92 * 0.9)
	})

	it('boss kills use boss thresholds and a separate counter', () => {
		let s = createMasteryState()
		s = recordKill(s, monster({ isBoss: true }), CFG)
		expect(s.bossCount).toBe(1)
		expect(s.activeBonus.critMultiplierBonus).toBe(0.3)
	})

	it('exposes lastTriggeredKeys of bonuses unlocked this call', () => {
		let s = createMasteryState()
		for (let i = 0; i < 4; i++) {
			s = recordKill(s, monster({ modelName: 'Goblin' }), CFG)
		}
		expect(s.lastTriggeredKeys).toEqual([]) // 5 미달
		s = recordKill(s, monster({ modelName: 'Goblin' }), CFG)
		expect(s.lastTriggeredKeys).toEqual(['Goblin:5'])
		// 다시 호출 시 이미 트리거된 키는 제외
		s = recordKill(s, monster({ modelName: 'Goblin' }), CFG)
		expect(s.lastTriggeredKeys).toEqual([])
	})

	it('does not mutate the previous state', () => {
		const original = createMasteryState()
		const next = recordKill(original, monster({ modelName: 'Goblin' }), CFG)
		expect(original.speciesCounts.size).toBe(0)
		expect(next.speciesCounts.size).toBe(1)
		expect(original.bossCount).toBe(0)
		expect(original.activeBonus).not.toBe(next.activeBonus)
	})

	it('triggers boss:3 scanBonus only at the third boss kill', () => {
		let s = createMasteryState()
		s = recordKill(s, monster({ isBoss: true }), CFG)
		expect(s.activeBonus.scanBonus).toBe(0) // boss:1은 scanBonus 없음
		s = recordKill(s, monster({ isBoss: true }), CFG)
		expect(s.activeBonus.scanBonus).toBe(0)
		s = recordKill(s, monster({ isBoss: true }), CFG)
		expect(s.activeBonus.scanBonus).toBe(25)
	})

	it('uses MONSTER_CONFIG import without throwing (smoke)', () => {
		expect(MONSTER_CONFIG.count).toBeGreaterThan(0)
	})
})

describe('toApplication', () => {
	it('skips identity fields', () => {
		const app = toApplication(emptyMasteryBonus())
		expect(app).toEqual({})
	})

	it('includes non-zero fields', () => {
		const app = toApplication({
			scanBonus: 10,
			critChanceBonus: 0.05,
			critMultiplierBonus: 0.2,
			attackBonus: 3,
			damageTakenMultiplier: 0.95,
		})
		expect(app).toEqual({
			scanRangeBonus: 10,
			critChanceBonus: 0.05,
			critMultiplierBonus: 0.2,
			attackBonus: 3,
			damageTakenMultiplier: 0.95,
		})
	})
})
