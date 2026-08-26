/**
 * 상태이상(디버프) 순수 규칙 모듈. Vue/DOM/three 의존이 전혀 없다.
 *
 * - stun(기절): 행동 정지. FSM 소비자가 isStunned()로 확인해 chase/attack을 막는다.
 * - bleed(출혈): 틱마다 potency만큼 피해. updateStatuses()가 tickDamage로 합산해 돌려준다.
 * - slow(둔화): 이동속도 배율(1 미만). slowFactorFor()의 최솟값이 실질 배율이다.
 *
 * 표현 규약: 만료는 절대 시각(expiresAt, ms), 출혈 틱은 상대 카운트다운(nextTickInMs).
 * 전체 코드베이스가 provokedUntil/furyActiveUntil 같은 절대 시각 스케줄과
 * hitTimer 같은 delta 누적 타이머를 섞어 쓰는 패턴을 따른다.
 * 모든 함수는 입력 배열/개체를 변경하지 않고 새 값을 반환한다(불변).
 */

export type StatusEffectKind = 'stun' | 'bleed' | 'slow'

/** 상태이상 부여 레시피: 발경자가 kind·강도·지속시간을 지정한다 (절대 시각 없음). */
export type StatusInfliction =
  | { kind: 'stun'; durationMs: number }
  | { kind: 'slow'; durationMs: number; /** 이동속도 배율 (1 미만) */ potency: number }
  | {
      kind: 'bleed'
      durationMs: number
      /** 틱 1회당 피해량 */
      potency: number
      tickIntervalMs: number
    }

/** 에이전트가 보유하는 활성 상태이상. bleed만 틱 필드를 가진다. */
export type StatusEffect = {
  kind: StatusEffectKind
  /** stun: 1 고정 / bleed: 틱당 피해량 / slow: 이동속도 배율 */
  potency: number
  /** 만료 절대 시각(ms). 이 시각 이후 updateStatuses가 제거한다 */
  expiresAt: number
  /** bleed 전용: 틱 간격(ms). 항상 ≥ 1 (0 나눗셈/무한 루프 방지) */
  tickIntervalMs?: number
  /** bleed 전용: 다음 틱까지 남은 시간(ms). delta 누적으로 감소한다 */
  nextTickInMs?: number
}

/**
 * 부여 레시피를 현재 시각 기준 활성 상태로 변환한다.
 * 첫 틱은 한 간격 후에 온다(부여 즉시 피해 없음). tickIntervalMs는 최소 1ms로 클램프한다.
 */
export function makeStatus(infliction: StatusInfliction, now: number): StatusEffect {
  if (infliction.kind === 'bleed') {
    const tickIntervalMs = Math.max(1, infliction.tickIntervalMs)
    return {
      kind: 'bleed',
      potency: infliction.potency,
      expiresAt: now + infliction.durationMs,
      tickIntervalMs,
      nextTickInMs: tickIntervalMs,
    }
  }
  return {
    kind: infliction.kind,
    potency: infliction.kind === 'stun' ? 1 : infliction.potency,
    expiresAt: now + infliction.durationMs,
  }
}

/** 같은 종류끼리의 병합: 남은 지속시간과 potency를 각각 max로 갱신한다. */
function mergeStatus(current: StatusEffect, incoming: StatusEffect): StatusEffect {
  const potency = Math.max(current.potency, incoming.potency)
  // 만료가 긴 쪽이 이기며, bleed 틱 일정(간격/다음 틱)도 승자 것을 따른다 — 단순 결정적 규칙.
  const winner = incoming.expiresAt > current.expiresAt ? incoming : current
  return {
    ...winner,
    potency,
  }
}

/**
 * 기존 상태 배열에 신규 상태를 합성한 "새" 배열을 반환한다 (입력 불변).
 * 같은 종류가 이미 있으면 병합(max 갱신), 없으면 끝에 추가한다.
 */
export function applyStatus(existing: readonly StatusEffect[], incoming: StatusEffect): StatusEffect[] {
  const index = existing.findIndex(status => status.kind === incoming.kind)
  if (index === -1) return [...existing, { ...incoming }]
  return existing.map((status, i) => (i === index ? mergeStatus(status, incoming) : status))
}

/**
 * deltaMs만큼 상태를 진행시킨다. 만료된 상태는 제거하고, bleed는 도래한 틱만큼
 * tickDamage를 누적해 돌려준다. 한 번에 큰 delta가 와도 간격 수만큼 소급 적용한다(catch-up).
 * 반환의 statuses는 항상 새 배열이다.
 */
export function updateStatuses(
  statuses: readonly StatusEffect[],
  deltaMs: number,
  now: number,
): { statuses: StatusEffect[]; tickDamage: number } {
  const survivors: StatusEffect[] = []
  let tickDamage = 0

  for (const status of statuses) {
    // 만료 판정이 먼저: 만료와 틱이 같은 프레임에 걸리면 마지막 틱은 무효다
    if (status.expiresAt <= now) continue

    if (status.kind !== 'bleed') {
      survivors.push(status)
      continue
    }

    const interval = status.tickIntervalMs
    if (interval === undefined || status.nextTickInMs === undefined) {
      // 틱 데이터가 온전하지 않은 bleed: 피해 없이 잔존만 시킨다
      survivors.push(status)
      continue
    }

    let nextTickInMs = status.nextTickInMs - deltaMs
    // 간격은 최소 1ms로 강제한다(수동 생성 개체의 0 간격 무한 루프 방지)
    const safeInterval = Math.max(1, interval)
    while (nextTickInMs <= 0) {
      tickDamage += status.potency
      nextTickInMs += safeInterval
    }
    survivors.push({ ...status, nextTickInMs })
  }

  return { statuses: survivors, tickDamage }
}

/**
 * 기절 여부. 반드시 직전에 updateStatuses()로 만료분을 정리한 뒤 호출해야 한다
 * (정리되지 않은 만료 상태는 여전히 true를 반환한다).
 */
export function isStunned(statuses: readonly StatusEffect[]): boolean {
  return statuses.some(status => status.kind === 'stun')
}

/**
 * 활성 slow들의 가장 강한 배율(최솟값). slow가 없으면 1 (속도 무영향).
 * 여러 slow가 걸렸어도 중복 가속은 하지 않는다 — 최강 하나만 적용.
 */
export function slowFactorFor(statuses: readonly StatusEffect[]): number {
  let factor = 1
  for (const status of statuses) {
    if (status.kind === 'slow' && status.potency < factor) factor = status.potency
  }
  return factor
}
