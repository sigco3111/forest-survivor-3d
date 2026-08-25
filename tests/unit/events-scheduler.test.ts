import { describe, expect, it } from 'vitest'

import {
  eventsForDay,
  type EventSchedulerConfig,
} from '../../src/game/events/scheduler'

function makeConfig(overrides: Partial<EventSchedulerConfig> = {}): EventSchedulerConfig {
  return {
    seed: 1234,
    raidFirstDay: 5,
    raidIntervalDays: 5,
    raidBaseCount: 3,
    raidCountGrowthPerDay: 0.4,
    goldenTreeChance: 0,
    goldenTreeWoodBonus: 50,
    ...overrides,
  }
}

describe('eventsForDay', () => {
  it('같은 설정과 day를 넣으면 항상 동일한 배열을 반환한다', () => {
    const config = makeConfig({ goldenTreeChance: 1 })

    expect(eventsForDay(config, 5)).toEqual(eventsForDay(config, 5))
    // 빈 배열이어도 결정론적이다 (day 6은 습격 날이 아님)
    expect(eventsForDay(config, 5).length).toBeGreaterThan(0)
    expect(eventsForDay(makeConfig(), 6)).toEqual(eventsForDay(makeConfig(), 6))
  })

  it('습격 일정: 첫 습격일과 배수일에만 발생한다', () => {
    const config = makeConfig() // raidFirstDay 5, interval 5, chance 0

    const dayFive = eventsForDay(config, 5)
    expect(dayFive).toHaveLength(1)
    expect(dayFive[0]).toEqual({ type: 'nightRaid', count: 3 })

    const dayTen = eventsForDay(config, 10)
    expect(dayTen).toHaveLength(1)
    expect(dayTen[0]).toEqual({ type: 'nightRaid', count: 5 })

    expect(eventsForDay(config, 4)).toEqual([]) // 첫 습격일 이전
    expect(eventsForDay(config, 1)).toEqual([])
    expect(eventsForDay(config, 6)).toEqual([]) // 첫 습격일은 지났지만 배수일이 아님
  })

  it('습격 규모는 기본 수 + 경과일 × 성장률이며 최소 1로 고정된다', () => {
    const config = makeConfig() // base 3, growth 0.4

    // round(3 + (5-5)*0.4) = 3
    expect(eventsForDay(config, 5)[0]).toMatchObject({ type: 'nightRaid', count: 3 })
    // round(3 + (15-5)*0.4) = round(7) = 7
    expect(eventsForDay(config, 15)[0]).toMatchObject({ type: 'nightRaid', count: 7 })

    // 공식 결과가 1보다 작아도 count는 절대 1 미만이 되지 않는다
    const shrinking = makeConfig({ raidBaseCount: 0.2, raidCountGrowthPerDay: -0.5 })
    expect(eventsForDay(shrinking, 5)[0]).toMatchObject({ type: 'nightRaid', count: 1 })
    expect(eventsForDay(shrinking, 15)[0]).toMatchObject({ type: 'nightRaid', count: 1 }) // round(-4.8) → 1로 클램프
  })

  it('황금나무 확률 경계값: 0이면 절대 없고 1이면 항상 있다', () => {
    const never = makeConfig({ goldenTreeChance: 0 })
    expect(eventsForDay(never, 6)).toEqual([])
    expect(eventsForDay(never, 11)).toEqual([])

    const always = makeConfig({ goldenTreeChance: 1 })
    // 습격 날이 아닌 day 6 → 황금나무 하나만 반환된다
    expect(eventsForDay(always, 6)).toEqual([{ type: 'goldenTree', woodBonus: 50 }])
  })

  it('두 이벤트가 같은 날 겹치면 황금나무 → 밤습격 순서를 유지한다', () => {
    // day 5는 습격일이고 rand(seed1234+5*104729) ≈ 0.108 < 0.5 라 황금나무도 발생
    const config = makeConfig({ goldenTreeChance: 0.5 })

    expect(eventsForDay(config, 5)).toEqual([
      { type: 'goldenTree', woodBonus: 50 },
      { type: 'nightRaid', count: 3 },
    ])
  })

  it('day마다 다른 시드가 파생되어 황금나무 판정이 날별로 달라질 수 있다', () => {
    const config = makeConfig({ goldenTreeChance: 0.5 })

    // day 5 rand ≈ 0.108 (발생), day 6 rand ≈ 0.928 (미발생)
    expect(eventsForDay(config, 5).some(event => event.type === 'goldenTree')).toBe(true)
    expect(eventsForDay(config, 6).some(event => event.type === 'goldenTree')).toBe(false)
  })
})
