import { describe, expect, it } from 'vitest'

import {
  createBuildingManager,
  type BuildingManagerConfig,
  type BuildContext,
} from '../../src/game/resources/buildings'

// 테스트 공통 설정: 제안 기본값을 그대로 사용한다.
const CONFIG: BuildingManagerConfig = {
  campfireMinDay: 2,
  campfireCostWood: 22,
  campfireMaxCount: 3,
  campfireLightRadius: 140,
  campfireDetectionFactor: 0.45,
  detectionFactorFloor: 0.25,
  buildCooldownDays: 1,
  fenceSegments: 10,
  fenceCostPerSegment: 2,
  fenceRingRadius: 42,
  fenceBlockRadius: 9,
}

function makeCtx(overrides: Partial<BuildContext> = {}): BuildContext {
  return {
    day: 2,
    wood: 100,
    reserveWood: 10,
    playerPosition: [0, 0],
    ...overrides,
  }
}

// i번 세그먼트의 예상 위치(각도 공식: (i / fenceSegments) × 2π, 반지름 42).
function expectedFencePosition(center: [number, number], i: number): [number, number] {
  const angle = ((i / CONFIG.fenceSegments) * Math.PI * 2)
  return [
    center[0] + Math.cos(angle) * CONFIG.fenceRingRadius,
    center[1] + Math.sin(angle) * CONFIG.fenceRingRadius,
  ]
}

function buildFullRing(center: [number, number] = [0, 0]) {
  const manager = createBuildingManager(CONFIG)
  const result = manager.maybeBuild(makeCtx({ playerPosition: center }))
  return { manager, result }
}

describe('createBuildingManager', () => {
  it('최소 일차 전에는 아무것도 짓지 않고, 쿨다운도 소모하지 않는다', () => {
    const manager = createBuildingManager(CONFIG)

    // 1일차(< campfireMinDay 2) → 빈 결과
    expect(manager.maybeBuild(makeCtx({ day: 1 }))).toEqual({ built: [], woodSpent: 0 })
    expect(manager.buildings).toHaveLength(0)
    // 실패 직후 같은 일차 재시도 역시 여전히 최소 일차에 막힌다
    expect(manager.maybeBuild(makeCtx({ day: 1 }))).toEqual({ built: [], woodSpent: 0 })

    // 이후 자격이 되는 날에는 정상 건설된다(실패가 쿨다운을 소모하지 않음을 포함).
    const result = manager.maybeBuild(makeCtx({ day: 2 }))
    expect(result.built).toHaveLength(10)
  })

  it('목재 부족과 비축 상한을 지키며, 딱 맞는 목재로는 모닥불만 짓는다', () => {
    const manager = createBuildingManager(CONFIG)

    // 나무가 모닥불 값보다 적으면 실패
    expect(manager.maybeBuild(makeCtx({ day: 5, wood: 21 }))).toEqual({ built: [], woodSpent: 0 })
    // 모닥불은 가능해도 비축(reserveWood 10)을 침범하면 실패 (31 - 22 = 9 < 10)
    expect(manager.maybeBuild(makeCtx({ day: 5, wood: 31 }))).toEqual({ built: [], woodSpent: 0 })

    // 실패가 쿨다운을 소모하지 않았음을 같은 날짜 재시도로 증명한다.
    const affordable = manager.maybeBuild(makeCtx({ day: 5, wood: 32 }))
    expect(affordable.built).toHaveLength(1)
    expect(affordable.built[0]?.type).toBe('campfire')
    expect(affordable.woodSpent).toBe(22)
    // 남은 예산으로는 첫 울타리도 못 짠다(32 - 22 - 2 = 8 < 10) → 루프 즉시 중단.
    expect(manager.blocks(expectedFencePosition([0, 0], 1))).toBe(false)
  })

  it('모닥불과 출입문을 뺀 전체 울타리 링을 순차 id로 짓는다', () => {
    const manager = createBuildingManager(CONFIG)
    const ctx = makeCtx({ playerPosition: [0, 0] })
    const result = manager.maybeBuild(ctx)

    // 모닥불 1 + 울타리 9(세그먼트 1~9, 0은 출입문), 총 지출 22 + 9×2 = 40
    expect(result.built).toHaveLength(10)
    expect(result.woodSpent).toBe(40)

    // 모닥불은 플레이어 위치의 복사본에 세워진다.
    const campfire = result.built[0]
    expect(campfire).toEqual({
      id: 'campfire-1',
      type: 'campfire',
      position: [0, 0],
      bearing: 0,
      segmentIndex: -1,
      builtDay: 2,
    })

    // ctx.playerPosition을 나중에 변형해도 이미 지어진 건물은 움직이지 않는다.
    ctx.playerPosition[0] = 999
    expect(manager.buildings[0]?.position).toEqual([0, 0])

    // 울타리: 각도/접선 방향/세그먼트 번호/id 연속성 검증.
    result.built.forEach((building, index) => {
      expect(building.id).toBe(`${building.type}-${index + 1}`)
      if (building.type === 'fence') {
        const i = index
        expect(building.segmentIndex).toBe(i)
        expect(building.position).toEqual(expectedFencePosition([0, 0], i))
        expect(building.bearing).toBeCloseTo(((i / 10) * Math.PI * 2) + Math.PI / 2, 12)
        expect(building.builtDay).toBe(2)
      }
    })
    // 마지막 울타리는 세그먼트 9(fenceSegments - 1)이다.
    expect(result.built[9]?.segmentIndex).toBe(9)
  })

  it('예산이 모자라면 링 중간에서 정확히 멈춘다', () => {
    const manager = createBuildingManager(CONFIG)
    // 나무 38: 모닥불 후 16 → 울타리 3개(6 소비, 잔여 10)까지 가능, 4번째는 8 < 10으로 중단.
    const result = manager.maybeBuild(makeCtx({ wood: 38 }))

    expect(result.built).toHaveLength(4)
    expect(result.woodSpent).toBe(28)
    expect(result.built.map(building => building.segmentIndex)).toEqual([-1, 1, 2, 3])
    // 세그먼트 4 자리에는 건물이 없어야 한다.
    expect(manager.blocks(expectedFencePosition([0, 0], 4))).toBe(false)
    expect(manager.blocks(expectedFencePosition([0, 0], 3))).toBe(true)
  })

  it('성공 시에만 쿨다운을 소모하고, 최대 개수 도달 후엔 더 짓지 않는다', () => {
    const manager = createBuildingManager(CONFIG)

    // 1일차 모닥불 + 링 완성
    manager.maybeBuild(makeCtx({ day: 2 }))
    // 같은 날 재시도 → 쿨다운(1일)에 걸려 아무것도 안 함
    expect(manager.maybeBuild(makeCtx({ day: 2 }))).toEqual({ built: [], woodSpent: 0 })
    expect(manager.buildings.filter(b => b.type === 'campfire')).toHaveLength(1)

    // 2·3일차 모닥불로 최대치(3) 도달
    manager.maybeBuild(makeCtx({ day: 3, playerPosition: [500, 500] }))
    manager.maybeBuild(makeCtx({ day: 4, playerPosition: [900, 900] }))
    expect(manager.buildings.filter(b => b.type === 'campfire')).toHaveLength(3)

    // 최대 개수 도달 후엔 쿨다운과 무관하게 아무것도 못 짓는다.
    expect(manager.maybeBuild(makeCtx({ day: 5, playerPosition: [1200, 1200] })))
      .toEqual({ built: [], woodSpent: 0 })
    expect(manager.maybeBuild(makeCtx({ day: 5, playerPosition: [1500, 1500] })))
      .toEqual({ built: [], woodSpent: 0 })
    expect(manager.buildings).toHaveLength(3 + 9 * 3)
  })

  it('탐지 배율은 빛 반경 안 모닥불 개수만큼 곱해지고 하한으로 클램프된다', () => {
    // 단독 모닥불: 안쪽 0.45, 바깥쪽 1
    const single = createBuildingManager(CONFIG)
    single.maybeBuild(makeCtx({ day: 2, wood: 32 }))
    expect(single.detectionMultiplierAt([50, 50])).toBe(0.45)
    expect(single.detectionMultiplierAt([200, 0])).toBe(1)

    // 두 모닥불 중첩(서로 30 거리, 둘 다 반경 140 안): 0.45² ≈ 0.2025 → 하한 0.25
    const doubled = createBuildingManager(CONFIG)
    doubled.maybeBuild(makeCtx({ day: 2, wood: 32, playerPosition: [0, 0] }))
    doubled.maybeBuild(makeCtx({ day: 3, wood: 32, playerPosition: [30, 0] }))
    expect(doubled.detectionMultiplierAt([0, 0])).toBe(0.25)
  })

  it('blocks()는 울타리만 차단하고 출입문(세그먼트 0)은 통과시킨다', () => {
    const { manager } = buildFullRing([0, 0])

    // 세그먼트 5(각도 π → [-42, 0]) 위의 점은 막힌다.
    expect(manager.blocks([-42, 0])).toBe(true)
    // 출입문 쪽(각도 0 → [42, 0])은 세그먼트 0이 없으므로 뚫려 있다.
    expect(manager.blocks([42, 0])).toBe(false)
    // 멀리 떨어진 점과 모닥불 중심(울타리까지 42 > 9)은 막지 않는다.
    expect(manager.blocks([500, 500])).toBe(false)
    expect(manager.blocks([0, 0])).toBe(false)

    // 복원 데이터에 세그먼트 0 울타리가 섞여 있어도 그 자리는 막지 않는다.
    manager.restore([
      { type: 'fence', position: [100, 100], bearing: Math.PI / 2, segmentIndex: 0, builtDay: 1 },
      { type: 'fence', position: [130, 100], bearing: Math.PI / 2, segmentIndex: 3, builtDay: 1 },
    ])
    expect(manager.blocks([100, 100])).toBe(false)
    expect(manager.blocks([130, 100])).toBe(true)
  })

  it('스냅샷과 복원이 깊은 복사로 동작하고 id 카운터를 이어간다', () => {
    const { manager, result } = buildFullRing([0, 0])
    expect(result.woodSpent).toBe(40)

    // 스냅샷은 깊은 복사본: 스냅샷 변형이 원본에 영향 없다.
    const snapshot = manager.snapshot()
    snapshot[0].position[0] += 999
    expect(manager.buildings[0]?.position).toEqual([0, 0])
    expect(snapshot[0]).not.toHaveProperty('id')

    // 새 관리자에 복원 → 건물 목록과 판정 동작이 동일하다.
    const restored = createBuildingManager(CONFIG)
    const input = manager.snapshot()
    restored.restore(input)
    expect(restored.buildings).toEqual(manager.buildings)
    // 복원 입력을 나중에 변형해도 복원된 상태는 불변이다(방어 복사).
    input[1].position[1] += 999
    expect(restored.buildings[1]?.position).toEqual(manager.buildings[1]?.position)

    expect(restored.blocks([-42, 0])).toBe(true)
    expect(restored.blocks([42, 0])).toBe(false)
    expect(restored.detectionMultiplierAt([0, 0])).toBe(manager.detectionMultiplierAt([0, 0]))

    // id 카운터가 복원된 개수(10) 다음 번호부터 이어진다.
    const afterRestore = restored.maybeBuild(makeCtx({ day: 10, playerPosition: [400, 400] }))
    expect(afterRestore.built[0]?.id).toBe('campfire-11')
  })
})
