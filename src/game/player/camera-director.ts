import type { PlanePoint } from '../resources/trees'

export type CameraDirectorConfig = {
  followLerpPerSecond: number // 줌 배율 보간 속도 (1/초)
  combatZoomScale: number // 교전 중 카메라 거리 배율 (<1 = 줌인)
  bossZoomScale: number // 보스 교전 중 거리 배율
  crisisVignetteRatio: number // HP 비율이 이하면 비네트 시작
  maxVignetteIntensity: number // 비네트 최대 불투명도
  shakeDecayPerSecond: number // 셰이크 에너지 초당 감쇠량 (선형)
  bossIntroShakeIntensity: number
  hitShakeIntensity: number
  hitShakeDurationMs: number // 피격 셰이크 유지 시간 (이후 즉시 소멸 허용치)
  focusBlendRatio: number // 포커스 = 플레이어↔위협 블렌드 비율
}

export type CameraContext = {
  deltaSeconds: number
  nowMs: number
  playerPosition: PlanePoint
  threatPosition?: PlanePoint | null // 현재 교전 대상 (없으면 null)
  bossEngaged?: boolean // 보스와 교전 중
  healthRatio: number // 0..1
}

export type CameraDirective = {
  distanceScale: number // 보간된 카메라 거리 배율
  focusPoint: PlanePoint // 플레이어↔위협 블렌드 지점
  shakeIntensity: number // 현재 셰이크 에너지 (0 이상)
  vignetteIntensity: number // 0..maxVignetteIntensity
}

export type CameraDirector = {
  update(ctx: CameraContext): CameraDirective
  triggerBossIntro(nowMs: number): void
  triggerHit(nowMs: number): void
}

/**
 * 카메라 연출 디렉터.
 *
 * - 거리 배율: 목표 배율(보스 > 일반 교전 > 기본 1)로 초당 선형 보간하며
 *   한 스텝이 목표를 지나쳐 오버슈트하지 않도록 클램프한다.
 * - 셰이크: 보스 등장 충격과 피격 충격을 별도 에너지로 누적(max 방식)하고,
 *   초당 선형 감쇠로 줄인다. 피격 에너지는 hitShakeDurationMs 가 지나면
 *   선형 감쇠 잔여분과 무관하게 즉시 0으로 강제 소멸시킨다.
 *   (두 에너지의 합을 최종 셰이크 강도로 노출 — 단순하고 결정적인 모델)
 * - 호출자가 deltaSeconds/nowMs 를 공급하므로 내부에서 시간을 얻지 않는다.
 */
export function createCameraDirector(config: CameraDirectorConfig): CameraDirector {
  let currentDistanceScale = 1 // 현재 보간된 카메라 거리 배율 (1에서 시작)
  let bossShakeEnergy = 0 // 보스 등장 충격 에너지
  let hitShakeEnergy = 0 // 피격 충격 에너지
  let hitAtMs: number | null = null // 마지막 피격 시각 (만료 판정용)

  return {
    update(ctx: CameraContext): CameraDirective {
      // 1) 목표 배율 결정: 보스 > 일반 교전 > 기본값 1
      const targetScale =
        ctx.bossEngaged === true
          ? config.bossZoomScale
          : ctx.threatPosition != null
            ? config.combatZoomScale
            : 1

      // 2) 초당 followLerpPerSecond 속도로 선형 접근, 목표를 지나치지 않게 클램프
      const diff = targetScale - currentDistanceScale
      const step = config.followLerpPerSecond * ctx.deltaSeconds
      if (Math.abs(diff) <= step) {
        currentDistanceScale = targetScale
      } else {
        currentDistanceScale += Math.sign(diff) * step
      }

      // 3) 포커스 지점: 위협 없으면 플레이어 위치 복사본, 있으면 플레이어↔위협 블렌드
      const threat = ctx.threatPosition
      const focusPoint: PlanePoint =
        threat == null
          ? [ctx.playerPosition[0], ctx.playerPosition[1]]
          : [
              ctx.playerPosition[0] + (threat[0] - ctx.playerPosition[0]) * config.focusBlendRatio,
              ctx.playerPosition[1] + (threat[1] - ctx.playerPosition[1]) * config.focusBlendRatio,
            ]

      // 4) 비네트: 위기 HP 비율 이하에서 부족분에 비례해 강해지고, 최댓값에서 클램프
      let vignetteIntensity = 0
      if (ctx.healthRatio < config.crisisVignetteRatio) {
        const raw =
          ((config.crisisVignetteRatio - ctx.healthRatio) / config.crisisVignetteRatio) *
          config.maxVignetteIntensity
        vignetteIntensity = Math.min(config.maxVignetteIntensity, Math.max(0, raw))
      }

      // 5) 셰이크 감쇠: 두 에너지를 각각 초당 선형 감쇠 (음수 방지)
      bossShakeEnergy = Math.max(0, bossShakeEnergy - config.shakeDecayPerSecond * ctx.deltaSeconds)
      hitShakeEnergy = Math.max(0, hitShakeEnergy - config.shakeDecayPerSecond * ctx.deltaSeconds)

      // 6) 피격 셰이크 만료: 유지 시간을 넘겼으면 선형 감쇠 잔여분과 무관하게 즉시 소멸
      if (hitAtMs !== null && ctx.nowMs - hitAtMs > config.hitShakeDurationMs) {
        hitShakeEnergy = 0
      }

      return {
        distanceScale: currentDistanceScale,
        focusPoint,
        shakeIntensity: bossShakeEnergy + hitShakeEnergy,
        vignetteIntensity,
      }
    },

    triggerBossIntro(nowMs: number): void {
      // 이미 더 강한 충격이 남아 있다면 값을 올리지 않는다 (nowMs 는 시그니처 유지용)
      bossShakeEnergy = Math.max(bossShakeEnergy, config.bossIntroShakeIntensity)
      void nowMs
    },

    triggerHit(nowMs: number): void {
      hitShakeEnergy = Math.max(hitShakeEnergy, config.hitShakeIntensity)
      hitAtMs = nowMs
    },
  }
}
