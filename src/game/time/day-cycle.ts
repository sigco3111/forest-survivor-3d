export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night'

export type DayCycleState = {
  currentDay: number
  dayProgress: number
  timeOfDay: TimeOfDay
  totalElapsedMs: number
  isNight: boolean
}

type DayCycleConfig = {
  realMsPerDay: number
}

type DayUpdateResult = {
  isNewDay: boolean
  dayNumber: number
}

export function createDayCycle(config: DayCycleConfig) {
  const state: DayCycleState = {
    currentDay: 1,
    dayProgress: 0,
    timeOfDay: 'day',
    totalElapsedMs: 0,
    isNight: false,
  }

  function deriveTimeOfDay(progress: number): TimeOfDay {
    if (progress < 0.25) return 'night'
    if (progress < 0.35) return 'dawn'
    if (progress < 0.65) return 'day'
    if (progress < 0.75) return 'dusk'
    return 'night'
  }

  return {
    state,

    update(deltaMs: number): DayUpdateResult | null {
      state.totalElapsedMs += deltaMs
      state.dayProgress = (state.totalElapsedMs % config.realMsPerDay) / config.realMsPerDay
      state.timeOfDay = deriveTimeOfDay(state.dayProgress)
      state.isNight = state.timeOfDay === 'night'

      const newDay = Math.floor(state.totalElapsedMs / config.realMsPerDay) + 1
      if (newDay !== state.currentDay) {
        state.currentDay = newDay
        return { isNewDay: true, dayNumber: newDay }
      }

      return null
    },
  }
}
