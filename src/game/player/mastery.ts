import type { MonsterResource } from '../resources/monsters'

/** 누적 보너스 한 줄. 공격/스캔/치명타 등은 가산, damageTakenMultiplier는 곱셈으로 합성. */
export type MasteryBonus = {
	scanBonus: number
	critChanceBonus: number
	critMultiplierBonus: number
	attackBonus: number
	damageTakenMultiplier: number
}

/** 임계치 정의. count 도달 시 bonus를 가산한다 (damageTakenMultiplier는 곱셈). */
export type MasteryThreshold = {
	count: number
	bonus: Partial<MasteryBonus>
}

export type MasteryConfig = {
	thresholds: MasteryThreshold[]
	bossThresholds: MasteryThreshold[]
}

export type MasteryState = {
	/** 종족별 누적 처치 수 (대문자 모델명 기준). */
	speciesCounts: Map<string, number>
	/** 보스 누적 처치 수. */
	bossCount: number
	/** 누적된 보너스 스냅샷. */
	activeBonus: MasteryBonus
	/** 영구 발동된 임계치 키 집합 (중복 가산 방지). */
	triggeredKeys: Set<string>
	/** 이번 호출에서 새로 발동한 임계치 (HUD 표기용). */
	lastTriggeredKeys: string[]
}

export function emptyMasteryBonus(): MasteryBonus {
	return {
		scanBonus: 0,
		critChanceBonus: 0,
		critMultiplierBonus: 0,
		attackBonus: 0,
		damageTakenMultiplier: 1,
	}
}

export function createMasteryState(): MasteryState {
	return {
		speciesCounts: new Map(),
		bossCount: 0,
		activeBonus: emptyMasteryBonus(),
		triggeredKeys: new Set(),
		lastTriggeredKeys: [],
	}
}

/**
 * 단일 임계치를 현재 보너스에 합산한다. damageTakenMultiplier만 곱셈, 나머지는 가산.
 * 영구 트리거 집합에 키가 있으면 스킵한다 (중복 발동 방지).
 */
function applyThreshold(bonus: MasteryBonus, threshold: MasteryThreshold, triggeredKey: string, triggered: Set<string>, permanent: Set<string>): boolean {
	if (permanent.has(triggeredKey)) return false
	if (threshold.bonus.scanBonus) bonus.scanBonus += threshold.bonus.scanBonus
	if (threshold.bonus.critChanceBonus) bonus.critChanceBonus += threshold.bonus.critChanceBonus
	if (threshold.bonus.critMultiplierBonus) bonus.critMultiplierBonus += threshold.bonus.critMultiplierBonus
	if (threshold.bonus.attackBonus) bonus.attackBonus += threshold.bonus.attackBonus
	if (threshold.bonus.damageTakenMultiplier) {
		bonus.damageTakenMultiplier *= threshold.bonus.damageTakenMultiplier
	}
	triggered.add(triggeredKey)
	permanent.add(triggeredKey)
	return true
}

/**
 * 처치 한 건을 누적한다. 발동한 임계치가 있으면 lastTriggeredKeys에 키를 담아 돌려준다.
 * 보너스는 누적 반영된 새 스냅샷이다.
 */
export function recordKill(
	state: MasteryState,
	monster: MonsterResource,
	config: MasteryConfig,
): MasteryState {
	const name = monster.modelName
	const current = state.speciesCounts.get(name) ?? 0
	const next = current + 1
	const counts = new Map(state.speciesCounts)
	counts.set(name, next)

	const bonus: MasteryBonus = {
		scanBonus: state.activeBonus.scanBonus,
		critChanceBonus: state.activeBonus.critChanceBonus,
		critMultiplierBonus: state.activeBonus.critMultiplierBonus,
		attackBonus: state.activeBonus.attackBonus,
		damageTakenMultiplier: state.activeBonus.damageTakenMultiplier,
	}
	const triggered = new Set<string>()
	const permanent = new Set(state.triggeredKeys)

	if (monster.isBoss) {
		const bossCount = state.bossCount + 1
		for (const threshold of config.bossThresholds) {
			if (bossCount >= threshold.count) {
				applyThreshold(bonus, threshold, `boss:${threshold.count}`, triggered, permanent)
			}
		}
		return {
			speciesCounts: counts,
			bossCount,
			activeBonus: bonus,
			triggeredKeys: permanent,
			lastTriggeredKeys: [...triggered],
		}
	}

	for (const threshold of config.thresholds) {
		if (next >= threshold.count) {
			applyThreshold(bonus, threshold, `${name}:${threshold.count}`, triggered, permanent)
		}
	}

	return {
		speciesCounts: counts,
		bossCount: state.bossCount,
		activeBonus: bonus,
		triggeredKeys: permanent,
		lastTriggeredKeys: [...triggered],
	}
}

/** 보너스를 agent 필드에 평탄화해서 주입한다. 0인 필드는 건너뛴다. */
export type MasteryApplication = {
	critChanceBonus?: number
	critMultiplierBonus?: number
	scanRangeBonus?: number
	attackBonus?: number
	damageTakenMultiplier?: number
}

export function toApplication(bonus: MasteryBonus): MasteryApplication {
	const out: MasteryApplication = {}
	if (bonus.critChanceBonus) out.critChanceBonus = bonus.critChanceBonus
	if (bonus.critMultiplierBonus) out.critMultiplierBonus = bonus.critMultiplierBonus
	if (bonus.scanBonus) out.scanRangeBonus = bonus.scanBonus
	if (bonus.attackBonus) out.attackBonus = bonus.attackBonus
	if (bonus.damageTakenMultiplier !== 1) out.damageTakenMultiplier = bonus.damageTakenMultiplier
	return out
}
