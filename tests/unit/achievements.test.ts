import { describe, expect, it } from 'vitest'

import {
	findNewAchievements,
	mergeAchievementIds,
	type AchievementConfig,
} from '../../src/game/achievements'
import { emptyPassiveProgress, type PassiveProgress } from '../../src/game/player/passive-tree'

function makeProgress(overrides: Partial<PassiveProgress> = {}): PassiveProgress {
	return { ...emptyPassiveProgress(), ...overrides }
}

const CONFIG: AchievementConfig = {
	definitions: [
		{ id: 'kills.100', trigger: { totalKills: 100 }, metaXpReward: 30 },
		{ id: 'goblin.50', trigger: { speciesKills: { name: 'Goblin', count: 50 } }, metaXpReward: 40 },
		{ id: 'boss.5', trigger: { bossKills: 5 }, metaXpReward: 120 },
		{ id: 'day.15', trigger: { dayReached: 15 }, metaXpReward: 60 },
		{ id: 'cards.25', trigger: { cardChoiceCount: 25 }, metaXpReward: 35 },
		{
			id: 'hunter.combo',
			trigger: { totalKills: 100, speciesKills: { name: 'Skeleton', count: 10 } },
			metaXpReward: 200,
		},
	],
}

describe('findNewAchievements', () => {
	it('returns nothing for untouched progress or an empty config', () => {
		expect(findNewAchievements(CONFIG, makeProgress(), [])).toEqual([])
		expect(findNewAchievements({ definitions: [] }, makeProgress({ totalKills: 999 }), [])).toEqual([])
	})

	it('returns a definition exactly when its threshold is reached', () => {
		expect(findNewAchievements(CONFIG, makeProgress({ totalKills: 99 }), [])).toEqual([])
		const newly = findNewAchievements(CONFIG, makeProgress({ totalKills: 100 }), [])
		expect(newly.map(definition => definition.id)).toEqual(['kills.100'])
		expect(newly[0]?.metaXpReward).toBe(30)
	})

	it('keeps thresholds satisfied beyond the minimum (monotonic counters)', () => {
		const newly = findNewAchievements(CONFIG, makeProgress({ totalKills: 4321 }), [])
		expect(newly.map(definition => definition.id)).toEqual(['kills.100'])
	})

	it('reports multiple simultaneous unlocks in config order', () => {
		const newly = findNewAchievements(CONFIG, makeProgress({
			totalKills: 150,
			speciesKills: { Goblin: 60 },
			bossKills: 7,
			dayReached: 20,
		}), [])

		expect(newly.map(definition => definition.id)).toEqual(['kills.100', 'goblin.50', 'boss.5', 'day.15'])
	})

	it('excludes already-unlocked ids even when their thresholds stay satisfied', () => {
		const newly = findNewAchievements(
			CONFIG,
			makeProgress({ totalKills: 150, bossKills: 6 }),
			['kills.100'],
		)
		expect(newly.map(definition => definition.id)).toEqual(['boss.5'])
	})

	it('matches species triggers on the exact name and boundary count', () => {
		const below = makeProgress({ speciesKills: { Goblin: 49, Skeleton: 12 } })
		expect(findNewAchievements(CONFIG, below, [])).toEqual([])

		const at = makeProgress({ speciesKills: { Goblin: 50, Skeleton: 12 } })
		expect(findNewAchievements(CONFIG, at, []).map(d => d.id)).toEqual(['goblin.50'])

		// hunter.combo는 Skeleton 10 이상을 추가로 요구한다
		const combo = makeProgress({ totalKills: 120, speciesKills: { Skeleton: 10 } })
		expect(findNewAchievements(CONFIG, combo, []).map(d => d.id)).toEqual(['kills.100', 'hunter.combo'])

		const comboMissing = makeProgress({ totalKills: 120, speciesKills: { Skeleton: 5 } })
		expect(findNewAchievements(CONFIG, comboMissing, []).map(d => d.id)).toEqual(['kills.100'])
	})

	it('does not mutate its inputs', () => {
		const state = makeProgress({ totalKills: 150 })
		const unlocked = ['kills.100']
		const snapshot = JSON.stringify(state)

		findNewAchievements(CONFIG, state, unlocked)

		expect(JSON.stringify(state)).toBe(snapshot)
		expect(unlocked).toEqual(['kills.100'])
	})
})

describe('mergeAchievementIds', () => {
	it('appends new ids sorted and deduplicated', () => {
		expect(mergeAchievementIds([], ['boss.5', 'kills.100', 'boss.5']))
			.toEqual(['boss.5', 'kills.100'])
		expect(mergeAchievementIds(['kills.100'], ['boss.5', 'kills.100']))
			.toEqual(['boss.5', 'kills.100'])
	})

	it('returns a fresh copy when there is nothing to add', () => {
		const existing = ['kills.100']
		const merged = mergeAchievementIds(existing, [])
		expect(merged).toEqual(existing)
		expect(merged).not.toBe(existing)
	})
})
