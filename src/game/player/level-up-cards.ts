import type { PlayerPresetId, PresetWeights } from './agent'

export type LevelUpChoiceId = 'attack' | 'health' | 'speed' | 'crit' | 'regen' | 'scan'

/**
 * 한 장의 성장 카드. 채택 시 effects의 보너스가 agent에 누적된다.
 * pickWeight는 풀에서 추출될 때의 가중치, affinity는 성향별 점수 배율.
 */
export type LevelUpChoice = {
	id: LevelUpChoiceId
	pickWeight: number
	effects: {
		attackBonus?: number
		healthBonus?: number
		speedBonus?: number
		critChanceBonus?: number
		regenBonus?: number
		scanBonus?: number
	}
}

export type LevelUpPool = {
	choices: LevelUpChoice[]
	cardCount: number
}

/** 성향별 카드 친화도. 모두 1이면 균형. */
export type PresetAffinity = Record<LevelUpChoiceId, number>

export type LevelUpResult = {
	chosen: LevelUpChoice
	candidates: LevelUpChoice[]
}

function seededRandom(seed: number) {
	let s = seed
	return () => {
		s = (s * 16807 + 0) % 2147483647
		return (s - 1) / 2147483646
	}
}

export function pickWeighted<T extends { pickWeight: number }>(items: readonly T[], rand: () => number): T | undefined {
	if (!items.length) return undefined
	const total = items.reduce((sum, item) => sum + item.pickWeight, 0)
	if (total <= 0) return items[0]
	const target = rand() * total
	let acc = 0
	for (const item of items) {
		acc += item.pickWeight
		if (target <= acc) return item
	}
	// total > 0 and rand() returns [0, 1) ensure target < total, so the loop always returns.
	return items[items.length - 1]
}

/**
 * 후보 카드를 cardCount장 추출한다. 같은 카드가 중복으로 나오지 않으며,
 * 결정성을 위해 시드는 호출자가 level로 도출한다.
 */
export function drawCandidates(pool: LevelUpPool, level: number): LevelUpChoice[] {
	const rand = seededRandom(level * 104729 + 7919)
	const candidates: LevelUpChoice[] = []
	const remaining = [...pool.choices]
	for (let i = 0; i < pool.cardCount && remaining.length > 0; i++) {
		// pickWeighted always returns a non-undefined item while remaining is non-empty (loop guard),
		// so the bang assertion is safe.
		const pick = pickWeighted(remaining, rand)!
		candidates.push(pick)
		const idx = remaining.indexOf(pick)
		remaining.splice(idx, 1)
	}
	return candidates
}

/**
 * 카드 점수 = card.pickWeight × affinity[id]. 가장 높은 카드를 자동 채택한다.
 */
export function pickBest(candidates: readonly LevelUpChoice[], affinity: PresetAffinity): LevelUpChoice {
	let best = candidates[0]
	let bestScore = -Infinity
	for (const candidate of candidates) {
		const score = candidate.pickWeight * (affinity[candidate.id] ?? 1)
		if (score > bestScore) {
			bestScore = score
			best = candidate
		}
	}
	return best
}

/**
 * 풀 + 친화도로 레벨 1회분 결과를 만든다. 같은 level/affinity는 항상 같은 결과를 반환한다.
 */
export function rollLevelUp(pool: LevelUpPool, affinity: PresetAffinity, level: number): LevelUpResult {
	const candidates = drawCandidates(pool, level)
	const chosen = pickBest(candidates, affinity)
	return { chosen, candidates }
}

/**
 * 성향 프리셋에 맞는 기본 친화도 사전을 만든다. 미정의 키는 1로 채운다.
 */
export function affinityFor(preset: PlayerPresetId, table: Record<PlayerPresetId, PresetAffinity>): PresetAffinity {
	const row = table[preset] ?? table.balanced
	return { attack: 1, health: 1, speed: 1, crit: 1, regen: 1, scan: 1, ...row }
}

/**
 * 카드 한 장의 effects를 평탄화해서 단일 키-숫자 맵으로 만든다.
 * 호출자가 여러 카드를 합산해 누적 보너스를 만들 때 사용한다.
 */
export function flattenEffects(choice: LevelUpChoice): Partial<Record<keyof LevelUpChoice['effects'], number>> {
	const out: Partial<Record<keyof LevelUpChoice['effects'], number>> = {}
	for (const [key, value] of Object.entries(choice.effects)) {
		if (value !== undefined) out[key as keyof LevelUpChoice['effects']] = value
	}
	return out
}

/**
 * 카드 한 장의 효과를 정리해서 undefined를 제거한 단일 맵으로 돌려준다.
 * agent가 카드 보너스를 적용할 때 사용한다.
 */
export function applyCardEffects(choice: LevelUpChoice): Partial<Record<keyof LevelUpChoice['effects'], number>> {
	return flattenEffects(choice)
}

// PresetWeights에서 친화도를 도출할 때 사용하는 보조: 가중치 벡터와 카드를 1:1 매핑.
// (실제 사용은 LEVEL_UP_CONFIG.presetAffinity가 우선이며 이 헬퍼는 오버라이드 시 유용)
export function affinityFromPresetWeights(weights: PresetWeights): PresetAffinity {
	// attackWeight → attack, healthWeight → health, speedWeight → speed,
	// scanWeight → scan, regenBonus → regen. crit은 균형 가중치와 같다.
	return {
		attack: weights.attackWeight,
		health: weights.healthWeight,
		speed: weights.speedWeight,
		crit: 1,
		regen: weights.regenBonus > 0 ? 1 + weights.regenBonus * 0.5 : 1,
		scan: weights.scanWeight,
	}
}
