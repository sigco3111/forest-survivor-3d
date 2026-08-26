/**
 * 업적 시스템 순수 규칙. Vue/Three/DOM 의존이 전혀 없다.
 *
 * 측정원은 패시브 트리의 카운터(PassiveProgress)를 그대로 재활용한다 —
 * 업적은 카운터를 증가시키지 않는 읽기 전용 소비자다.
 * 트리거 문법은 패시브 노드와 동일(matchesPassiveTrigger 공유)하므로
 * "패시브 = 런 내 1회 버프 / 업적 = 영구 배지 + 메타 XP"라는 차이만 남는다.
 *
 * 보상 지급 자체는 호출자(씬 계층)가 meta-progression.unlockAchievements로 수행한다:
 * 이 모듈은 "무엇이 새로 달성됐는지"만 결정론적으로 답한다.
 */

import { matchesPassiveTrigger, type PassiveProgress, type PassiveTrigger } from './player/passive-tree'

/** 단일 업적 정의. trigger 문법은 PASSIVE_TREE_CONFIG와 같다. */
export type AchievementDefinition = {
	id: string
	trigger: PassiveTrigger
	/** 달성 시 지급되는 메타 XP (0 이상). 런 내 스탯에는 영향 없다. */
	metaXpReward: number
}

export type AchievementConfig = {
	definitions: AchievementDefinition[]
}

/**
 * 현재 진행에서 아직 달성하지 못한 업적 중 이미 임계치에 도달한 것들을 반환한다.
 * 입력(config/progress/unlocked)은 절대 변경하지 않으며, 결과는 config 정의 순서를 따른다.
 */
export function findNewAchievements(
	config: AchievementConfig,
	progress: PassiveProgress,
	unlocked: readonly string[],
): AchievementDefinition[] {
	const already = new Set(unlocked)
	return config.definitions.filter(definition => {
		if (already.has(definition.id)) return false
		return matchesPassiveTrigger(definition.trigger, progress)
	})
}

/**
 * 업적 ID 목록을 정렬·중복 없이 기존 달성 집합과 합친 새 배열을 반환한다.
 * 추가분이 비면 기존 배열의 복사본을 돌려준다.
 */
export function mergeAchievementIds(existing: readonly string[], additions: readonly string[]): string[] {
	if (!additions.length) return [...existing]
	const set = new Set(existing)
	for (const id of additions) set.add(id)
	return [...set].sort()
}
