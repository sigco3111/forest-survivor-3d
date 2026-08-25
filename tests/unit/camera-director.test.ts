import { describe, expect, it } from 'vitest'

import {
  createCameraDirector,
  type CameraContext,
  type CameraDirectorConfig,
} from '../../src/game/player/camera-director'

const BASE_CONFIG: CameraDirectorConfig = {
  followLerpPerSecond: 2,
  combatZoomScale: 0.6,
  bossZoomScale: 0.4,
  crisisVignetteRatio: 0.3,
  maxVignetteIntensity: 0.8,
  shakeDecayPerSecond: 5,
  bossIntroShakeIntensity: 1.2,
  hitShakeIntensity: 0.7,
  hitShakeDurationMs: 400,
  focusBlendRatio: 0.35,
}

const PLAYER: [number, number] = [10, -4]
const THREAT: [number, number] = [20, 6]

function createContext(overrides: Partial<CameraContext> = {}): CameraContext {
  return {
    deltaSeconds: 0,
    nowMs: 0,
    playerPosition: PLAYER,
    threatPosition: null,
    bossEngaged: false,
    healthRatio: 1,
    ...overrides,
  }
}

describe('createCameraDirector', () => {
  it('초기 상태에서는 기본 배율·플레이어 포커스·비네트/셰이크 0을 반환한다', () => {
    const director = createCameraDirector(BASE_CONFIG)

    const first = director.update(createContext({ nowMs: 100 }))
    expect(first.distanceScale).toBe(1)
    expect(first.focusPoint).toEqual([10, -4])
    expect(first.vignetteIntensity).toBe(0)
    expect(first.shakeIntensity).toBe(0)

    // 반환된 focusPoint 를 변형해도 이후 지시문에 영향이 없어야 한다 (새 복사본 보장)
    first.focusPoint[0] = 999
    const second = director.update(createContext({ nowMs: 200 }))
    expect(second.focusPoint).toEqual([10, -4])
    expect(second).not.toBe(first)

    // delta 가 0 이 아닌 위험 없는 갱신도 배율을 1 로 유지한다
    const idle = director.update(createContext({ deltaSeconds: 0.5, nowMs: 300 }))
    expect(idle.distanceScale).toBe(1)
  })

  it('위협 등장 시 전투 배율로 비례 보간하고, 큰 delta 에서는 목표에 정확히 도달한다', () => {
    const director = createCameraDirector(BASE_CONFIG)
    const withThreat = { threatPosition: THREAT }

    // 비례 이동: step = followLerpPerSecond × delta = 2 × 0.05 = 0.1
    let directive = director.update(createContext({ deltaSeconds: 0.05, ...withThreat }))
    expect(directive.distanceScale).toBeCloseTo(0.9, 12)
    directive = director.update(createContext({ deltaSeconds: 0.05, ...withThreat }))
    expect(directive.distanceScale).toBeCloseTo(0.8, 12)

    // 매우 큰 delta 는 목표를 지나치지 않고 정확히 combatZoomScale 에 안착한다
    directive = director.update(createContext({ deltaSeconds: 100, ...withThreat }))
    expect(directive.distanceScale).toBe(BASE_CONFIG.combatZoomScale)

    // 위협 제거 후 반대 방향으로 되돌아온다 (비례 → 최종 정확히 1)
    directive = director.update(createContext({ deltaSeconds: 0.05 }))
    expect(directive.distanceScale).toBeCloseTo(0.7, 12)
    directive = director.update(createContext({ deltaSeconds: 50 }))
    expect(directive.distanceScale).toBe(1)
  })

  it('보스 교전 중에는 일반 전투보다 보스 배율이 우선한다', () => {
    const director = createCameraDirector(BASE_CONFIG)

    let directive = director.update(
      createContext({ deltaSeconds: 0.05, threatPosition: THREAT, bossEngaged: true }),
    )
    expect(directive.distanceScale).toBeCloseTo(0.9, 12) // bossZoomScale 쪽으로 이동

    directive = director.update(
      createContext({ deltaSeconds: 100, threatPosition: THREAT, bossEngaged: true }),
    )
    expect(directive.distanceScale).toBe(BASE_CONFIG.bossZoomScale)
  })

  it('포커스 지점은 플레이어↔위협을 focusBlendRatio 로 블렌드한다', () => {
    const director = createCameraDirector(BASE_CONFIG)

    // x: 10 + (20-10)×0.35 = 13.5, z: -4 + (6-(-4))×0.35 = -0.5
    const directive = director.update(
      createContext({ deltaSeconds: 0.01, threatPosition: THREAT }),
    )
    expect(directive.focusPoint[0]).toBeCloseTo(13.5, 12)
    expect(directive.focusPoint[1]).toBeCloseTo(-0.5, 12)
  })

  it('비네트는 위기 임계값 이하에서만 켜지고 0..max 범위로 클램프된다', () => {
    const director = createCameraDirector(BASE_CONFIG)

    // 임계값 위: 0
    expect(director.update(createContext({ healthRatio: 0.5 })).vignetteIntensity).toBe(0)
    // 임계값 경계: 0
    expect(director.update(createContext({ healthRatio: 0.3 })).vignetteIntensity).toBe(0)
    // 임계값의 절반 HP: max × 0.5
    const half = director.update(createContext({ healthRatio: 0.15 }))
    expect(half.vignetteIntensity).toBeCloseTo(BASE_CONFIG.maxVignetteIntensity * 0.5, 12)
    // HP 0: 최댓값 그대로
    expect(director.update(createContext({ healthRatio: 0 })).vignetteIntensity).toBe(
      BASE_CONFIG.maxVignetteIntensity,
    )
    // 비정상 입력(음수 HP): 상한으로 클램프
    expect(director.update(createContext({ healthRatio: -2 })).vignetteIntensity).toBe(
      BASE_CONFIG.maxVignetteIntensity,
    )
  })

  it('보스 등장 충격은 bossIntroShakeIntensity 로 점프 후 선형 감쇠해 0 에 도달한다', () => {
    const director = createCameraDirector(BASE_CONFIG)

    director.triggerBossIntro(1000)
    // 중복 트리거는 값을 더 올리지 않는다 (max 방식)
    director.triggerBossIntro(1000)

    expect(director.update(createContext({ nowMs: 1000 })).shakeIntensity).toBe(
      BASE_CONFIG.bossIntroShakeIntensity,
    )

    // 감쇠: 1.2 − 5 × 0.1 = 0.7
    let energy = director.update(createContext({ deltaSeconds: 0.1, nowMs: 1050 })).shakeIntensity
    expect(energy).toBeCloseTo(0.7, 12)

    // 총 에너지 1.2 / 감쇠 5 = 0.24초면 소진되므로 이후 갱신에서 0 이 된다
    energy = director.update(createContext({ deltaSeconds: 0.2, nowMs: 1100 })).shakeIntensity
    expect(energy).toBe(0)
    energy = director.update(createContext({ deltaSeconds: 1, nowMs: 2100 })).shakeIntensity
    expect(energy).toBe(0)
  })

  it('피격 충격은 hitShakeIntensity 부근에서 시작되고 유지 시간 초과 시 강제 소멸된다', () => {
    const director = createCameraDirector(BASE_CONFIG)

    director.triggerHit(2000)
    // 직후: 0.7 − 5 × 0.01 ≈ hitShakeIntensity (만료까지 여유)
    let energy = director.update(createContext({ deltaSeconds: 0.01, nowMs: 2000 })).shakeIntensity
    expect(energy).toBeCloseTo(BASE_CONFIG.hitShakeIntensity - 0.05, 12)

    // 유지 시간 내(300ms ≤ 400ms): 선형 감쇠만 적용되어 아직 살아 있다
    energy = director.update(createContext({ deltaSeconds: 0.01, nowMs: 2300 })).shakeIntensity
    expect(energy).toBeCloseTo(BASE_CONFIG.hitShakeIntensity - 0.1, 12)

    // 유지 시간 초과(450ms > 400ms): 선형 감쇠 잔여분과 무관하게 즉시 0
    energy = director.update(createContext({ deltaSeconds: 0.01, nowMs: 2450 })).shakeIntensity
    expect(energy).toBe(0)
  })
})
