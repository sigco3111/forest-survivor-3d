/**
 * 오프라인 진행: 런 저장 시점(savedAtMs)부터 재접속까지의 경과 시간을
 * 목재/메타 XP로 환산한다. 방치형의 상징 기능 — 자는 동안에도 숲은 돌아간다.
 * 계산은 단순 추정치(분당 목재 + 티어 가산, 시간당 소액 메타 XP)이며
 * capHours를 넘기지 않는다. 실제 플레이가 항상 더 빠르다.
 */
import { OFFLINE_PROGRESS_CONFIG } from '../config'

export type OfflineGain = {
	/** 실제 경과 시간 (음수는 0으로 클램프 — 시계 오차 방어) */
	elapsedMs: number
	/** 지급에 인정된 시간 (상한 클램프 적용) */
	cappedMs: number
	/** 지급 목재 (내림 정수) */
	wood: number
	/** 지급 메타 XP (내림 정수) */
	metaXp: number
}

export type OfflineProgressConfig = {
	capHours: number
	woodPerMinuteBase: number
	woodPerTier: number
	metaXpPerHour: number
}

/** 경과 시간 → 오프라인 지급액. 순수 함수라 테스트에서 임의 config 주입 가능. */
export function computeOfflineGain(
	elapsedMs: number,
	tierNumber: number,
	config: OfflineProgressConfig = OFFLINE_PROGRESS_CONFIG,
): OfflineGain {
	const safeElapsed = Math.max(0, Math.floor(elapsedMs))
	const cappedMs = Math.min(safeElapsed, config.capHours * 3_600_000)
	const minutes = cappedMs / 60_000
	const tier = Math.max(1, tierNumber)
	const woodRate = config.woodPerMinuteBase + (tier - 1) * config.woodPerTier
	return {
		elapsedMs: safeElapsed,
		cappedMs,
		wood: Math.floor(minutes * woodRate),
		metaXp: Math.floor((cappedMs / 3_600_000) * config.metaXpPerHour),
	}
}

/** 지급할 만큼 의미 있는 이탈이었는지 (1분 미만이거나 지급액이 0이면 조용히 건너뛴다) */
export function isMeaningfulOfflineGain(gain: OfflineGain): boolean {
	if (gain.cappedMs < 60_000) return false
	return gain.wood > 0 || gain.metaXp > 0
}
