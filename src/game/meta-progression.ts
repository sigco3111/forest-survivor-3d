/**
 * 메타 진행: 런 종료 시 통계로 누적 XP를 받고, 누적 레벨이 다음 런의 시작 보너스로 전환된다.
 * localStorage 키 'forest-survivor-meta:v1'에 영구 저장되며 한 번 트랜잭션이다.
 */

export const META_SAVE_VERSION = 1
export const META_SAVE_KEY = 'forest-survivor-meta:v1'

export const META_CONFIG = {
	/** 한 런 종료 시 통계에서 XP로 환산하는 가중치. */
	xpPerDay: 10,
	xpPerKill: 2,
	xpPerBoss: 50,
	xpPerBuilding: 5,
	xpPerGoldenTree: 10,
	/** 메타 레벨업 임계치 곡선 (level n → 누적 xp). */
	metaLevelXp: (level: number) => Math.round(200 * Math.pow(1.5, level - 1)),
	/** 메타 레벨이 다음 런에 제공하는 시작 보너스. */
	startHealthPerLevel: 5,
	startAttackPerLevel: 0.5,
	/** 매 5 메타 레벨마다 시작 나무 보너스. */
	woodPerFiveLevels: 3,
}

export type RunSummary = {
	days: number
	kills: number
	bosses: number
	buildings: number
	goldenTrees: number
}

/** 영구 저장되는 메타 상태. unlocked는 종족 도감의 영구 해금 집합. */
export type MetaState = {
	version: number
	totalXp: number
	metaLevel: number
	xpIntoLevel: number
	totalRuns: number
	unlockedSpecies: string[]
}

export type StartBonus = {
	extraHealth: number
	extraAttack: number
	extraWood: number
}

/** 빈 메타 상태 (최초 진입 또는 손상된 저장소용). */
export function emptyMetaState(): MetaState {
	return {
		version: META_SAVE_VERSION,
		totalXp: 0,
		metaLevel: 0,
		xpIntoLevel: 0,
		totalRuns: 0,
		unlockedSpecies: [],
	}
}

/** 런 통계를 메타 XP로 환산한다. 합은 음이 될 수 없다. */
export function computeRunXp(summary: RunSummary): number {
	const cfg = META_CONFIG
	return Math.max(0,
		cfg.xpPerDay * Math.max(0, summary.days)
		+ cfg.xpPerKill * Math.max(0, summary.kills)
		+ cfg.xpPerBoss * Math.max(0, summary.bosses)
		+ cfg.xpPerBuilding * Math.max(0, summary.buildings)
		+ cfg.xpPerGoldenTree * Math.max(0, summary.goldenTrees),
	)
}

/**
 * 메타 상태에 XP를 더하고 레벨업 임계치를 넘기면 자동으로 레벨업을 누적한다.
 * 부수 효과로 도감 해금(처치한 적이 있는 모든 종족)은 호출자가 unlockedSpecies에 미리 채워서 넘겨야 한다.
 */
export function applyRunXp(state: MetaState, runXp: number, unlockedSpecies: readonly string[]): MetaState {
	if (runXp <= 0) {
		// XP가 0이라도 런 카운터는 늘리고 도감은 갱신한다.
		return {
			...state,
			totalRuns: state.totalRuns + 1,
			unlockedSpecies: mergeSpecies(state.unlockedSpecies, unlockedSpecies),
		}
	}
	let totalXp = state.totalXp + runXp
	let metaLevel = state.metaLevel
	let xpIntoLevel = state.xpIntoLevel + runXp
	while (xpIntoLevel >= META_CONFIG.metaLevelXp(metaLevel + 1)) {
		xpIntoLevel -= META_CONFIG.metaLevelXp(metaLevel + 1)
		metaLevel += 1
	}
	return {
		version: META_SAVE_VERSION,
		totalXp,
		metaLevel,
		xpIntoLevel,
		totalRuns: state.totalRuns + 1,
		unlockedSpecies: mergeSpecies(state.unlockedSpecies, unlockedSpecies),
	}
}

/** 메타 레벨을 시작 보너스로 환산한다. */
export function startBonusFor(metaLevel: number): StartBonus {
	const cfg = META_CONFIG
	return {
		extraHealth: Math.max(0, metaLevel) * cfg.startHealthPerLevel,
		extraAttack: Math.max(0, metaLevel) * cfg.startAttackPerLevel,
		extraWood: Math.floor(Math.max(0, metaLevel) / 5) * cfg.woodPerFiveLevels,
	}
}

function mergeSpecies(existing: readonly string[], additions: readonly string[]): string[] {
	if (!additions.length) return [...existing]
	const set = new Set(existing)
	for (const species of additions) set.add(species)
	return [...set].sort()
}

/** 저장된 메타 JSON 문자열을 검증해 MetaState 또는 null을 반환한다. */
export function loadMetaState(storage: Pick<Storage, 'getItem'>): MetaState | null {
	const raw = storage.getItem(META_SAVE_KEY)
	if (!raw) return null
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return null
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
	const state = parsed as Record<string, unknown>
	if (state.version !== META_SAVE_VERSION) return null
	if (!isFiniteNumber(state.totalXp)) return null
	if (!isFiniteNumber(state.metaLevel)) return null
	if (!isFiniteNumber(state.xpIntoLevel)) return null
	if (!isFiniteNumber(state.totalRuns)) return null
	if (!Array.isArray(state.unlockedSpecies)) return null
	if (!state.unlockedSpecies.every(s => typeof s === 'string')) return null
	if ((state.totalXp as number) < 0 || (state.metaLevel as number) < 0) return null
	if ((state.xpIntoLevel as number) < 0 || (state.totalRuns as number) < 0) return null
	return {
		version: META_SAVE_VERSION,
		totalXp: state.totalXp as number,
		metaLevel: state.metaLevel as number,
		xpIntoLevel: state.xpIntoLevel as number,
		totalRuns: state.totalRuns as number,
		unlockedSpecies: [...(state.unlockedSpecies as string[])],
	}
}

/** 메타 상태를 영구 저장한다. */
export function saveMetaState(
	storage: Pick<Storage, 'getItem' | 'setItem'>,
	state: MetaState,
): void {
	storage.setItem(META_SAVE_KEY, JSON.stringify({
		version: META_SAVE_VERSION,
		totalXp: state.totalXp,
		metaLevel: state.metaLevel,
		xpIntoLevel: state.xpIntoLevel,
		totalRuns: state.totalRuns,
		unlockedSpecies: state.unlockedSpecies,
	}))
}

/** 메타 상태를 명시적으로 비운다 (디버그/리셋). */
export function clearMetaState(storage: Pick<Storage, 'removeItem'>): void {
	storage.removeItem(META_SAVE_KEY)
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value)
}
