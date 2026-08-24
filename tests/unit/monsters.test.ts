import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  canReceivePlayerHit,
  createMonsterAgent,
  createMonsterResources,
  createRespawnMonster,
  effectiveDetectionRadius,
  isWithinAttackReach,
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

  it('decrements health and enters hit state when player is inside playerAttackRange', () => {
    const context = makeContext({
      playerAttackRange: 25,
      playerAttackDamage: 17,
      playerIsChopping: true,
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

  it('exits hit state back to chase after hitStunMs when player is still chopping', () => {
    const context = makeContext({
      playerAttackRange: 25,
      playerAttackDamage: 17,
      playerIsChopping: true,
    })
    const resource = makeResource({ health: 100, attackCooldownMs: 1_000, position: [0, 0] })
    const agent = createMonsterAgent(resource)
    agent.state = 'attack'
    agent.update(0, 1_000, context)
    expect(agent.state).toBe('hit')

    agent.update(0.71, 1_500, context)
    expect(agent.state).toBe('chase')
    expect(agent.animation).toBe('run')
  })

  it('transitions directly to death when health reaches zero after a hit', () => {
    const context = makeContext({
      playerAttackRange: 25,
      playerAttackDamage: 17,
      playerIsChopping: true,
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

  it('does not decrement health when playerAttackRange is zero (existing behavior preserved)', () => {
    const context = makeContext({ playerIsChopping: true })
    const resource = makeResource({ health: 100, attackCooldownMs: 1_000 })
    const agent = createMonsterAgent(resource)
    agent.state = 'attack'

    agent.update(0, 1_000, context)
    expect(resource.health).toBe(100)
    expect(agent.state).toBe('attack')
  })

  it('returns from hit to idle when the player is no longer attacking or fleeing', () => {
    // 먼저 hit 상태로 진입 (player chopping)
    const hitContext = makeContext({
      playerAttackRange: 25,
      playerAttackDamage: 17,
      playerIsChopping: true,
    })
    const resource = makeResource({ health: 100, attackCooldownMs: 1_000, position: [0, 0] })
    const agent = createMonsterAgent(resource)
    agent.state = 'attack'
    agent.update(0, 1_000, hitContext)
    expect(agent.state).toBe('hit')

    // 이후 player chopping 중단 → hit 끝나면 idle
    const idleContext = makeContext({
      playerAttackRange: 25,
      playerAttackDamage: 17,
      playerIsChopping: false,
      playerIsFleeing: false,
    })
    agent.update(0.71, 1_500, idleContext)
    expect(agent.state).toBe('idle')
    expect(agent.animation).toBe('idle')
  })

  it('decrements health and enters hit during chase when playerAttackRange is reached', () => {
    const context = makeContext({
      playerAttackRange: 25,
      playerAttackDamage: 17,
      playerIsChopping: true,
    })
    const resource = makeResource({ health: 100, attackCooldownMs: 1_000, position: [0, 0] })
    const agent = createMonsterAgent(resource)
    agent.state = 'chase'

    agent.update(0, 1_000, context)
    expect(resource.health).toBe(83)
    expect(agent.state).toBe('hit')
  })

  it('tryReceivePlayerHit returns false when playerAttackDamage is zero', () => {
    const context = makeContext({
      playerAttackRange: 25,
      playerAttackDamage: 0,
      playerIsChopping: true,
    })
    const resource = makeResource({ health: 100, attackCooldownMs: 1_000, position: [0, 0] })
    const agent = createMonsterAgent(resource)
    agent.state = 'attack'

    agent.update(0, 1_000, context)
    expect(resource.health).toBe(100)
    expect(agent.state).toBe('attack')
  })

  it('tryReceivePlayerHit returns false when playerAttackRange is zero (range guard)', () => {
    const context = makeContext({
      playerAttackRange: 0,
      playerAttackDamage: 17,
      playerIsChopping: true,
    })
    const resource = makeResource({ health: 100, attackCooldownMs: 1_000, position: [0, 0] })
    const agent = createMonsterAgent(resource)
    agent.state = 'attack'

    agent.update(0, 1_000, context)
    expect(resource.health).toBe(100)
    expect(agent.state).toBe('attack')
  })

  it('tryReceivePlayerHit returns false when playerAttackDamage is zero (damage guard)', () => {
    const context = makeContext({
      playerAttackRange: 25,
      playerAttackDamage: 0,
      playerIsChopping: true,
    })
    const resource = makeResource({ health: 100, attackCooldownMs: 1_000, position: [0, 0] })
    const agent = createMonsterAgent(resource)
    agent.state = 'attack'

    agent.update(0, 1_000, context)
    expect(resource.health).toBe(100)
    expect(agent.state).toBe('attack')
  })

  it('tryReceivePlayerHit returns false when player is outside playerAttackRange (distance guard)', () => {
    // playerAttackRange=5, player position [50,0] (기본 distToPlayer>5)
    // activityRadius=200 안에, attackRadius 작게 → chase 가지 안 빠짐
    const context = makeContext({
      playerPosition: [50, 0],
      playerAttackRange: 5,
      playerAttackDamage: 17,
      playerIsChopping: true,
    })
    const resource = makeResource({
      health: 100,
      attackCooldownMs: 1_000,
      position: [0, 0],
      homePosition: [0, 0],
      activityRadius: 200,
    })
    const agent = createMonsterAgent(resource)
    agent.state = 'attack'

    agent.update(0, 1_000, context)
    expect(resource.health).toBe(100)
  })

  it('isWithinAttackReach and canReceivePlayerHit cover all guard branches', () => {
    const resource = makeResource({ attackCooldownMs: 1_000 })
    const agent = createMonsterAgent(resource)
    // distance 안 → true
    expect(isWithinAttackReach(5, 10)).toBe(true)
    // distance 밖 → false
    expect(isWithinAttackReach(15, 10)).toBe(false)
    // range=0 → false
    expect(canReceivePlayerHit(0, 17, 5, 0, agent)).toBe(false)
    // damage=0 → false
    expect(canReceivePlayerHit(10, 0, 5, 0, agent)).toBe(false)
    // distance 밖 → false
    expect(canReceivePlayerHit(10, 17, 15, 0, agent)).toBe(false)
    // 쿨다운 중 → false
    expect(canReceivePlayerHit(10, 17, 5, 500, agent)).toBe(false)
    // 모든 조건 통과 → true
    expect(canReceivePlayerHit(10, 17, 5, 1_500, agent)).toBe(true)
  })

  it('updateHit timer accumulates across frames until stun expires (timer branch)', () => {
    const context = makeContext({
      playerAttackRange: 25,
      playerAttackDamage: 17,
      playerIsChopping: true,
    })
    const resource = makeResource({ health: 100, attackCooldownMs: 1_000, hitStunMs: 700, position: [0, 0] })
    const agent = createMonsterAgent(resource)
    agent.state = 'attack'
    agent.update(0, 1_000, context)
    expect(agent.state).toBe('hit')

    // 아직 stun 中 → hit 유지
    agent.update(0.3, 1_300, context)
    expect(agent.state).toBe('hit')
    // stun 끝 → 다음 상태로
    agent.update(0.5, 1_800, context)
    expect(agent.state).not.toBe('hit')
  })

  it('tryReceivePlayerHit respects attackCooldownMs', () => {
    const context = makeContext({
      playerAttackRange: 25,
      playerAttackDamage: 17,
      playerIsChopping: true,
    })
    const resource = makeResource({ health: 200, attackCooldownMs: 1_000, position: [0, 0] })
    const agent = createMonsterAgent(resource)
    agent.state = 'attack'

    agent.update(0, 1_000, context)
    expect(agent.state).toBe('hit')
    expect(resource.health).toBe(183)
    // 쿨다운 중 → 공격 무시
    agent.state = 'attack'
    agent.lastAttackTime = 1_000
    agent.update(0, 1_500, context)
    expect(resource.health).toBe(183)
    expect(agent.state).toBe('attack')
    // 쿨다운 지난 후 다시
    agent.update(0, 2_100, context)
    expect(resource.health).toBe(166)
    expect(agent.state).toBe('hit')
  })
})
