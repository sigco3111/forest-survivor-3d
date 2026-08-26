import { describe, expect, it } from 'vitest'

import {
	computeOfflineGain,
	isMeaningfulOfflineGain,
	type OfflineProgressConfig,
} from '../../src/game/offline-progress'

const CONFIG: OfflineProgressConfig = {
	capHours: 8,
	woodPerMinuteBase: 0.5,
	woodPerTier: 0.25,
	metaXpPerHour: 5,
}

describe('computeOfflineGain', () => {
	it('음수/0 경과는 모두 0 지급이다 (시계 오차 방어)', () => {
		expect(computeOfflineGain(-1000, 1, CONFIG)).toEqual({ elapsedMs: 0, cappedMs: 0, wood: 0, metaXp: 0 })
		expect(computeOfflineGain(0, 3, CONFIG)).toEqual({ elapsedMs: 0, cappedMs: 0, wood: 0, metaXp: 0 })
	})

	it('상한 이내의 이탈은 경과 시간 그대로 환산한다', () => {
		const gain = computeOfflineGain(60 * 60_000, 1, CONFIG) // 정확히 1시간
		expect(gain.elapsedMs).toBe(3_600_000)
		expect(gain.cappedMs).toBe(3_600_000)
		// 목재: 60분 × 0.5 = 30
		expect(gain.wood).toBe(30)
		// 메타 XP: 1시간 × 5 = 5
		expect(gain.metaXp).toBe(5)
	})

	it('티어가 오르면 분당 목재 효율이 올라간다', () => {
		// 티어 1: 0.5/분 → 30/h, 티어 5: 0.5 + 4×0.25 = 1.5/분 → 90/h
		expect(computeOfflineGain(3_600_000, 1, CONFIG).wood).toBe(30)
		expect(computeOfflineGain(3_600_000, 5, CONFIG).wood).toBe(90)
		// 티어 0 같은 비정상 값도 최소 1로 취급한다
		expect(computeOfflineGain(3_600_000, 0, CONFIG).wood).toBe(30)
	})

	it('상한(capHours)을 넘는 이탈은 상한분만 인정된다', () => {
		const twoDays = computeOfflineGain(48 * 3_600_000, 9, CONFIG)
		expect(twoDays.elapsedMs).toBe(48 * 3_600_000)
		expect(twoDays.cappedMs).toBe(8 * 3_600_000)
		// 티어 9: 0.5 + 8×0.25 = 2.5/분 → 480시간? no — 8h = 480분 × 2.5 = 1200
		expect(twoDays.wood).toBe(1200)
		// 메타 XP는 8시간 × 5 = 40 (24시간치가 아니라 상한 8시간 기준)
		expect(twoDays.metaXp).toBe(40)
	})

	it('미미한 이탈은 내림 결과 0이 될 수 있다', () => {
		const tiny = computeOfflineGain(30_000, 1, CONFIG) // 30초
		expect(tiny.cappedMs).toBe(30_000)
		expect(tiny.wood).toBe(0) // 0.5분 × 0.5 = 0.25 → floor 0
		expect(tiny.metaXp).toBe(0)
	})
})

describe('isMeaningfulOfflineGain', () => {
	it('1분 미만이면 의미 없다', () => {
		expect(isMeaningfulOfflineGain({ elapsedMs: 59_999, cappedMs: 59_999, wood: 99, metaXp: 9 })).toBe(false)
	})

	it('1분 이상이라도 지급액이 전부 0이면 의미 없다', () => {
		expect(isMeaningfulOfflineGain({ elapsedMs: 120_000, cappedMs: 120_000, wood: 0, metaXp: 0 })).toBe(false)
	})

	it('1분 이상 + 지급액이 하나라도 있으면 의미 있다', () => {
		expect(isMeaningfulOfflineGain({ elapsedMs: 120_000, cappedMs: 120_000, wood: 1, metaXp: 0 })).toBe(true)
		expect(isMeaningfulOfflineGain({ elapsedMs: 120_000, cappedMs: 120_000, wood: 0, metaXp: 1 })).toBe(true)
	})
})
