/**
 * 런 상태 저장/복원: localStorage에 진행 중인 게임 상태를 보관한다.
 * records.ts와 동일한 storage 주입 패턴 (테스트에서 mock Storage 사용).
 * 로드 시 엄격 검증을 수행하며, 하나라도 망가지면 null을 반환한다.
 */
import type { PlayerPresetId } from './player/agent'
import type { BuildingType } from './resources/buildings'
import type { PlanePoint } from './resources/trees'

export const RUN_SAVE_VERSION = 1

export type RunSaveBuilding = {
	type: BuildingType
	position: PlanePoint
	bearing: number
	segmentIndex: number
	builtDay: number
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
}

const RUN_SAVE_KEY = 'forest-survivor-run'

const PRESETS: readonly PlayerPresetId[] = ['aggressive', 'balanced', 'survivor']
const BUILDING_TYPES: readonly BuildingType[] = ['campfire', 'fence']

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

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value)
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
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false
	const building = value as Record<string, unknown>
	return (
		BUILDING_TYPES.includes(building.type as BuildingType)
		&& isPlanePoint(building.position)
		&& isFiniteNumber(building.bearing)
		&& isFiniteNumber(building.segmentIndex)
		&& isFiniteNumber(building.builtDay)
	)
}

/** 항상 현재 버전을 스탬프해 직렬화한다. */
export function saveRunState(
	storage: Pick<Storage, 'getItem' | 'setItem'>,
	state: Omit<RunSaveState, 'version'>,
): void {
	storage.setItem(RUN_SAVE_KEY, JSON.stringify({ ...state, version: RUN_SAVE_VERSION }))
}

/** 엄격 검증: 키 누락/JSON 손상/버전 불일치/필드 위반이 하나라도 있으면 null을 반환한다. */
export function loadRunState(storage: Pick<Storage, 'getItem'>): RunSaveState | null {
	const raw = storage.getItem(RUN_SAVE_KEY)
	if (!raw) return null
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return null
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
	const state = parsed as Record<string, unknown>
	if (state.version !== RUN_SAVE_VERSION) return null
	for (const field of NUMERIC_FIELDS) {
		if (!isFiniteNumber(state[field])) return null
	}
	if (
		(state.day as number) < 1
		|| (state.elapsedMsInDay as number) < 0
		|| (state.level as number) < 1
	) {
		return null
	}
	if (!PRESETS.includes(state.preset as PlayerPresetId)) return null
	if (!Array.isArray(state.buildings)) return null
	for (const building of state.buildings) {
		if (!isRunSaveBuilding(building)) return null
	}
	return {
		version: RUN_SAVE_VERSION,
		savedAtMs: state.savedAtMs as number,
		day: state.day as number,
		elapsedMsInDay: state.elapsedMsInDay as number,
		preset: state.preset as PlayerPresetId,
		level: state.level as number,
		exp: state.exp as number,
		health: state.health as number,
		maxHealth: state.maxHealth as number,
		attackDamage: state.attackDamage as number,
		speed: state.speed as number,
		wood: state.wood as number,
		kills: state.kills as number,
		weaponTier: state.weaponTier as number,
		buildings: state.buildings as RunSaveBuilding[],
	}
}

/** 저장된 런 상태를 제거한다. */
export function clearRunState(storage: Pick<Storage, 'removeItem'>): void {
	storage.removeItem(RUN_SAVE_KEY)
}
