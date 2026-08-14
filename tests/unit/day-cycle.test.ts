import { describe, expect, it } from 'vitest'

import { createDayCycle } from '../../src/game/time/day-cycle'

describe('createDayCycle', () => {
  it('derives each time-of-day phase at its boundary', () => {
    const cycle = createDayCycle({ realMsPerDay: 1_000 })

    cycle.update(249)
    expect(cycle.state.timeOfDay).toBe('night')
    expect(cycle.state.isNight).toBe(true)

    cycle.update(1)
    expect(cycle.state.timeOfDay).toBe('dawn')

    cycle.update(100)
    expect(cycle.state.timeOfDay).toBe('day')
    expect(cycle.state.isNight).toBe(false)

    cycle.update(300)
    expect(cycle.state.timeOfDay).toBe('dusk')

    cycle.update(100)
    expect(cycle.state.timeOfDay).toBe('night')
  })

  it('reports a new day and resets progress after a full cycle', () => {
    const cycle = createDayCycle({ realMsPerDay: 1_000 })

    const result = cycle.update(1_000)

    expect(result).toEqual({ isNewDay: true, dayNumber: 2 })
    expect(cycle.state.currentDay).toBe(2)
    expect(cycle.state.dayProgress).toBe(0)
  })

  it('handles updates spanning multiple days', () => {
    const cycle = createDayCycle({ realMsPerDay: 1_000 })

    const result = cycle.update(2_500)

    expect(result).toEqual({ isNewDay: true, dayNumber: 3 })
    expect(cycle.state.dayProgress).toBe(0.5)
    expect(cycle.state.timeOfDay).toBe('day')
  })
})
