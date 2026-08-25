export type ScheduledEvent =
  | { type: 'nightRaid'; count: number }
  | { type: 'goldenTree'; woodBonus: number }

export type EventSchedulerConfig = {
  seed: number
  raidFirstDay: number
  raidIntervalDays: number
  raidBaseCount: number
  raidCountGrowthPerDay: number
  goldenTreeChance: number
  goldenTreeWoodBonus: number
}

// trees.ts와 동일한 LCG 난수원 — 호출마다 day 유도 시드로 새로 만들어 상태를 갖지 않는다.
function seededRandom(seed: number) {
	let s = seed
	return () => {
		s = (s * 16807 + 0) % 2147483647
		return (s - 1) / 2147483646
	}
}

/**
 * day별 예정 이벤트를 결정론적으로 산출하는 순수 함수.
 * - 밤습격(nightRaid): day >= raidFirstDay && day % raidIntervalDays === 0 인 날 발생.
 *   규모 count = max(1, round(raidBaseCount + (day - raidFirstDay) * raidCountGrowthPerDay)).
 * - 황금나무(goldenTree): 시드 기반 난수가 goldenTreeChance 미만이면 발생.
 * - 판정 순서 고정: 황금나무 → 밤습격 (배열 순서도 이 순서를 유지).
 */
export function eventsForDay(config: EventSchedulerConfig, day: number): ScheduledEvent[] {
	const events: ScheduledEvent[] = []
	const rand = seededRandom(config.seed + day * 104729)

	if (rand() < config.goldenTreeChance) {
		events.push({ type: 'goldenTree', woodBonus: config.goldenTreeWoodBonus })
	}

	if (day >= config.raidFirstDay && day % config.raidIntervalDays === 0) {
		const rawCount = config.raidBaseCount + (day - config.raidFirstDay) * config.raidCountGrowthPerDay
		events.push({ type: 'nightRaid', count: Math.max(1, Math.round(rawCount)) })
	}

	return events
}
