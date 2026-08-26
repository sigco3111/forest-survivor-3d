/**
 * 범용 패시브 트리: 레벨이 아닌 진행 이벤트(처치, 보스 처치, 카드 선택, 일차) 기반으로
 * 한 번만 자동 해금되는 노드 모음. 같은 효과는 한 번만 누적된다 (중복 발동 방지).
 *
 * 모듈은 순수 함수로만 구성되며 Vue/Three/DOM/performance.now을 import 하지 않는다.
 */

import {
	applySkillNodeEffects,
	type SkillNodeEffects,
	type SkillNodeEffectsTarget,
} from './skill-tree'

export type PassiveTrigger = {
	/** 이 트리거는 플레이어 레벨이 임계치에 도달하면 발동한다. */
	level?: number
	/** 이 트리거는 누적 총 처치 수가 임계치에 도달하면 발동한다. */
	totalKills?: number
	/** 이 트리거는 특정 종족 누적 처치 수가 임계치에 도달하면 발동한다. */
	speciesKills?: { name: string; count: number }
	/** 이 트리거는 누적 보스 처치 수가 임계치에 도달하면 발동한다. */
	bossKills?: number
	/** 이 트리거는 누적 레벨업 카드 선택 수가 임계치에 도달하면 발동한다. */
	cardChoiceCount?: number
	/** 이 트리거는 누적 도달 일차가 임계치에 도달하면 발동한다. */
	dayReached?: number
}

export type PassiveNode = {
	id: string
	trigger: PassiveTrigger
	effects: SkillNodeEffects
	/** HUD/i18n 표시용 키 (ko/en/zh-CN에 동명 키가 존재해야 함). */
	labelKey: string
}

export type PassiveTreeConfig = {
	nodes: PassiveNode[]
}

/** 패시브 트리의 누적 진행 상태. */
export type PassiveProgress = {
	level: number
	totalKills: number
	speciesKills: Record<string, number>
	bossKills: number
	cardChoiceCount: number
	dayReached: number
}

export type PassiveTreeState = {
	unlockedIds: string[]
	/** 이번 호출(recordXxx) 중 새로 해금된 노드 ID. HUD 표기 후 비운다. */
	pendingUnlocks: string[]
	progress: PassiveProgress
}

/** 빈 진행 상태를 만든다. */
export function emptyPassiveProgress(): PassiveProgress {
	return {
		level: 0,
		totalKills: 0,
		speciesKills: {},
		bossKills: 0,
		cardChoiceCount: 0,
		dayReached: 0,
	}
}

/** 빈 패시브 트리 상태. */
export function createPassiveTreeState(): PassiveTreeState {
	return {
		unlockedIds: [],
		pendingUnlocks: [],
		progress: emptyPassiveProgress(),
	}
}

/**
 * 단일 트리거가 현재 진행을 만족하는지 검사한다.
 * 업적 시스템(game/achievements)도 같은 문법의 트리거를 평가하므로 공개해 재사용한다.
 * 모든 조건은 "카운터 ≥ 임계치"이며, 하나라도 못 미치면 false.
 */
export function matchesPassiveTrigger(trigger: PassiveTrigger, progress: PassiveProgress): boolean {
	if (trigger.level !== undefined && progress.level < trigger.level) return false
	if (trigger.totalKills !== undefined && progress.totalKills < trigger.totalKills) return false
	if (trigger.bossKills !== undefined && progress.bossKills < trigger.bossKills) return false
	if (trigger.cardChoiceCount !== undefined && progress.cardChoiceCount < trigger.cardChoiceCount) return false
	if (trigger.dayReached !== undefined && progress.dayReached < trigger.dayReached) return false
	if (trigger.speciesKills !== undefined) {
		const count = progress.speciesKills[trigger.speciesKills.name] ?? 0
		if (count < trigger.speciesKills.count) return false
	}
	return true
}

/**
 * 현재 진행(progress)을 기준으로 새 해금 대상 노드들을 반환한다.
 * 이미 해금된 ID는 제외하며, 결과는 입력의 unlockedIds를 변경하지 않는다.
 */
export function findPassiveUnlocks(
	config: PassiveTreeConfig,
	state: PassiveTreeState,
): PassiveNode[] {
	const already = new Set(state.unlockedIds)
	return config.nodes.filter(node => {
		if (already.has(node.id)) return false
		return matchesPassiveTrigger(node.trigger, state.progress)
	})
}

/** 트리거가 만족된 노드를 agent에 적용하고, state를 불변 갱신해 돌려준다. */
export function applyPassiveUnlock(
	state: PassiveTreeState,
	node: PassiveNode,
): PassiveTreeState {
	const unlockedIds = state.unlockedIds.includes(node.id)
		? state.unlockedIds
		: [...state.unlockedIds, node.id]
	return {
		...state,
		unlockedIds,
	}
}

/** 새 노드를 agent의 effects 타겟에 적용한다 (skill-tree의 효과를 재사용). */
export function applyPassiveNodeEffects(target: SkillNodeEffectsTarget, node: PassiveNode): void {
	applySkillNodeEffects(target, node)
}

function withProgress(state: PassiveTreeState, next: PassiveProgress): PassiveTreeState {
	return { ...state, progress: next }
}

/**
 * 처치 이벤트를 누적하고 트리거가 발동한 노드를 agent에 적용한다.
 * 호출자는 unlockedIds를 추적하지 않아도 되며, 같은 ID는 절대 중복 적용되지 않는다.
 *
 * @returns 갱신된 state와 이번 호출에서 새로 적용된 노드 ID 목록
 */
export function recordPassiveKill(
	state: PassiveTreeState,
	config: PassiveTreeConfig,
	speciesName: string,
	isBoss: boolean,
	target: SkillNodeEffectsTarget,
): { state: PassiveTreeState; newUnlocks: string[] } {
	const nextProgress: PassiveProgress = {
		...state.progress,
		totalKills: state.progress.totalKills + 1,
		speciesKills: {
			...state.progress.speciesKills,
			[speciesName]: (state.progress.speciesKills[speciesName] ?? 0) + 1,
		},
		bossKills: state.progress.bossKills + (isBoss ? 1 : 0),
	}
	return evaluateAndApply(withProgress(state, nextProgress), config, target)
}

/**
 * 도달한 플레이어 레벨을 누적하고 트리거를 평가한다.
 */
export function recordPassiveLevelReached(
	state: PassiveTreeState,
	config: PassiveTreeConfig,
	level: number,
	target: SkillNodeEffectsTarget,
): { state: PassiveTreeState; newUnlocks: string[] } {
	const nextProgress: PassiveProgress = {
		...state.progress,
		level: Math.max(state.progress.level, level),
	}
	return evaluateAndApply(withProgress(state, nextProgress), config, target)
}

/**
 * 레벨업 카드 선택 이벤트를 누적하고 트리거를 평가한다.
 */
export function recordPassiveCardChoice(
	state: PassiveTreeState,
	config: PassiveTreeConfig,
	target: SkillNodeEffectsTarget,
): { state: PassiveTreeState; newUnlocks: string[] } {
	const nextProgress: PassiveProgress = {
		...state.progress,
		cardChoiceCount: state.progress.cardChoiceCount + 1,
	}
	return evaluateAndApply(withProgress(state, nextProgress), config, target)
}

/**
 * 도달 일차 이벤트를 누적하고 트리거를 평가한다.
 */
export function recordPassiveDayReached(
	state: PassiveTreeState,
	config: PassiveTreeConfig,
	day: number,
	target: SkillNodeEffectsTarget,
): { state: PassiveTreeState; newUnlocks: string[] } {
	const nextDay = Math.max(state.progress.dayReached, day)
	const nextProgress: PassiveProgress = {
		...state.progress,
		dayReached: nextDay,
	}
	return evaluateAndApply(withProgress(state, nextProgress), config, target)
}

function evaluateAndApply(
	state: PassiveTreeState,
	config: PassiveTreeConfig,
	target: SkillNodeEffectsTarget,
): { state: PassiveTreeState; newUnlocks: string[] } {
	const candidates = findPassiveUnlocks(config, state)
	if (candidates.length === 0) return { state, newUnlocks: [] }
	let next = state
	const newUnlocks: string[] = []
	for (const node of candidates) {
		next = applyPassiveUnlock(next, node)
		applyPassiveNodeEffects(target, node)
		newUnlocks.push(node.id)
	}
	const pendingUnlocks = [...next.pendingUnlocks, ...newUnlocks]
	return { state: { ...next, pendingUnlocks }, newUnlocks }
}
