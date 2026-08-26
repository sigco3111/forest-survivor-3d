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

  it('기상 이변: 설정이 없으면 절대 발생하지 않는다', () => {
    // weather 필드 미설정 (기본) — 습격일에도 이변은 없다
    expect(eventsForDay(makeConfig(), 5).some(event => event.type === 'weather')).toBe(false)
    // intervalDays가 0 이하면 나눌 수 없으므로 이변 없음
    const zeroInterval = makeConfig({ weatherFirstDay: 1, weatherIntervalDays: 0 })
    expect(eventsForDay(zeroInterval, 100).some(event => event.type === 'weather')).toBe(false)
  })

  it('기상 이변: 첫 날 이전과 주기 외의 날에는 발생하지 않는다', () => {
    // (day - 4) % 9 === 0 → day ∈ {4, 13, 22, ...}, firstDay 12 → 13부터
    const config = makeConfig({ weatherFirstDay: 12, weatherIntervalDays: 9, weatherOffsetDays: 4 })

    expect(eventsForDay(config, 11).some(event => event.type === 'weather')).toBe(false) // 첫 날 전
    expect(eventsForDay(config, 12).some(event => event.type === 'weather')).toBe(false) // 주기 아님
    expect(eventsForDay(config, 14).some(event => event.type === 'weather')).toBe(false)
  })

  it('기상 이변: 주기마다 붉은 달/안개가 번갈아 온다', () => {
    const config = makeConfig({ weatherFirstDay: 12, weatherIntervalDays: 9, weatherOffsetDays: 4 })
    // day 13: cycle 1 → 홀수 → fog. day 22: cycle 2 → 짝수 → bloodMoon. day 31: cycle 3 → fog.
    expect(eventsForDay(config, 13)).toContainEqual({ type: 'weather', kind: 'fog' })
    expect(eventsForDay(config, 22)).toContainEqual({ type: 'weather', kind: 'bloodMoon' })
    expect(eventsForDay(config, 31)).toContainEqual({ type: 'weather', kind: 'fog' })
    // 결정론 확인
    expect(eventsForDay(config, 22)).toEqual(eventsForDay(config, 22))
  })

  it('기상 이변: 오프셋 생략 시 day % interval 기준으로 판정한다', () => {
    const config = makeConfig({ weatherFirstDay: 3, weatherIntervalDays: 9 })
    // offset 0 → day 9 배수마다. day 9: cycle 1 → fog.
    expect(eventsForDay(config, 3)).toEqual([]) // cycle 0은 firstDay(3) < 9라 해당 없음 — day 3은 (3-0)%9≠0
    expect(eventsForDay(config, 18)).toContainEqual({ type: 'weather', kind: 'bloodMoon' }) // cycle 2
  })

  it('기상 이변: 음수 사이클 방어 — 첫 날이 오프셋보다 앞서도 안전하다', () => {
    // day=1, offset=10, interval=9 → (1-10) = -9 % 9 === 0 이지만 cycle -1 → 미발생 가지
    const config = makeConfig({ weatherFirstDay: 1, weatherIntervalDays: 9, weatherOffsetDays: 10 })
    expect(eventsForDay(config, 1).some(event => event.type === 'weather')).toBe(false)
  })

  it('습격과 기상 이변이 같은 날 겹칠 수 있다 (순서 유지)', () => {
    // day 30: 습격(30%5===0) + 이변((30-4)%9===0? 26%9=8 → 아니고...) → 이변 없음 검증 대신
    // 겹치는 날을 찾자: day ≡ 0 (mod 5), (day-4) ≡ 0 (mod 9) → day=40: 40%5=0 ✓, 36%9=0 ✓, ≥12 ✓
    const config = makeConfig({
      goldenTreeChance: 0,
      weatherFirstDay: 12,
      weatherIntervalDays: 9,
      weatherOffsetDays: 4,
    })
    const events = eventsForDay(config, 40)
    expect(events.map(event => event.type)).toEqual(['nightRaid', 'weather'])
    expect(events[1]).toMatchObject({ type: 'weather', kind: 'bloodMoon' }) // cycle floor(36/9)=4 → 짝수
  })
})
