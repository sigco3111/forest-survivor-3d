/**
 * 메타 진행: 런 종료 시 통계로 누적 XP를 받고, 누적 레벨이 다음 런의 시작 보너스로 전환된다.
 * localStorage 키 'forest-survivor-meta:v1'에 영구 저장되며 한 번 트랜잭션이다.
 *
 * v1 → v2 마이그레이션:
 * - v1 필드(totalXp/metaLevel/xpIntoLevel/totalRuns/unlockedSpecies)를 보존한다.
 * - v2에서 추가된 unlockedPerks(영구 해금된 meta perk ID 배열)는 빈 배열로 시작한다.
 * - 메타 레벨이 이미 perk 임계치를 넘었으면 자동으로 해당 perk를 해금해 retroactive 보너스를 받게 한다.
 */
import { META_PERK_CONFIG } from '../config'

export const META_SAVE_VERSION = 2
const META_SAVE_VERSION_V1 = 1
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

/** 영구 저장되는 메타 상태. unlockedPerks는 종족 도감과 같은 영구 해금 집합. */
export type MetaState = {
	version: number
	totalXp: number
	metaLevel: number
	xpIntoLevel: number
	totalRuns: number
	unlockedSpecies: string[]
	unlockedPerks: string[]
}

export type StartBonus = {
	extraHealth: number
	extraAttack: number
	extraWood: number
	extraCritChance: number
	extraCritMultiplier: number
	extraCollectRadiusMultiplier: number
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
		unlockedPerks: [],
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
			unlockedPerks: mergePerks(state.unlockedPerks, availablePerks(META_PERK_CONFIG, state.metaLevel)),
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
		unlockedPerks: mergePerks(state.unlockedPerks, availablePerks(META_PERK_CONFIG, metaLevel)),
	}
}

/**
 * 메타 상태에 순수 XP만 누적한다 (오프라인 지급용).
 * applyRunXp와 달리 totalRuns/unlockedSpecies를 건드리지 않는다 — 실제 런이 아니므로.
 * 레벨업 시 perk 임계치도 함께 재조정된다.
 */
export function applyRawXp(state: MetaState, xp: number): MetaState {
	if (xp <= 0) return state
	const totalXp = state.totalXp + xp
	let metaLevel = state.metaLevel
	let xpIntoLevel = state.xpIntoLevel + xp
	while (xpIntoLevel >= META_CONFIG.metaLevelXp(metaLevel + 1)) {
		xpIntoLevel -= META_CONFIG.metaLevelXp(metaLevel + 1)
		metaLevel += 1
	}
	return {
		version: META_SAVE_VERSION,
		totalXp,
		metaLevel,
		xpIntoLevel,
		totalRuns: state.totalRuns,
		unlockedSpecies: [...state.unlockedSpecies],
		unlockedPerks: mergePerks(state.unlockedPerks, availablePerks(META_PERK_CONFIG, metaLevel)),
	}
}

export type MetaPerkDefinition = {
	id: string
	unlockMetaLevel: number
	effects: {
		startHealth?: number
		startAttack?: number
		startWood?: number
		startCritChance?: number
		startCritMultiplier?: number
		startCollectRadiusMultiplier?: number
	}
	labelKey: string
}

export type MetaPerkConfig = {
	perks: MetaPerkDefinition[]
	startHealthPerLevelCap: number
	startAttackPerLevelCap: number
	startWoodPerFiveLevelsCap: number
	startCritChanceCap: number
	startCritMultiplierCap: number
	startCollectRadiusMultiplierCap: number
}

/** 메타 레벨에 따라 자동 해금된 perk ID 목록을 반환한다 (retroactive). */
export function availablePerks(config: MetaPerkConfig, metaLevel: number): string[] {
	return config.perks
		.filter(perk => perk.unlockMetaLevel <= metaLevel)
		.map(perk => perk.id)
}

/**
 * 메타 레벨을 시작 보너스로 환산한다. 영구 perk 효과도 합산한다.
 * cap/scaling으로 폭주를 방지한다.
 */
export function startBonusFor(metaLevel: number, config?: MetaPerkConfig): StartBonus {
	const cfg = META_CONFIG
	const level = Math.max(0, metaLevel)
	let extraHealth = Math.min(level * cfg.startHealthPerLevel, config?.startHealthPerLevelCap ?? Number.POSITIVE_INFINITY)
	let extraAttack = Math.min(level * cfg.startAttackPerLevel, config?.startAttackPerLevelCap ?? Number.POSITIVE_INFINITY)
	let extraWood = Math.min(
		Math.floor(level / 5) * cfg.woodPerFiveLevels,
		config?.startWoodPerFiveLevelsCap ?? Number.POSITIVE_INFINITY,
	)
	let extraCritChance = 0
	let extraCritMultiplier = 0
	let extraCollectRadiusMultiplier = 1

	if (config) {
		for (const perk of config.perks) {
			if (perk.unlockMetaLevel > level) continue
			const fx = perk.effects
			if (fx.startHealth) extraHealth += fx.startHealth
			if (fx.startAttack) extraAttack += fx.startAttack
			if (fx.startWood) extraWood += fx.startWood
			if (fx.startCritChance) extraCritChance += fx.startCritChance
			if (fx.startCritMultiplier) extraCritMultiplier += fx.startCritMultiplier
			if (fx.startCollectRadiusMultiplier) extraCollectRadiusMultiplier *= fx.startCollectRadiusMultiplier
		}
		extraHealth = Math.min(extraHealth, config.startHealthPerLevelCap)
		extraAttack = Math.min(extraAttack, config.startAttackPerLevelCap)
		extraWood = Math.min(extraWood, config.startWoodPerFiveLevelsCap)
		extraCritChance = Math.min(extraCritChance, config.startCritChanceCap)
		extraCritMultiplier = Math.min(extraCritMultiplier, config.startCritMultiplierCap)
		extraCollectRadiusMultiplier = Math.min(extraCollectRadiusMultiplier, config.startCollectRadiusMultiplierCap)
	}

	return {
		extraHealth,
		extraAttack,
		extraWood,
		extraCritChance,
		extraCritMultiplier,
		extraCollectRadiusMultiplier,
	}
}

/** 영구 해금된 perk ID와 메타 레벨에 따라 동기화된 unlockedPerks를 반환한다. */
export function reconcileUnlockedPerks(state: MetaState, config: MetaPerkConfig): MetaState {
	return {
		...state,
		unlockedPerks: mergePerks(state.unlockedPerks, availablePerks(config, state.metaLevel)),
	}
}

function mergeSpecies(existing: readonly string[], additions: readonly string[]): string[] {
	if (!additions.length) return [...existing]
	const set = new Set(existing)
	for (const species of additions) set.add(species)
	return [...set].sort()
}

function mergePerks(existing: readonly string[], additions: readonly string[]): string[] {
	if (!additions.length) return [...existing]
	const set = new Set(existing)
	for (const perk of additions) set.add(perk)
	return [...set].sort()
}

/** v1 payload를 v2 MetaState로 마이그레이션한다. */
function migrateV1ToV2(raw: Record<string, unknown>): MetaState | null {
	const requiredNumeric = ['totalXp', 'metaLevel', 'xpIntoLevel', 'totalRuns'] as const
	for (const field of requiredNumeric) {
		if (!isFiniteNumber(raw[field])) return null
		if ((raw[field] as number) < 0) return null
	}
	if (!Array.isArray(raw.unlockedSpecies)) return null
	if (!raw.unlockedSpecies.every(s => typeof s === 'string')) return null
	return {
		version: META_SAVE_VERSION,
		totalXp: raw.totalXp as number,
		metaLevel: raw.metaLevel as number,
		xpIntoLevel: raw.xpIntoLevel as number,
		totalRuns: raw.totalRuns as number,
		unlockedSpecies: [...(raw.unlockedSpecies as string[])],
		unlockedPerks: [],
	}
}

/** v2 payload를 엄격 검증해 MetaState로 파싱한다. */
function validateAndParseV2(raw: Record<string, unknown>): MetaState | null {
	const requiredNumeric = ['totalXp', 'metaLevel', 'xpIntoLevel', 'totalRuns'] as const
	for (const field of requiredNumeric) {
		if (!isFiniteNumber(raw[field])) return null
		if ((raw[field] as number) < 0) return null
	}
	if (!Array.isArray(raw.unlockedSpecies)) return null
	if (!raw.unlockedSpecies.every(s => typeof s === 'string')) return null
	if (!Array.isArray(raw.unlockedPerks)) return null
	if (!raw.unlockedPerks.every(s => typeof s === 'string')) return null
	return {
		version: META_SAVE_VERSION,
		totalXp: raw.totalXp as number,
		metaLevel: raw.metaLevel as number,
		xpIntoLevel: raw.xpIntoLevel as number,
		totalRuns: raw.totalRuns as number,
		unlockedSpecies: [...(raw.unlockedSpecies as string[])],
		unlockedPerks: [...(raw.unlockedPerks as string[])],
	}
}

/** 저장된 메타 JSON 문자열을 검증해 MetaState 또는 null을 반환한다. v1/v2 모두 지원. */
export function loadMetaState(storage: Pick<Storage, 'getItem'>): MetaState | null {
	const raw = storage.getItem(META_SAVE_KEY)
	if (!raw) return null
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return null
	}
	if (!isPlainObject(parsed)) return null
	if (parsed.version === META_SAVE_VERSION) return validateAndParseV2(parsed)
	if (parsed.version === META_SAVE_VERSION_V1) return migrateV1ToV2(parsed)
	return null
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
		unlockedPerks: state.unlockedPerks,
	}))
}

/** 메타 상태를 명시적으로 비운다 (디버그/리셋). */
export function clearMetaState(storage: Pick<Storage, 'removeItem'>): void {
	storage.removeItem(META_SAVE_KEY)
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value)
}
// META_PERK_CONFIG는 config 모듈에서 런타임으로 import한다.
