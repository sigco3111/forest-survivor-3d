export type WeatherKind = 'bloodMoon' | 'fog'

export type ScheduledEvent =
  | { type: 'nightRaid'; count: number }
  | { type: 'goldenTree'; woodBonus: number }
  | { type: 'weather'; kind: WeatherKind }

export type EventSchedulerConfig = {
  seed: number
  raidFirstDay: number
  raidIntervalDays: number
  raidBaseCount: number
  raidCountGrowthPerDay: number
  goldenTreeChance: number
  goldenTreeWoodBonus: number
  /** 기상 이변 시작일 (미설정 = 이변 없음). 티어 게이팅은 호출자(씬)가 담당한다. */
  weatherFirstDay?: number
  /** 이변 주기 일수 */
  weatherIntervalDays?: number
  /** 습격일과 겹치지 않게 어긋나는 오프셋 (기본 0) */
  weatherOffsetDays?: number
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
 * - 황금나무(goldenTree): 시드 기반 난수가 goldenTreeChance 미만이면 발생.
 * - 밤습격(nightRaid): day >= raidFirstDay && day % raidIntervalDays === 0 인 날 발생.
 *   규모 count = max(1, round(raidBaseCount + (day - raidFirstDay) * raidCountGrowthPerDay)).
 * - 기상 이변(weather): day >= weatherFirstDay && (day - offset) % intervalDays === 0 인 날.
 *   주기 순번(cycle)이 짝수면 bloodMoon, 홀수면 fog — 주기마다 종류가 번갈아 온다.
 * - 판정 순서 고정: 황금나무 → 밤습격 → 기상 이변 (배열 순서도 이 순서를 유지).
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

	if (
		config.weatherFirstDay !== undefined
		&& config.weatherIntervalDays !== undefined
		&& config.weatherIntervalDays > 0
		&& day >= config.weatherFirstDay
	) {
		const offset = config.weatherOffsetDays ?? 0
		const cycles = Math.floor((day - offset) / config.weatherIntervalDays)
		if ((day - offset) % config.weatherIntervalDays === 0 && cycles >= 0) {
			events.push({ type: 'weather', kind: cycles % 2 === 0 ? 'bloodMoon' : 'fog' })
		}
	}

	return events
}
