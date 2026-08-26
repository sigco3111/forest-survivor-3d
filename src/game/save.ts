/**
 * 런 상태 저장/복원: localStorage에 진행 중인 게임 상태를 보관한다.
 * records.ts와 동일한 storage 주입 패턴 (테스트에서 mock Storage 사용).
 *
 * v1 → v2 마이그레이션을 지원한다:
 * - v1 필드(day/elapsed/preset/level/exp/health/maxHealth/attackDamage/speed/wood/kills/weaponTier/buildings)를 보존한다.
 * - v2에서 추가된 필드(critChance, critMultiplier, damageTakenMultiplier, dodgeChance, bonusFlatDamage,
 *   slamCooldownMultiplier, furyDurationMultiplier, extraRegenBonus, extraScanRangePerLevel,
 *   collectRadiusMultiplier, scanRangeMultiplier, suppressFlee, 쿨다운 상태, 패시브 트리 진행)는
 *   명시적인 기본값으로 채워서 반환한다.
 * - v2 입력은 숫자/배열/객체/불리언을 엄격 검증하고, 범위가 비정상이면 sanitize하거나 reject한다.
 */
import type { PlayerPresetId } from './player/agent'
import { DAY_CYCLE_CONFIG, PLAYER_CONFIG, WEAPON_CONFIG } from '../config'
import type { MasteryBonus } from './player/mastery'
import type { BuildingType } from './resources/buildings'
import type { PlanePoint } from './resources/trees'

export const RUN_SAVE_VERSION = 2
const RUN_SAVE_VERSION_V1 = 1

export type RunSaveBuilding = {
	type: BuildingType
	position: PlanePoint
	bearing: number
	segmentIndex: number
	builtDay: number
}

export type RunSaveMastery = {
	speciesCounts: Record<string, number>
	bossCount: number
	triggeredKeys: string[]
	activeBonus: MasteryBonus
}

export type RunSaveState = {
	version: number
	savedAtMs: number
	day: number
	elapsedMsInDay: number
	preset: PlayerPresetId
	level: number
	exp: number
	health: number
	maxHealth: number
	attackDamage: number
	speed: number
	wood: number
	kills: number
	weaponTier: number
	buildings: RunSaveBuilding[]
	// v2 신규: 스킬트리/숙련도로 누적된 런 진행 필드
	critChance: number
	critMultiplier: number
	damageTakenMultiplier: number
	dodgeChance: number
	bonusFlatDamage: number
	slamCooldownMultiplier: number
	furyDurationMultiplier: number
	extraRegenBonus: number
	extraScanRangePerLevel: number
	collectRadiusMultiplier: number
	scanRangeMultiplier: number
	suppressFlee: boolean
	// v2 신규: 쿨다운/지속/회복 타이머
	lastSlamAt: number
	lastFuryAt: number
	furyActiveUntil: number
	regenTimer: number
	// v2 신규: 런 숙련도 진행 (종족별 보너스의 중복 적용 방지)
	mastery: RunSaveMastery
	// v2 신규: 패시브 트리 진행
	unlockedSkillNodes: string[]
	unlockedPassiveNodeIds: string[]
	speciesKills: Record<string, number>
	bossKills: number
	cardChoiceCount: number
	dayReached: number
	levelReached: number
	// v2 신규: 플레이어 월드 좌표와 게임 시간 기준
	position: PlanePoint
	gameNowMs: number
}

export type RunSaveInput = Omit<RunSaveState, 'version'>
	& Partial<Pick<RunSaveState,
		| 'critChance'
		| 'critMultiplier'
		| 'damageTakenMultiplier'
		| 'dodgeChance'
		| 'bonusFlatDamage'
		| 'slamCooldownMultiplier'
		| 'furyDurationMultiplier'
		| 'extraRegenBonus'
		| 'extraScanRangePerLevel'
		| 'collectRadiusMultiplier'
		| 'scanRangeMultiplier'
		| 'suppressFlee'
		| 'lastSlamAt'
		| 'lastFuryAt'
		| 'furyActiveUntil'
		| 'regenTimer'
		| 'mastery'
		| 'unlockedSkillNodes'
		| 'unlockedPassiveNodeIds'
		| 'speciesKills'
		| 'bossKills'
		| 'cardChoiceCount'
		| 'dayReached'
		| 'levelReached'
		| 'position'
		| 'gameNowMs'
	>>

export const RUN_SAVE_KEY = 'forest-survivor-run'

const V2_DEFAULT_STATE: Partial<Omit<RunSaveState, 'version'>> = {
	critChance: 0,
	critMultiplier: 1.5,
	damageTakenMultiplier: 1,
	dodgeChance: 0,
	bonusFlatDamage: 0,
	slamCooldownMultiplier: 1,
	furyDurationMultiplier: 1,
	extraRegenBonus: 0,
	extraScanRangePerLevel: 0,
	collectRadiusMultiplier: 1,
	scanRangeMultiplier: 1,
	suppressFlee: false,
	lastSlamAt: 0,
	lastFuryAt: 0,
	furyActiveUntil: 0,
	regenTimer: 0,
	unlockedSkillNodes: [],
	unlockedPassiveNodeIds: [],
	mastery: {
		speciesCounts: {},
		bossCount: 0,
		triggeredKeys: [],
		activeBonus: {
			scanBonus: 0,
			critChanceBonus: 0,
			critMultiplierBonus: 0,
			attackBonus: 0,
			damageTakenMultiplier: 1,
		},
	},
	speciesKills: {},
	bossKills: 0,
	cardChoiceCount: 0,
	dayReached: 1,
	levelReached: 1,
	position: [0, 0],
	gameNowMs: 0,
}

const PRESETS: readonly PlayerPresetId[] = ['aggressive', 'balanced', 'survivor']
const BUILDING_TYPES: readonly BuildingType[] = ['campfire', 'fence']

/** v1/v2 공통: 모든 숫자 필드. 누락 시 reject. */
const NUMERIC_FIELDS = [
	'savedAtMs',
	'day',
	'elapsedMsInDay',
	'level',
	'exp',
	'health',
	'maxHealth',
	'attackDamage',
	'speed',
	'wood',
	'kills',
	'weaponTier',
] as const

/** v2에서 추가된 누적 필드. */
const V2_NUMERIC_FIELDS = [
	'critChance',
	'critMultiplier',
	'damageTakenMultiplier',
	'dodgeChance',
	'bonusFlatDamage',
	'slamCooldownMultiplier',
	'furyDurationMultiplier',
	'extraRegenBonus',
	'extraScanRangePerLevel',
	'collectRadiusMultiplier',
	'scanRangeMultiplier',
	'lastSlamAt',
	'lastFuryAt',
	'furyActiveUntil',
	'regenTimer',
	'bossKills',
	'cardChoiceCount',
	'dayReached',
	'levelReached',
	'gameNowMs',
] as const

/** 안전한 범위 클램프 + sanitize 한계. */
const RANGE_LIMITS = {
	critChance: [0, PLAYER_CONFIG.critChanceCeiling] as const,
	critMultiplier: [1, PLAYER_CONFIG.critMultiplierCeiling] as const,
	damageTakenMultiplier: [PLAYER_CONFIG.damageTakenFloor, 2] as const,
	dodgeChance: [0, PLAYER_CONFIG.dodgeChanceCeiling] as const,
	bonusFlatDamage: [0, 1_000] as const,
	slamCooldownMultiplier: [0.1, 10] as const,
	furyDurationMultiplier: [0.1, 10] as const,
	extraRegenBonus: [0, 100] as const,
	extraScanRangePerLevel: [0, 10_000] as const,
	collectRadiusMultiplier: [0.1, 10] as const,
	scanRangeMultiplier: [0.1, 10] as const,
	lastSlamAt: [-1_000_000_000, 1_000_000_000] as const,
	lastFuryAt: [-1_000_000_000, 1_000_000_000] as const,
	furyActiveUntil: [-1_000_000_000, 1_000_000_000] as const,
	regenTimer: [0, 1_000_000_000] as const,
	bossKills: [0, 1_000_000] as const,
	cardChoiceCount: [0, 1_000_000] as const,
	dayReached: [1, 1_000_000] as const,
	levelReached: [1, 1_000_000] as const,
	gameNowMs: [-1_000_000_000, 1_000_000_000] as const,
	weaponTier: [0, WEAPON_CONFIG.maxTier] as const,
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isPlanePoint(value: unknown): value is PlanePoint {
	return (
		Array.isArray(value)
		&& value.length === 2
		&& isFiniteNumber(value[0])
		&& isFiniteNumber(value[1])
	)
}

function isRunSaveBuilding(value: unknown): value is RunSaveBuilding {
	if (!isPlainObject(value)) return false
	return (
		BUILDING_TYPES.includes(value.type as BuildingType)
		&& isPlanePoint(value.position)
		&& isFiniteNumber(value.bearing)
		&& isFiniteNumber(value.segmentIndex)
		&& isFiniteNumber(value.builtDay)
	)
}

function normalizeMastery(value: unknown): RunSaveMastery | null {
	if (!isPlainObject(value)) return null
	if (!isPlainObject(value.speciesCounts)) return null
	const speciesCounts: Record<string, number> = {}
	for (const [name, count] of Object.entries(value.speciesCounts)) {
		if (!isFiniteNumber(count) || count < 0) return null
		speciesCounts[name] = count
	}
	const bossCount = value.bossCount
	if (!isFiniteNumber(bossCount) || bossCount < 0) return null
	if (!Array.isArray(value.triggeredKeys) || !value.triggeredKeys.every(key => typeof key === 'string')) return null
	if (!isPlainObject(value.activeBonus)) return null
	const activeBonus = value.activeBonus
	if (
		!isFiniteNumber(activeBonus.scanBonus)
		|| !isFiniteNumber(activeBonus.critChanceBonus)
		|| !isFiniteNumber(activeBonus.critMultiplierBonus)
		|| !isFiniteNumber(activeBonus.attackBonus)
		|| !isFiniteNumber(activeBonus.damageTakenMultiplier)
	) return null
	return {
		speciesCounts,
		bossCount,
		triggeredKeys: [...value.triggeredKeys as string[]],
		activeBonus: {
			scanBonus: activeBonus.scanBonus as number,
			critChanceBonus: activeBonus.critChanceBonus as number,
			critMultiplierBonus: activeBonus.critMultiplierBonus as number,
			attackBonus: activeBonus.attackBonus as number,
			damageTakenMultiplier: Math.max(PLAYER_CONFIG.damageTakenFloor, activeBonus.damageTakenMultiplier as number),
		},
	}
}

function clamp(value: number, range: readonly [number, number]): number {
	if (value < range[0]) return range[0]
	if (value > range[1]) return range[1]
	return value
}

function sanitizeNumeric(value: number, range: readonly [number, number]): number {
	// 호출자가 이미 isFiniteNumber를 확인했다고 가정한다.
	return clamp(value, range)
}

type NormalizedCoreState = {
	health: number
	maxHealth: number
	elapsedMsInDay: number
	wood: number
	kills: number
}

function normalizeCoreState(raw: Record<string, unknown>): NormalizedCoreState | null {
	const health = raw.health as number
	const maxHealth = raw.maxHealth as number
	const elapsedMsInDay = raw.elapsedMsInDay as number
	const wood = raw.wood as number
	const kills = raw.kills as number
	if (maxHealth <= 0 || health < 0 || wood < 0 || kills < 0) return null
	return {
		health: Math.min(health, maxHealth),
		maxHealth,
		elapsedMsInDay: Math.min(elapsedMsInDay, DAY_CYCLE_CONFIG.realMsPerDay),
		wood: Math.max(0, wood),
		kills: Math.max(0, kills),
	}
}

/**
 * v1 → v2 마이그레이션. v1의 필드를 보존하고 v2 신규 필드는 명시적 기본값으로 채운다.
 * 잘못된 v1 필드(누락된 숫자, 알 수 없는 프리셋, 손상된 빌딩 배열)는 null을 반환한다.
 */
function migrateV1ToV2(raw: Record<string, unknown>): RunSaveState | null {
	for (const field of NUMERIC_FIELDS) {
		if (!isFiniteNumber(raw[field])) return null
	}
	if (!PRESETS.includes(raw.preset as PlayerPresetId)) return null
	if (!Array.isArray(raw.buildings)) return null
	for (const building of raw.buildings) {
		if (!isRunSaveBuilding(building)) return null
	}
	const day = raw.day as number
	const elapsed = raw.elapsedMsInDay as number
	const level = raw.level as number
	if (day < 1 || elapsed < 0 || level < 1) return null
	const speed = raw.speed as number
	const attackDamage = raw.attackDamage as number
	const exp = raw.exp as number
	const rawWeaponTier = raw.weaponTier as number
	const weaponTier = Math.max(0, Math.min(rawWeaponTier, RANGE_LIMITS.weaponTier[1]))
	const savedAtMs = raw.savedAtMs as number
	const buildings = raw.buildings as RunSaveBuilding[]
	const normalized = normalizeCoreState(raw)
	if (!normalized) return null
	const gameNowMs = (day - 1) * DAY_CYCLE_CONFIG.realMsPerDay + normalized.elapsedMsInDay

	return {
		version: RUN_SAVE_VERSION,
		savedAtMs,
		day,
		elapsedMsInDay: normalized.elapsedMsInDay,
		preset: raw.preset as PlayerPresetId,
		level,
		exp,
		health: normalized.health,
		maxHealth: normalized.maxHealth,
		attackDamage,
		speed,
		wood: normalized.wood,
		kills: normalized.kills,
		weaponTier,
		buildings,
		critChance: 0,
		critMultiplier: 1.5,
		damageTakenMultiplier: 1,
		dodgeChance: 0,
		bonusFlatDamage: 0,
		slamCooldownMultiplier: 1,
		furyDurationMultiplier: 1,
		extraRegenBonus: 0,
		extraScanRangePerLevel: 0,
		collectRadiusMultiplier: 1,
		scanRangeMultiplier: 1,
		suppressFlee: false,
		lastSlamAt: 0,
		lastFuryAt: 0,
		furyActiveUntil: 0,
		regenTimer: 0,
		unlockedSkillNodes: [],
		unlockedPassiveNodeIds: [],
		mastery: {
			speciesCounts: {},
			bossCount: 0,
			triggeredKeys: [],
			activeBonus: {
				scanBonus: 0,
				critChanceBonus: 0,
				critMultiplierBonus: 0,
				attackBonus: 0,
				damageTakenMultiplier: 1,
			},
		},
		speciesKills: {},
		bossKills: 0,
		cardChoiceCount: 0,
		dayReached: day,
		levelReached: level,
		position: [0, 0],
		gameNowMs,
	}
}

/**
 * v2 입력 검증/정제. 손상된 필드가 있으면 가능한 한 sanitize하고,
 * 복구가 불가능한 핵심 필드(숫자 필드 누락/잘못된 빌딩)는 null을 반환한다.
 */
function validateAndParseV2(raw: Record<string, unknown>): RunSaveState | null {
	for (const field of NUMERIC_FIELDS) {
		if (!isFiniteNumber(raw[field])) return null
	}
	const day = raw.day as number
	const elapsed = raw.elapsedMsInDay as number
	const level = raw.level as number
	if (day < 1 || elapsed < 0 || level < 1) return null

	const weaponTierRaw = raw.weaponTier as number
	const weaponTier = Math.max(0, Math.min(weaponTierRaw, RANGE_LIMITS.weaponTier[1]))
	const normalized = normalizeCoreState(raw)
	if (!normalized) return null

	if (!PRESETS.includes(raw.preset as PlayerPresetId)) return null
	if (!Array.isArray(raw.buildings)) return null
	for (const building of raw.buildings) {
		if (!isRunSaveBuilding(building)) return null
	}

	// v2 신규 숫자 필드: 손상이 있으면 null로 reject
	for (const field of V2_NUMERIC_FIELDS) {
		if (!isFiniteNumber(raw[field])) return null
	}
	// 진행 일차와 도달 레벨은 1 이상이어야 의미가 있다.
	if ((raw.dayReached as number) < 1 || (raw.levelReached as number) < 1) return null
	const sanitized: Record<string, number> = {}
	for (const field of V2_NUMERIC_FIELDS) {
		const range = (RANGE_LIMITS as Record<string, readonly [number, number]>)[field]
		sanitized[field] = sanitizeNumeric(raw[field] as number, range)
	}

	if (typeof raw.suppressFlee !== 'boolean') return null
	if (!Array.isArray(raw.unlockedSkillNodes)) return null
	const unlockedSkillNodes: string[] = []
	for (const id of raw.unlockedSkillNodes as unknown[]) {
		if (typeof id !== 'string') return null
		unlockedSkillNodes.push(id)
	}
	if (!Array.isArray(raw.unlockedPassiveNodeIds)) return null
	const unlockedPassiveNodeIds: string[] = []
	for (const id of raw.unlockedPassiveNodeIds as unknown[]) {
		if (typeof id !== 'string') return null
		unlockedPassiveNodeIds.push(id)
	}
	if (!isPlainObject(raw.speciesKills)) return null
	const speciesKills: Record<string, number> = {}
	for (const [name, count] of Object.entries(raw.speciesKills)) {
		if (!isFiniteNumber(count)) return null
		if (count < 0 || count > 1_000_000) return null
		speciesKills[name] = count
	}
	const mastery = normalizeMastery(raw.mastery)
	if (!mastery || !isPlanePoint(raw.position)) return null

	return {
		version: RUN_SAVE_VERSION,
		savedAtMs: raw.savedAtMs as number,
		day,
		elapsedMsInDay: normalized.elapsedMsInDay,
		preset: raw.preset as PlayerPresetId,
		level,
		exp: raw.exp as number,
		health: normalized.health,
		maxHealth: normalized.maxHealth,
		attackDamage: raw.attackDamage as number,
		speed: raw.speed as number,
		wood: normalized.wood,
		kills: normalized.kills,
		weaponTier,
		buildings: raw.buildings as RunSaveBuilding[],
		critChance: sanitized.critChance,
		critMultiplier: sanitized.critMultiplier,
		damageTakenMultiplier: sanitized.damageTakenMultiplier,
		dodgeChance: sanitized.dodgeChance,
		bonusFlatDamage: sanitized.bonusFlatDamage,
		slamCooldownMultiplier: sanitized.slamCooldownMultiplier,
		furyDurationMultiplier: sanitized.furyDurationMultiplier,
		extraRegenBonus: sanitized.extraRegenBonus,
		extraScanRangePerLevel: sanitized.extraScanRangePerLevel,
		collectRadiusMultiplier: sanitized.collectRadiusMultiplier,
		scanRangeMultiplier: sanitized.scanRangeMultiplier,
		suppressFlee: raw.suppressFlee as boolean,
		lastSlamAt: sanitized.lastSlamAt,
		lastFuryAt: sanitized.lastFuryAt,
		furyActiveUntil: sanitized.furyActiveUntil,
		regenTimer: sanitized.regenTimer,
		mastery,
		unlockedSkillNodes,
		unlockedPassiveNodeIds,
		speciesKills,
		bossKills: sanitized.bossKills,
		cardChoiceCount: sanitized.cardChoiceCount,
		dayReached: sanitized.dayReached,
		levelReached: sanitized.levelReached,
		position: [raw.position[0] as number, raw.position[1] as number],
		gameNowMs: sanitized.gameNowMs,
	}
}

/** 항상 현재 버전(v2)을 스탬프해 직렬화한다. */
export function saveRunState(
	storage: Pick<Storage, 'getItem' | 'setItem'>,
	state: RunSaveInput,
): void {
	storage.setItem(RUN_SAVE_KEY, JSON.stringify({ ...V2_DEFAULT_STATE, ...state, version: RUN_SAVE_VERSION }))
}

/**
 * 저장된 런 상태를 로드한다. v1 → v2 마이그레이션, 손상 검증을 모두 처리한다.
 * - 알 수 없는 버전, 손상된 JSON, 누락된 핵심 필드, 잘못된 빌딩 → null
 */
export function loadRunState(storage: Pick<Storage, 'getItem'>): RunSaveState | null {
	const raw = storage.getItem(RUN_SAVE_KEY)
	if (!raw) return null
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return null
	}
	if (!isPlainObject(parsed)) return null
	if (parsed.version === RUN_SAVE_VERSION) return validateAndParseV2(parsed)
	if (parsed.version === RUN_SAVE_VERSION_V1) return migrateV1ToV2(parsed)
	return null
}

/** 저장된 런 상태를 제거한다. */
export function clearRunState(storage: Pick<Storage, 'removeItem'>): void {
	storage.removeItem(RUN_SAVE_KEY)
}
