/**
 * 스킬트리: 레벨이 임계치를 넘는 순간 해당 노드가 자동 해금되어 누적 효과를 받는다.
 * 노드 효과는 카디널리티 1로, 한 번만 적용된다 (중복 누적 방지).
 */

export type SkillBranchId = 'attack' | 'defense' | 'utility'

export type SkillNodeEffects = {
	/** 슬램 쿨다운 배율 (기본 1, 낮을수록 자주 시전). */
	slamCooldownMultiplier?: number
	/** 분노 지속 시간 배율 (기본 1). */
	furyDurationMultiplier?: number
	/** 매 스윙에 가산되는 고정 피해. */
	bonusFlatDamage?: number
	/** 피격 시 무효 확률 (0..1). */
	dodgeChance?: number
	/** 받는 피해 곱셈 (1 미만이면 감소). */
	damageTakenMultiplier?: number
	/** 비전투 회복 보너스 가산. */
	extraRegenBonus?: number
	/** 수집 반경 곱셈 (1.5 = 1.5배). */
	collectRadiusMultiplier?: number
	/** 스캔 범위 곱셈. */
	scanRangeMultiplier?: number
	/** 위기 체력 도주 억제 플래그. */
	suppressFlee?: boolean
}

export type SkillNode = {
	id: string
	unlockLevel: number
	effects: SkillNodeEffects
}

export type SkillBranch = {
	label: SkillBranchId
	nodes: SkillNode[]
}

export type SkillTreeConfig = {
	branches: Record<SkillBranchId, SkillBranch>
}

/**
 * prevLevel → currentLevel 구간에서 새로 해금된 노드들을 반환한다.
 * 트리는 branches별로 평탄화하여 검사한다.
 */
export function findNewUnlocks(
	config: SkillTreeConfig,
	prevLevel: number,
	currentLevel: number,
	alreadyUnlocked: readonly string[],
): SkillNode[] {
	if (currentLevel <= prevLevel) return []
	const already = new Set(alreadyUnlocked)
	const newNodes: SkillNode[] = []
	const allNodes: SkillNode[] = []
	for (const branch of Object.values(config.branches)) {
		allNodes.push(...branch.nodes)
	}
	// 안정성을 위해 unlockLevel 오름차순 정렬 후 검사.
	allNodes.sort((a, b) => a.unlockLevel - b.unlockLevel)
	for (const node of allNodes) {
		if (already.has(node.id)) continue
		if (prevLevel < node.unlockLevel && node.unlockLevel <= currentLevel) {
			newNodes.push(node)
		}
	}
	return newNodes
}

/** 노드의 effects를 agent 필드에 평탄화해서 적용한다. 0이거나 falsy인 값은 건너뛴다. */
export function applySkillNodeEffects(agent: SkillNodeEffectsTarget, node: SkillNode): void {
	const effects = node.effects
	if (effects.slamCooldownMultiplier !== undefined) {
		agent.slamCooldownMultiplier *= effects.slamCooldownMultiplier
	}
	if (effects.furyDurationMultiplier !== undefined) {
		agent.furyDurationMultiplier *= effects.furyDurationMultiplier
	}
	if (effects.bonusFlatDamage !== undefined) {
		agent.bonusFlatDamage += effects.bonusFlatDamage
	}
	if (effects.dodgeChance !== undefined) {
		agent.dodgeChance = Math.min(1, agent.dodgeChance + effects.dodgeChance)
	}
	if (effects.damageTakenMultiplier !== undefined) {
		agent.damageTakenMultiplier *= effects.damageTakenMultiplier
	}
	if (effects.extraRegenBonus !== undefined) {
		agent.extraRegenBonus += effects.extraRegenBonus
	}
	if (effects.collectRadiusMultiplier !== undefined) {
		agent.collectRadiusMultiplier *= effects.collectRadiusMultiplier
	}
	if (effects.scanRangeMultiplier !== undefined) {
		agent.scanRangeMultiplier *= effects.scanRangeMultiplier
	}
	if (effects.suppressFlee !== undefined) {
		agent.suppressFlee = agent.suppressFlee || effects.suppressFlee
	}
}

/** agent.ts에서 본 effects 적용 대상의 최소 인터페이스 (테스트용). */
export type SkillNodeEffectsTarget = {
	slamCooldownMultiplier: number
	furyDurationMultiplier: number
	bonusFlatDamage: number
	dodgeChance: number
	damageTakenMultiplier: number
	extraRegenBonus: number
	collectRadiusMultiplier: number
	scanRangeMultiplier: number
	suppressFlee: boolean
}
