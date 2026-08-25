import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createMonsterAgent,
  createMonsterResources,
  createBossMonster,
  createRespawnMonster,
  effectiveDetectionRadius,
  type MonsterResource,
  type MonsterUpdateContext,
} from '../../src/game/resources/monsters'

function makeResource(overrides: Partial<MonsterResource> = {}): MonsterResource {
  return {
    id: 'monster',
    modelName: 'Goblin',
    modelIndex: 0,
    position: [0, 0],
    rotation: 0,
    scale: 1,
    homePosition: [0, 0],
    patrolRadius: 50,
    speed: 10,
    detectionRadius: 120,
    health: 100,
    maxHealth: 100,
    attackDamage: 10,
    attackCooldownMs: 1_500,
    activityRadius: 200,
    hitStunMs: 700,
    isBoss: false,
    ...overrides,
  }
}

function makeContext(overrides: Partial<MonsterUpdateContext> = {}): MonsterUpdateContext {
  return {
    playerPosition: [10, 0],
    playerAlive: true,
    playerIsChopping: true,
    playerIsFleeing: false,
    onAttackPlayer: vi.fn(),
    ...overrides,
  }
}

describe('monster resources', () => {
  it('generates deterministic monsters within the configured world', () => {
    const config = {
      modelUrls: ['/goblin.glb', '/yeti.glb'],
      seed: 73,
      count: 8,
      radiusMeters: 500,
      scaleRange: [0.8, 1.2] as [number, number],
      patrolRadius: 80,
      speed: 22,
      detectionRadius: 120,
      attackRadius: 20,
      health: 100,
      attackDamage: 10,
      attackCooldownMs: 1_500,
      activityRadius: 170,
      modelScale: 6,
      hitStunMs: 700,
    }

    const first = createMonsterResources(config)

    expect(first).toEqual(createMonsterResources(config))
    expect(first).toHaveLength(config.count)
    expect(first.every(monster => Math.hypot(...monster.position) <= 400)).toBe(true)
    expect(first.every(monster => monster.health === monster.maxHealth)).toBe(true)
  })

  it('falls back to the default model name for extra model indexes', () => {
    const resources = createMonsterResources({
      modelUrls: Array.from({ length: 7 }, (_, index) => `/${index}.glb`),
      seed: 1,
      count: 100,
      radiusMeters: 100,
      scaleRange: [1, 1],
      patrolRadius: 10,
      speed: 10,
      detectionRadius: 20,
      attackRadius: 5,
      health: 10,
      attackDamage: 1,
      attackCooldownMs: 100,
      activityRadius: 30,
      modelScale: 1,
      hitStunMs: 700,
    })

    expect(resources.some(resource => resource.modelIndex === 6 && resource.modelName === 'Demon')).toBe(true)
  })

  it('createRespawnMonster applies strength multiplier and day scaling', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const baseConfig = {
      modelUrls: ['/goblin.glb', '/giant.glb'],
      seed: 7,
      count: 2,
      radiusMeters: 500,
      scaleRange: [1, 1] as [number, number],
      patrolRadius: 80,
      speed: 22,
      detectionRadius: 120,
      attackRadius: 20,
      health: 100,
      attackDamage: 10,
      attackCooldownMs: 1_500,
      activityRadius: 170,
      modelScale: 6,
      hitStunMs: 700,
      strengthMultipliers: { Goblin: 0.5, Giant: 2 } as Record<string, number>,
      dayScalePerDay: 0.5,
    }

    // 1일차 리스폰: 배율만 적용 (Goblin 0.5 → 체력 50/공격 5). modelNames[2] = 'Goblin'
    const goblin = createRespawnMonster(baseConfig, 'monster-respawn-0', 2, 1)
    expect(goblin.id).toBe('monster-respawn-0')
    expect(goblin.modelName).toBe('Goblin')
    expect(goblin.health).toBe(50)
    expect(goblin.maxHealth).toBe(50)
    expect(goblin.attackDamage).toBe(5)
    expect(Math.hypot(...goblin.position)).toBeLessThanOrEqual(400)

    // 3일차 리스폰: 배율 × (1 + 2 × 0.5) = ×2 (Giant 2.0 → 체력 400/공격 40)
    const giant = createRespawnMonster(baseConfig, 'monster-respawn-1', 1, 3)
    expect(giant.modelName).toBe('Giant')
    expect(giant.health).toBe(400)
    expect(giant.maxHealth).toBe(400)
    expect(giant.attackDamage).toBe(40)

    // dayScalePerDay 미설정 → 스케일링 없음 (?? 0 기본 가지)
    const { dayScalePerDay: _omitted, ...withoutScaling } = baseConfig
    const plain = createRespawnMonster(withoutScaling, 'monster-respawn-2', 2, 5)
    expect(plain.health).toBe(50)

    // 범위 밖 인덱스 + 배율 미설정 → 기본 이름(Demon)/기본 배율(1) 가지
    const { strengthMultipliers: _multipliers, ...withoutMultipliers } = baseConfig
    const fallback = createRespawnMonster(withoutMultipliers, 'monster-respawn-3', 99, 1)
    expect(fallback.modelName).toBe('Demon')
    expect(fallback.health).toBe(100)
  })

  it('createBossMonster builds a heavily scaled always-aggro boss', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const config = {
      modelUrls: ['/demon.glb', '/giant.glb'],
      seed: 7,
      count: 1,
      radiusMeters: 500,
      scaleRange: [1, 1] as [number, number],
      patrolRadius: 80,
      speed: 22,
      detectionRadius: 120,
      attackRadius: 20,
      health: 100,
      attackDamage: 10,
      attackCooldownMs: 1_500,
      activityRadius: 170,
      modelScale: 6,
      hitStunMs: 700,
      strengthMultipliers: { Giant: 1.4 } as Record<string, number>,
      dayScalePerDay: 0.5,
      bossHealthMultiplier: 2,
      bossDamageMultiplier: 0.8,
    }

    const boss = createBossMonster(config, 'boss-5', 5)

    expect(boss.id).toBe('boss-5')
    expect(boss.modelName).toBe('Giant')
    expect(boss.modelIndex).toBe(1)
    expect(boss.isBoss).toBe(true)
    // 체력: 100 × 1.4(모델) × 2(보스) × 3(5일차 스케일) = 840
    expect(boss.maxHealth).toBe(840)
    expect(boss.health).toBe(840)
    // 공격력: 10 × 1.4 × 0.8 × 3 = 33.6 → 34
    expect(boss.attackDamage).toBe(34)
    // 시각적으로 크고 (modelScale × 1.6), 활동 반경 전체를 배회
    expect(boss.scale).toBeCloseTo(9.6)
    expect(boss.activityRadius).toBe(170)
    expect(Math.hypot(...boss.position)).toBeLessThanOrEqual(400)

    // 보스는 플레이어가 벌목하지 않아도 상시 추격한다
    const agent = createMonsterAgent(makeResource({ isBoss: true, modelName: 'Giant' }))
    agent.update(0, 0, makeContext({ playerIsChopping: false }))
    expect(agent.state).toBe('chase')

    // 보스는 거리/활동 반경을 무시하고 세계 끝에서도 플레이어를 추격한다
    const farBoss = createMonsterAgent(makeResource({
      isBoss: true,
      modelName: 'Giant',
      activityRadius: 50,
      homePosition: [0, 0],
      speed: 100,
    }))
    farBoss.update(0.5, 0, makeContext({ playerPosition: [500, 0], playerIsChopping: false }))
    expect(farBoss.state).toBe('chase')
    // 첫 업데이트는 전환만, 다음 프레임에 플레이어를 향해 이동
    farBoss.update(0.5, 0, makeContext({ playerPosition: [500, 0], playerIsChopping: false }))
    expect(farBoss.position[0]).toBeGreaterThan(0) // 플레이어를 향해 이동

    // 추격 중 범위를 벗어나도 포기하지 않는다 (일반 몬스터는 포기)
    farBoss.update(0, 100, makeContext({ playerPosition: [900, 0], playerIsChopping: false }))
    expect(farBoss.state).toBe('chase')
    const normalFar = createMonsterAgent(makeResource({ activityRadius: 50 }))
    normalFar.state = 'chase'
    normalFar.update(0, 100, makeContext({ playerPosition: [900, 0], playerIsChopping: true }))
    expect(normalFar.state).toBe('idle')

    // 일반 몬스터는 여전히 벌목 중일 때만 추격
    const normal = createMonsterAgent(makeResource())
    normal.update(0, 0, makeContext({ playerIsChopping: false }))
    expect(normal.state).toBe('idle')
  })

  it('createBossMonster falls back to defaults for minimal configs', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const boss = createBossMonster({
      modelUrls: ['/giant.glb'],
      seed: 1,
      count: 1,
      radiusMeters: 100,
      scaleRange: [1, 1] as [number, number],
      patrolRadius: 10,
      speed: 10,
      detectionRadius: 20,
      attackRadius: 5,
      health: 100,
      attackDamage: 10,
      attackCooldownMs: 100,
      activityRadius: 30,
      modelScale: 1,
      hitStunMs: 100,
    }, 'boss-min', 1)

    // 단일 모델 URL → 인덱스 0 폴백, 미설정 배율은 기본값(2/0.8) 적용
    expect(boss.modelIndex).toBe(0)
    expect(boss.modelName).toBe('Giant')
    expect(boss.health).toBe(200)  // 100 × 2
    expect(boss.attackDamage).toBe(8) // 10 × 0.8
    expect(boss.isBoss).toBe(true)
  })

  it('applies species behavior multipliers to spawned and respawned monsters', () => {
    const config = {
      modelUrls: ['/goblin.glb'],
      seed: 7,
      count: 4,
      radiusMeters: 500,
      scaleRange: [1, 1] as [number, number],
      patrolRadius: 80,
      speed: 22,
      detectionRadius: 120,
      attackRadius: 20,
      health: 100,
      attackDamage: 10,
      attackCooldownMs: 1_000,
      activityRadius: 170,
      modelScale: 6,
      hitStunMs: 700,
      speciesBehavior: {
        Demon: { speedMultiplier: 1.5, attackDamageMultiplier: 2, attackCooldownMultiplier: 0.5, detectionMultiplier: 2 },
      } as Record<string, import('../../src/game/resources/monsters').SpeciesBehavior>,
    }

    const resources = createMonsterResources(config)
    // 단일 URL이므로 전부 Demon(modelNames[0]) — 배율 적용: 속도 하한 22×0.8×1.5, 공격력 20, 쿨다운 500, 탐지 240
    expect(resources.every(resource => resource.speed >= 22 * 0.8 * 1.5)).toBe(true)
    expect(resources.every(resource => resource.attackDamage === 20)).toBe(true)
    expect(resources.every(resource => resource.attackCooldownMs === 500)).toBe(true)
    expect(resources.every(resource => resource.detectionRadius === 240)).toBe(true)

    // 리스폰에도 동일 적용 (random 0.5 → 속도 계수 1.0)
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const respawned = createRespawnMonster(config, 'monster-respawn-9', 0, 1)
    expect(respawned.speed).toBe(33) // 22 × 1.0 × 1.5
    expect(respawned.attackDamage).toBe(20)
    expect(respawned.attackCooldownMs).toBe(500)
    expect(respawned.detectionRadius).toBe(240)
  })

  it('provoked monsters chase and keep attacking without playerIsChopping', () => {
    // 팩 자극: 자극 만료 전에는 벌목 없이도 추격
    const provoked = createMonsterAgent(makeResource())
    provoked.provokedUntil = 5_000
    provoked.update(0, 1_000, makeContext({ playerIsChopping: false }))
    expect(provoked.state).toBe('chase')

    // 추격 중 자극 만료 → 흥미 상실
    provoked.update(0, 6_000, makeContext({ playerIsChopping: false }))
    expect(provoked.state).toBe('idle')

    // 공격 상태에서도 자극이 유지되면 공격 지속 (쿨다운 도달 시 onAttackPlayer)
    const onAttackPlayer = vi.fn()
    const attacking = createMonsterAgent(makeResource())
    attacking.provokedUntil = 5_000
    attacking.state = 'attack'
    attacking.lastAttackTime = 0
    attacking.update(0, 1_000, makeContext({ playerIsChopping: false, onAttackPlayer }))
    // 쿨다운 중 → 아직 공격 안 함, 그러나 자극 덕에 공격 상태 유지
    expect(attacking.state).toBe('attack')
    expect(onAttackPlayer).not.toHaveBeenCalled()
    attacking.update(0, 1_600, makeContext({ playerIsChopping: false, onAttackPlayer }))
    expect(attacking.state).toBe('attack')
    expect(onAttackPlayer).toHaveBeenCalledTimes(1)

    // hit 상태에서도 자극이 살아 있으면 복귀 시 추격
    const stunned = createMonsterAgent(makeResource({ health: 100 }))
    const hitContext = makeContext({
      playerIsChopping: false,
      incomingPlayerHits: [{ id: 'monster', damage: 10 }],
    })
    stunned.state = 'attack'
    stunned.update(0, 0, hitContext)
    expect(stunned.state).toBe('hit')
    stunned.provokedUntil = 5_000
    stunned.update(0.71, 800, makeContext({ playerIsChopping: false }))
    expect(stunned.state).toBe('chase')
  })

  it('effectiveDetectionRadius widens at night and gates chase/hit recovery', () => {
    // 기본 경계 135: 낮에는 150m를 못 느끼지만 밤(×1.5 = 202.5)에는 감지한다
    const dayContext = makeContext({ playerPosition: [150, 0] })
    const nightContext = makeContext({ playerPosition: [150, 0], isNight: true })

    expect(effectiveDetectionRadius(dayContext)).toBe(135)
    expect(effectiveDetectionRadius(nightContext)).toBeCloseTo(202.5)

    const dayAgent = createMonsterAgent(makeResource({ health: 100 }))
    dayAgent.update(0, 0, dayContext)
    expect(dayAgent.state).toBe('idle')

    const nightAgent = createMonsterAgent(makeResource({ health: 100 }))
    nightAgent.update(0, 0, nightContext)
    expect(nightAgent.state).toBe('chase')

    // 추격 포기 판정도 야간에는 완화된다 (135 × 1.5 × 1.5 ≈ 303.75)
    const chasing = createMonsterAgent(makeResource({ health: 100, activityRadius: 400 }))
    chasing.state = 'chase'
    chasing.update(0, 100, makeContext({ playerPosition: [290, 0], isNight: true }))
    expect(chasing.state).toBe('chase')
    chasing.update(0, 200, makeContext({ playerPosition: [290, 0] }))
    expect(chasing.state).toBe('idle')
  })

  it('applies strength multipliers per model name and defaults to 1 for unknown models', () => {
    const config = {
      modelUrls: Array.from({ length: 7 }, (_, index) => `/${index}.glb`),
      seed: 1,
      count: 100,
      radiusMeters: 100,
      scaleRange: [1, 1] as [number, number],
      patrolRadius: 10,
      speed: 10,
      detectionRadius: 20,
      attackRadius: 5,
      health: 100,
      attackDamage: 10,
      attackCooldownMs: 100,
      activityRadius: 30,
      modelScale: 1,
      hitStunMs: 700,
      // Goblin만 약하게, Demon은 강하게. 미등록 모델(Demon 제외 나머지)은 배율 1.
      strengthMultipliers: { Goblin: 0.5, Giant: 2 } as Record<string, number>,
    }

    const resources = createMonsterResources(config)
    const expectedHealth = (modelName: string) => Math.round(100 * (config.strengthMultipliers[modelName] ?? 1))
    const expectedDamage = (modelName: string) => Math.round(10 * (config.strengthMultipliers[modelName] ?? 1))

    expect(resources.every(resource => resource.health === expectedHealth(resource.modelName))).toBe(true)
    expect(resources.every(resource => resource.maxHealth === expectedHealth(resource.modelName))).toBe(true)
    expect(resources.every(resource => resource.attackDamage === expectedDamage(resource.modelName))).toBe(true)

    // 실제로 약한/강한 개체가 섞여 있는지 확인 (seed=1은 100마리 전 모델 인덱스를 사용)
    expect(resources.some(resource => resource.modelName === 'Goblin' && resource.health === 50)).toBe(true)
    expect(resources.some(resource => resource.modelName === 'Giant' && resource.attackDamage === 20)).toBe(true)
    // 결정론성 유지
    expect(resources).toEqual(createMonsterResources(config))
  })
})

describe('monster agent', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('chases a nearby woodcutting player and attacks on cooldown', () => {
    const onAttackPlayer = vi.fn()
    const context = makeContext({ onAttackPlayer })
    const agent = createMonsterAgent(makeResource())

    agent.update(0, 0, context)
    expect(agent.state).toBe('chase')
    expect(agent.animation).toBe('run')

    agent.update(0, 100, context)
    expect(agent.state).toBe('attack')
    expect(agent.animation).toBe('attack')

    agent.update(0, 1_599, context)
    expect(onAttackPlayer).not.toHaveBeenCalled()

    agent.update(0, 1_600, context)
    expect(onAttackPlayer).toHaveBeenCalledTimes(1)

    agent.update(0, 3_100, context)
    expect(onAttackPlayer).toHaveBeenCalledTimes(2)
  })

  it('abandons a chase when the player stops cutting wood', () => {
    const agent = createMonsterAgent(makeResource())
    agent.state = 'chase'

    agent.update(0, 100, makeContext({ playerIsChopping: false }))

    expect(agent.state).toBe('idle')
    expect(agent.animation).toBe('idle')
  })

  it('enters the terminal death state when health reaches zero', () => {
    const resource = makeResource({ health: 0 })
    const agent = createMonsterAgent(resource)

    agent.update(1, 100, makeContext())

    expect(agent.state).toBe('death')
    expect(agent.animation).toBe('death')

    agent.update(1, 200, makeContext())
    expect(agent.state).toBe('death')
  })

  it('waits, patrols, moves, and returns to idle at its target', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9)
    const agent = createMonsterAgent(makeResource())
    const context = makeContext({ playerIsChopping: false })

    agent.update(3, 0, context)
    expect(agent.state).toBe('idle')
    agent.update(0.1, 100, context)
    expect(agent.state).toBe('patrol')

    agent.position = [0, 0]
    agent.target = [10, 0]
    agent.update(0.5, 200, context)
    expect(agent.position).toEqual([5, 0])

    agent.target = [...agent.position]
    agent.update(0, 300, context)
    expect(agent.state).toBe('idle')
  })

  it('can start chasing while patrolling', () => {
    const agent = createMonsterAgent(makeResource())
    agent.state = 'patrol'
    agent.target = [20, 0]

    agent.update(0, 0, makeContext())

    expect(agent.state).toBe('chase')
  })

  it('walks to a tending target and plants when the timer completes', () => {
    const plant = vi.fn()
    const agent = createMonsterAgent(makeResource(), plant)
    agent.state = 'tendPlants'
    agent.tendTarget = [10, 0]

    agent.update(0.5, 0, makeContext())
    expect(agent.position).toEqual([5, 0])
    expect(agent.animation).toBe('idle')

    agent.position = [10, 0]
    agent.update(1, 1_000, makeContext())
    expect(agent.state).toBe('tendPlants')

    agent.update(3, 4_000, makeContext())
    expect(plant).toHaveBeenCalledWith([10, 0])
    expect(agent.state).toBe('idle')
  })

  it('starts tending from idle and handles missing targets or callbacks', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const plant = vi.fn()
    const tending = createMonsterAgent(makeResource(), plant)
    tending.update(3.1, 0, makeContext({ playerIsChopping: false }))
    expect(tending.state).toBe('tendPlants')

    tending.tendTarget = null
    tending.update(0, 0, makeContext())
    expect(tending.state).toBe('idle')

    const noCallback = createMonsterAgent(makeResource())
    noCallback.update(3.1, 0, makeContext({ playerIsChopping: false }))
    expect(noCallback.state).toBe('patrol')
    noCallback.state = 'tendPlants'
    noCallback.tendTarget = [0, 0]
    noCallback.update(4, 4_000, makeContext())
    expect(noCallback.state).toBe('idle')
  })

  it('continues chasing outside attack range and abandons distant targets', () => {
    const agent = createMonsterAgent(makeResource())
    agent.state = 'chase'
    agent.update(0.5, 100, makeContext({ playerPosition: [25, 0] }))
    expect(agent.state).toBe('chase')
    expect(agent.position).toEqual([5, 0])

    agent.update(0, 200, makeContext({ playerPosition: [250, 0] }))
    expect(agent.state).toBe('idle')
  })

  it('abandons chase when the monster or player leaves its activity area', () => {
    const monsterOutside = createMonsterAgent(makeResource({ activityRadius: 50 }))
    monsterOutside.state = 'chase'
    monsterOutside.position = [60, 0]
    monsterOutside.update(0, 0, makeContext({ playerPosition: [10, 0] }))
    expect(monsterOutside.state).toBe('idle')

    const playerOutside = createMonsterAgent(makeResource({ activityRadius: 50 }))
    playerOutside.state = 'chase'
    playerOutside.update(0, 0, makeContext({ playerPosition: [60, 0] }))
    expect(playerOutside.state).toBe('idle')
  })

  it('returns from attack to chase or idle based on activity bounds', () => {
    const withinBounds = createMonsterAgent(makeResource())
    withinBounds.state = 'attack'
    withinBounds.update(0, 0, makeContext({ playerPosition: [40, 0] }))
    expect(withinBounds.state).toBe('chase')

    const monsterOutside = createMonsterAgent(makeResource({ activityRadius: 30 }))
    monsterOutside.state = 'attack'
    monsterOutside.position = [40, 0]
    monsterOutside.update(0, 0, makeContext({ playerPosition: [0, 0] }))
    expect(monsterOutside.state).toBe('idle')

    const playerOutside = createMonsterAgent(makeResource({ activityRadius: 30 }))
    playerOutside.state = 'attack'
    playerOutside.update(0, 0, makeContext({ playerPosition: [40, 0] }))
    expect(playerOutside.state).toBe('idle')
  })

  it('stops attacking when the player is unavailable', () => {
    const stopped = createMonsterAgent(makeResource())
    stopped.state = 'attack'
    stopped.update(0, 0, makeContext({ playerIsChopping: false }))
    expect(stopped.state).toBe('idle')

    const deadPlayer = createMonsterAgent(makeResource())
    deadPlayer.state = 'attack'
    deadPlayer.update(0, 0, makeContext({ playerAlive: false }))
    expect(deadPlayer.state).toBe('idle')
  })

  it('requires every chase condition while idle', () => {
    const cases = [
      makeContext({ playerAlive: false }),
      makeContext({ playerIsChopping: false }),
      makeContext({ playerPosition: [150, 0] }),
      makeContext({ playerPosition: [60, 0] }),
    ]

    for (const [index, context] of cases.entries()) {
      const resource = index === 3 ? makeResource({ activityRadius: 50 }) : makeResource()
      const agent = createMonsterAgent(resource)
      agent.update(0, 0, context)
      expect(agent.state).toBe('idle')
    }
  })

  it('incoming player hit decrements health and enters hit state', () => {
    const context = makeContext({
      playerIsChopping: true,
      incomingPlayerHits: [{ id: 'monster', damage: 17 }],
    })
    const resource = makeResource({ health: 100, attackCooldownMs: 1_000, position: [0, 0] })
    const agent = createMonsterAgent(resource)
    agent.state = 'attack'

    agent.update(0, 1_000, context)

    expect(resource.health).toBe(83)
    expect(agent.state).toBe('hit')
    expect(agent.animation).toBe('hit')
    expect(agent.hitTimer).toBe(0)
  })

  it('ignores incoming hits aimed at another monster', () => {
    const context = makeContext({
      playerIsChopping: true,
      incomingPlayerHits: [{ id: 'someone-else', damage: 17 }],
    })
    const resource = makeResource({ health: 100, position: [0, 0] })
    const agent = createMonsterAgent(resource)
    agent.state = 'attack'

    agent.update(0, 1_000, context)

    expect(resource.health).toBe(100)
    expect(agent.state).toBe('attack')
  })

  it('exits hit state back to chase after hitStunMs when player is still chopping', () => {
    const hitContext = makeContext({
      playerIsChopping: true,
      incomingPlayerHits: [{ id: 'monster', damage: 17 }],
    })
    const resource = makeResource({ health: 100, attackCooldownMs: 1_000, position: [0, 0] })
    const agent = createMonsterAgent(resource)
    agent.state = 'attack'
    agent.update(0, 1_000, hitContext)
    expect(agent.state).toBe('hit')

    // 씬은 피해 패킷을 1프레임 후 비운다 — 이후 프레임에는 일반 컨텍스트
    const context = makeContext({ playerIsChopping: true })
    agent.update(0.71, 1_500, context)
    expect(agent.state).toBe('chase')
    expect(agent.animation).toBe('run')
  })

  it('transitions directly to death when health reaches zero after a hit', () => {
    const context = makeContext({
      playerIsChopping: true,
      incomingPlayerHits: [{ id: 'monster', damage: 17 }],
    })
    const resource = makeResource({ health: 17, attackCooldownMs: 1_000 })
    const agent = createMonsterAgent(resource)
    agent.state = 'attack'

    agent.update(0, 1_000, context)
    expect(resource.health).toBe(0)
    expect(agent.state).toBe('death')
    expect(agent.animation).toBe('death')

    agent.update(0.5, 1_500, context)
    expect(agent.state).toBe('death')
  })

  it('returns from hit to idle when the player is no longer attacking or fleeing', () => {
    // 먼저 hit 상태로 진입 (player chopping)
    const hitContext = makeContext({
      playerIsChopping: true,
      incomingPlayerHits: [{ id: 'monster', damage: 17 }],
    })
    const resource = makeResource({ health: 100, attackCooldownMs: 1_000, position: [0, 0] })
    const agent = createMonsterAgent(resource)
    agent.state = 'attack'
    agent.update(0, 1_000, hitContext)
    expect(agent.state).toBe('hit')

    // 이후 player chopping 중단 → hit 끝나면 idle
    const idleContext = makeContext({ playerIsChopping: false, playerIsFleeing: false })
    agent.update(0.71, 1_500, idleContext)
    expect(agent.state).toBe('idle')
    expect(agent.animation).toBe('idle')
  })

  it('decrements health and enters hit during chase', () => {
    const context = makeContext({
      playerIsChopping: true,
      incomingPlayerHits: [{ id: 'monster', damage: 17 }],
    })
    const resource = makeResource({ health: 100, attackCooldownMs: 1_000, position: [0, 0] })
    const agent = createMonsterAgent(resource)
    agent.state = 'chase'

    agent.update(0, 1_000, context)
    expect(resource.health).toBe(83)
    expect(agent.state).toBe('hit')
  })

  it('updateHit timer accumulates across frames until stun expires (timer branch)', () => {
    const hitContext = makeContext({
      playerIsChopping: true,
      incomingPlayerHits: [{ id: 'monster', damage: 17 }],
    })
    const resource = makeResource({ health: 100, attackCooldownMs: 1_000, hitStunMs: 700, position: [0, 0] })
    const agent = createMonsterAgent(resource)
    agent.state = 'attack'
    agent.update(0, 1_000, hitContext)
    expect(agent.state).toBe('hit')

    // 씬은 피해 패킷을 1프레임 후 비운다 — 이후 프레임에는 일반 컨텍스트
    const context = makeContext({ playerIsChopping: true })
    // 아직 stun 中 → hit 유지
    agent.update(0.3, 1_300, context)
    expect(agent.state).toBe('hit')
    // stun 끝 → 다음 상태로
    agent.update(0.5, 1_800, context)
    expect(agent.state).not.toBe('hit')
  })
})
