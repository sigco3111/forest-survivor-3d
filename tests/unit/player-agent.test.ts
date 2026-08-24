import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  canWinAgainstThreat,
  createPlayerAgent,
  findNearbyAttackTarget,
  isOutsidePlayerAttackRange,
  isThreatAtMeleeRange,
  isWithinPlayerAttackRange,
  mustFlee,
  shouldFleeThreat,
  type PlayerAgentConfig,
  type PlayerThreatSource,
} from '../../src/game/player/agent'
import type { TreeResource } from '../../src/game/resources/trees'

function makeTree(overrides: Partial<TreeResource> = {}): TreeResource {
  return {
    id: 'tree',
    modelIndex: 0,
    position: [5, 0],
    rotation: 0,
    scale: 1,
    wood: 3,
    noise: 1,
    collected: false,
    ...overrides,
  }
}

function makeConfig(overrides: Partial<PlayerAgentConfig> = {}): PlayerAgentConfig {
  return {
    exploreDistance: 20,
    speed: 10,
    collectRadius: 2,
    chopDurationMs: 500,
    attackRangeMeters: 20,
    attackDamageMs: 600,
    attackCooldownMs: 1500,
    playerAttackDamage: 17,
    worldRadius: 200,
    collisionCheck: () => false,
    treeResources: () => [],
    threatSources: () => [],
    ...overrides,
  }
}

function makeThreat(overrides: Partial<PlayerThreatSource> = {}): PlayerThreatSource {
  return {
    position: [1, 0],
    homePosition: [0, 0],
    activityRadius: 20,
    speed: 10,
    attackRadius: 2,
    ...overrides,
  }
}

describe('player agent', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('approaches, chops, and collects a nearby tree', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    vi.spyOn(performance, 'now').mockReturnValue(100)
    const tree = makeTree()
    const agent = createPlayerAgent([0, 0], makeConfig({ treeResources: () => [tree] }))

    agent.update(0, 0)
    expect(agent.state).toBe('approaching')

    agent.update(0, 50)
    expect(agent.state).toBe('approaching')

    agent.position = [4, 0]
    agent.update(0, 100)
    expect(agent.state).toBe('chopping')

    agent.update(0, 600)
    expect(tree.collected).toBe(true)
    expect(agent.woodCollected).toBe(3)
    expect(agent.lastCollectedTree).toBe(tree)
    expect(agent.state).toBe('exploring')
  })

  it('recovers when a target tree disappears or is already collected', () => {
    const agent = createPlayerAgent([0, 0], makeConfig())
    agent.state = 'approaching'
    agent.activeTree = null
    agent.update(0, 0)
    expect(agent.state).toBe('exploring')

    agent.state = 'approaching'
    agent.activeTree = makeTree({ collected: true })
    agent.update(0, 0)
    expect(agent.activeTree).toBeNull()

    agent.state = 'chopping'
    agent.update(0, 0)
    expect(agent.state).toBe('exploring')
  })

  it('does nothing after the player dies', () => {
    const agent = createPlayerAgent([0, 0], makeConfig())
    agent.playerAlive = false
    const position = [...agent.position]

    agent.update(10, 10_000)

    expect(agent.position).toEqual(position)
  })

  it('moves, handles collisions, and chooses a new exploration target', () => {
    const collisionCheck = vi.fn(() => false)
    const agent = createPlayerAgent([0, 0], makeConfig({ collisionCheck }))
    agent.target = [10, 0]
    agent.update(0.5, 0)
    expect(agent.position).toEqual([5, 0])

    collisionCheck.mockReturnValue(true)
    agent.target = [10, 0]
    agent.update(0.5, 0)
    expect(agent.position).toEqual([5, 0])

    agent.target = [...agent.position]
    agent.update(0, 0)
    expect(agent.state).toBe('exploring')
  })

  it('flees active threats, remembers repeated danger, and later forgets it', () => {
    // player를 위협 attackRangeMeters(20) 밖, activityRadius 안에서 시작.
    // woodCount=0으로 설정해 canWinAgainstThreat=false 보장 → 도망.
    let threats: PlayerThreatSource[] = [makeThreat({ activityRadius: 200 })]
    const agent = createPlayerAgent([30, 0], makeConfig({ threatSources: () => threats }))
    agent.woodCollected = 0

    agent.update(0, 100)
    expect(agent.state).toBe('fleeing')
    expect(agent.failedAreaAttempt?.count).toBe(1)

    agent.target = [0, 0]
    agent.update(0, 150)
    expect(agent.target).not.toEqual([0, 0])

    agent.state = 'exploring'
    agent.update(0, 200)
    expect(agent.avoidedAreas).toHaveLength(1)
    expect(agent.failedAreaAttempt).toBeNull()

    threats = []
    agent.position = [...agent.target]
    agent.update(0, 300)
    expect(agent.state).toBe('exploring')

    agent.update(0, 50_000)
    expect(agent.avoidedAreas).toHaveLength(0)
  })

  it('continues chopping when a distant slow threat cannot arrive in time', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const tree = makeTree({ position: [0, 0] })
    const threat = makeThreat({ position: [100, 0], speed: 1, activityRadius: 200 })
    let threats: PlayerThreatSource[] = []
    const agent = createPlayerAgent(
      [0, 0],
      makeConfig({ treeResources: () => [tree], threatSources: () => threats }),
    )
    // woodCount를 충분히 설정해 canWinAgainstThreat=true → 도망 안 함
    agent.woodCollected = 100

    agent.update(0, 0)
    agent.update(0, 0)
    expect(agent.state).toBe('chopping')

    threats = [threat]
    agent.update(0, 490)
    expect(agent.state).toBe('chopping')
    expect(agent.choppingProgress).toBeCloseTo(0.98)
  })

  it('falls back to its current position when every target collides', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const agent = createPlayerAgent([3, 4], makeConfig({ collisionCheck: () => true }))
    expect(agent.target).toEqual([3, 4])
  })

  it('clamps exploration targets to the world boundary', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const agent = createPlayerAgent([190, 0], makeConfig({ worldRadius: 200 }))
    expect(Math.hypot(...agent.target)).toBeLessThanOrEqual(144)
  })

  it('filters trees inside remembered danger areas', () => {
    const dangerTree = makeTree({ id: 'danger', position: [1, 0] })
    const safeTree = makeTree({ id: 'safe', position: [10, 0] })
    const agent = createPlayerAgent(
      [0, 0],
      makeConfig({ treeResources: () => [dangerTree, safeTree] }),
    )
    agent.avoidedAreas = [{ center: [0, 0], radius: 5, expiresAt: 10_000 }]

    agent.update(0, 100)

    expect(agent.activeTree).toBe(safeTree)
  })

  it('ignores threats outside their area and keeps the nearest active threat', () => {
    const outside = makeThreat({ position: [1, 0], homePosition: [100, 0], activityRadius: 5 })
    const near = makeThreat({ position: [22, 0], activityRadius: 30 })
    const farther = makeThreat({ position: [30, 0], activityRadius: 30 })
    const agent = createPlayerAgent(
      [0, 0],
      makeConfig({ threatSources: () => [outside, near, farther] }),
    )
    // woodCount=0으로 도망 발동 보장
    agent.woodCollected = 0

    agent.update(0, 0)

    expect(agent.state).toBe('fleeing')
  })

  it('uses exploration fallback when every flee route is blocked', () => {
    // player를 위협 attackRange 밖 (30)+ activityRadius 안에서 시작, woodCount=0으로 도망 보장
    const threat = makeThreat({ position: [1, 0], homePosition: [0, 0], activityRadius: 30, attackRadius: 2 })
    const agent = createPlayerAgent(
      [30, 0],
      makeConfig({ collisionCheck: () => true, threatSources: () => [threat] }),
    )
    agent.woodCollected = 0

    agent.update(0, 0)

    expect(agent.state).toBe('fleeing')
    expect(agent.target).toEqual([30, 0])

    let collisionCalls = 0
    const outwardAgent = createPlayerAgent([30, 0], makeConfig({
      collisionCheck: () => collisionCalls++ < 16,
      threatSources: () => [threat],
    }))
    outwardAgent.woodCollected = 0
    collisionCalls = 0
    outwardAgent.update(0, 0)
    // distance=29, attackRange=20 (player 공격 사거리 밖). activityRadius=30 안.
    // fallback [30+36, 0]=[66,0]가 activityRadius=30 밖 → fallback 사용 → [66,0]
    expect(outwardAgent.target).toEqual([66, 0])
  })

  it('transitions chopping into attacking when a threat is inside attackRangeMeters', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const tree = makeTree({ position: [1, 0] })
    const onAttackMonster = vi.fn()
    // threat가 attackRange 안 + attackRadius 안 이므로 chopping 즉시 attacking 전환
    const threat = makeThreat({ id: 'm1', position: [5, 0], homePosition: [0, 0], activityRadius: 50, speed: 1, attackRadius: 20 })
    const agent = createPlayerAgent(
      [0, 0],
      makeConfig({
        attackRangeMeters: 10,
        attackDamageMs: 500,
        attackCooldownMs: 1000,
        playerAttackDamage: 17,
        onAttackMonster,
        treeResources: () => [tree],
        threatSources: () => [threat],
      }),
    )

    agent.update(0, 0)
    // chopping 진입 시도하지만 threat가 attackRange 안이라 곧바로 attacking 진입
    agent.update(0, 0)
    expect(agent.state).toBe('attacking')
    expect(agent.attackTarget).toBe(threat)
    expect(agent.activeTree).toBeNull()
    expect(agent.animation).toBe('attack')
    expect(onAttackMonster).not.toHaveBeenCalled()
  })

  it('fires onAttackMonster after the attackDamageMs + attackCooldownMs window elapses', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const onAttackMonster = vi.fn()
    const threat = makeThreat({ id: 'm1', position: [5, 0], homePosition: [0, 0], activityRadius: 50, speed: 1, attackRadius: 20 })
    const agent = createPlayerAgent(
      [0, 0],
      makeConfig({
        attackRangeMeters: 10,
        attackDamageMs: 500,
        attackCooldownMs: 1000,
        playerAttackDamage: 17,
        onAttackMonster,
        threatSources: () => [threat],
      }),
    )
    agent.update(0, 0)
    agent.update(0, 0)
    expect(agent.state).toBe('attacking')

    agent.update(0, 1499)
    expect(onAttackMonster).not.toHaveBeenCalled()

    agent.update(0, 1500)
    expect(onAttackMonster).toHaveBeenCalledTimes(1)
    expect(onAttackMonster).toHaveBeenCalledWith('m1', 17)
  })

  it('respects attackCooldownMs between swings', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const onAttackMonster = vi.fn()
    const threat = makeThreat({ id: 'm1', position: [5, 0], homePosition: [0, 0], activityRadius: 50, speed: 1, attackRadius: 20 })
    const agent = createPlayerAgent(
      [0, 0],
      makeConfig({
        attackRangeMeters: 10,
        attackDamageMs: 500,
        attackCooldownMs: 1000,
        playerAttackDamage: 17,
        onAttackMonster,
        threatSources: () => [threat],
      }),
    )
    agent.update(0, 0)
    agent.update(0, 0)
    agent.update(0, 1500)
    expect(onAttackMonster).toHaveBeenCalledTimes(1)

    agent.update(0, 1700)
    expect(onAttackMonster).toHaveBeenCalledTimes(1)

    agent.update(0, 3000)
    expect(onAttackMonster).toHaveBeenCalledTimes(2)
  })

  it('exits attacking when the target leaves attackRangeMeters', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const farThreat = makeThreat({ id: 'm1', position: [50, 0], homePosition: [0, 0], activityRadius: 100, attackRadius: 20 })
    const nearThreat = makeThreat({ id: 'm2', position: [5, 0], homePosition: [0, 0], activityRadius: 100, attackRadius: 20 })
    let threats: PlayerThreatSource[] = []
    const agent = createPlayerAgent(
      [0, 0],
      makeConfig({
        attackRangeMeters: 10,
        attackDamageMs: 500,
        attackCooldownMs: 1000,
        playerAttackDamage: 17,
        onAttackMonster: vi.fn(),
        threatSources: () => threats,
      }),
    )

    threats = [nearThreat]
    agent.update(0, 0)
    expect(agent.state).toBe('attacking')

    threats = [farThreat]
    agent.update(0, 100)
    expect(agent.state).toBe('exploring')
    expect(agent.attackTarget).toBeNull()
  })

  it('does not flee while attacking even when a fast threat is inside attackRadius', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const onAttackMonster = vi.fn()
    const threat = makeThreat({ id: 'm1', position: [5, 0], homePosition: [0, 0], activityRadius: 50, speed: 1, attackRadius: 20 })
    const agent = createPlayerAgent(
      [0, 0],
      makeConfig({
        attackRangeMeters: 10,
        attackDamageMs: 500,
        attackCooldownMs: 1000,
        playerAttackDamage: 17,
        onAttackMonster,
        threatSources: () => [threat],
      }),
    )
    agent.update(0, 0)
    agent.update(0, 0)
    expect(agent.state).toBe('attacking')

    agent.update(0, 200)
    expect(agent.state).toBe('attacking')
  })

  it('does not flee a threat while chopping when the threat cannot arrive in time (chop branch)', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const tree = makeTree({ position: [0, 0] })
    // 먼저 위협 없이 chopping 진입, 이후 멀고 느린 위협을 추가하여 chop 가지 계산 발동
    let threats: PlayerThreatSource[] = []
    const agent = createPlayerAgent(
      [0, 0],
      makeConfig({ treeResources: () => [tree], threatSources: () => threats }),
    )
    // woodCount 충분히 설정해 canWinAgainstThreat=true → 도망 안 함 가지 진행
    agent.woodCollected = 100
    agent.update(0, 0)
    agent.update(0, 0)
    expect(agent.state).toBe('chopping')

    threats = [makeThreat({ position: [500, 0], homePosition: [500, 0], activityRadius: 1_000, speed: 1, attackRadius: 20 })]
    agent.update(0, 100)
    expect(agent.state).toBe('chopping')
  })

  it('findNearbyAttackTarget skips threats outside activityRadius and beyond attackRange', () => {
    // 두 위협 모두 매칭 불가 - farHome은 활동 반경 밖, tooFar는 attackRange 밖
    // 하지만 tooFar는 활동 반경 안이라 findActiveThreat에 잡힘 → fleeing
    // 매칭 가능한 위협이 없는 별도 시나리오 검증: 활동 반경이 작고 position이 attackRange 밖
    const neutralThreat = makeThreat({ id: 'neutral', position: [100, 0], homePosition: [100, 0], activityRadius: 5, attackRadius: 5 })
    const agent = createPlayerAgent(
      [0, 0],
      makeConfig({
        attackRangeMeters: 10,
        attackDamageMs: 500,
        attackCooldownMs: 1_000,
        playerAttackDamage: 17,
        onAttackMonster: vi.fn(),
        threatSources: () => [neutralThreat],
      }),
    )
    agent.update(0, 0)
    expect(agent.state).toBe('exploring')
    expect(agent.attackTarget).toBeNull()
  })

  it('shouldFleeThreat with wood=0 returns true for distant threats regardless of state', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    // 위협 멀리 (attackRange=20 밖) + woodCount=0 → 도망
    const threat = makeThreat({ position: [30, 0], homePosition: [0, 0], activityRadius: 100, attackRadius: 2 })
    const config = makeConfig()
    const choppingAgent = createPlayerAgent([0, 0], config)
    choppingAgent.state = 'chopping'
    choppingAgent.woodCollected = 0
    expect(shouldFleeThreat(choppingAgent, 0, threat, config)).toBe(true)
    const exploringAgent = createPlayerAgent([0, 0], config)
    exploringAgent.state = 'exploring'
    exploringAgent.woodCollected = 0
    expect(shouldFleeThreat(exploringAgent, 0, threat, config)).toBe(true)
    const approachingAgent = createPlayerAgent([0, 0], config)
    approachingAgent.state = 'approaching'
    approachingAgent.woodCollected = 0
    expect(shouldFleeThreat(approachingAgent, 0, threat, config)).toBe(true)
  })

  it('shouldFleeThreat with wood>0 returns false for distant threats (no auto-flee)', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    // 위협 멀리 + woodCount 충분히 설정 → 도망 안 함
    const threat = makeThreat({ position: [30, 0], homePosition: [0, 0], activityRadius: 100, attackRadius: 2 })
    const config = makeConfig()
    const exploringAgent = createPlayerAgent([0, 0], config)
    exploringAgent.woodCollected = 100
    expect(shouldFleeThreat(exploringAgent, 0, threat, config)).toBe(false)
    const approachingAgent = createPlayerAgent([0, 0], config)
    approachingAgent.woodCollected = 100
    expect(shouldFleeThreat(approachingAgent, 0, threat, config)).toBe(false)
  })

  it('shouldFleeThreat returns false for fleeing and attacking states (early returns)', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const threat = makeThreat({ position: [10, 0], homePosition: [0, 0], activityRadius: 100, attackRadius: 2 })
    const config = makeConfig()
    const fleeingAgent = createPlayerAgent([0, 0], config)
    fleeingAgent.state = 'fleeing'
    expect(shouldFleeThreat(fleeingAgent, 0, threat, config)).toBe(false)
    const attackingAgent = createPlayerAgent([0, 0], config)
    attackingAgent.state = 'attacking'
    expect(shouldFleeThreat(attackingAgent, 0, threat, config)).toBe(false)
  })

  it('shouldFleeThreat returns false when threat is inside its own attackRadius (commit to melee)', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    // player and threat both at [0,0], threat attackRadius=20 → distanceToThreat=0 <= 20 → return false
    const threat = makeThreat({ position: [0, 0], homePosition: [0, 0], activityRadius: 100, attackRadius: 20 })
    const config = makeConfig()
    const agent = createPlayerAgent([0, 0], config)
    agent.state = 'exploring'
    expect(shouldFleeThreat(agent, 0, threat, config)).toBe(false)
  })

  it('canWinAgainstThreat returns true when wood > 0 and false when wood is zero', () => {
    const threat = makeThreat()
    const winningAgent = createPlayerAgent([0, 0], makeConfig())
    winningAgent.woodCollected = 1
    expect(canWinAgainstThreat(winningAgent, threat)).toBe(true)
    const losingAgent = createPlayerAgent([0, 0], makeConfig())
    losingAgent.woodCollected = 0
    expect(canWinAgainstThreat(losingAgent, threat)).toBe(false)
  })

  it('mustFlee mirrors canWinAgainstThreat (true when wood is zero)', () => {
    const threat = makeThreat()
    const winningAgent = createPlayerAgent([0, 0], makeConfig())
    winningAgent.woodCollected = 50
    expect(mustFlee(winningAgent, threat)).toBe(false)
    const losingAgent = createPlayerAgent([0, 0], makeConfig())
    losingAgent.woodCollected = 0
    expect(mustFlee(losingAgent, threat)).toBe(true)
  })

  it('isThreatAtMeleeRange covers both branches', () => {
    expect(isThreatAtMeleeRange(5, 10)).toBe(true)
    expect(isThreatAtMeleeRange(15, 10)).toBe(false)
  })

  it('isWithinPlayerAttackRange covers both branches', () => {
    expect(isWithinPlayerAttackRange(15, 20)).toBe(true)
    expect(isWithinPlayerAttackRange(25, 20)).toBe(false)
  })

  it('isOutsidePlayerAttackRange covers both branches', () => {
    expect(isOutsidePlayerAttackRange(25, 20)).toBe(true)
    expect(isOutsidePlayerAttackRange(15, 20)).toBe(false)
  })

  it('findNearbyAttackTarget covers isCloserThreat branch via the test fixture', () => {
    // 두 위협으로 closestDistance 가지 발동 (true 가지)
    const far = makeThreat({ id: 'far', position: [8, 0], homePosition: [0, 0], activityRadius: 50, attackRadius: 20 })
    const near = makeThreat({ id: 'near', position: [3, 0], homePosition: [0, 0], activityRadius: 50, attackRadius: 20 })
    const config = makeConfig({
      attackRangeMeters: 10,
      attackDamageMs: 500,
      attackCooldownMs: 1_000,
      playerAttackDamage: 17,
      onAttackMonster: vi.fn(),
      threatSources: () => [far, near],
    })
    const agent = createPlayerAgent([0, 0], config)
    expect(findNearbyAttackTarget(agent, config)?.id).toBe('near')
    // 단일 위협 (nearestDistance Infinity → true 가지 발동)
    const singleConfig = { ...config, threatSources: () => [near] }
    expect(findNearbyAttackTarget(agent, singleConfig)?.id).toBe('near')
    // 두 위협 모두 같은 거리 (false 가지 - nearestDistance 교체 안 됨)
    const same = makeThreat({ id: 'same', position: [3, 0], homePosition: [0, 0], activityRadius: 50, attackRadius: 20 })
    const tiedConfig = { ...config, threatSources: () => [near, same] }
    expect(findNearbyAttackTarget(agent, tiedConfig)?.id).toBeDefined()
  })

  it('updateAttacking tolerates a target whose id is undefined', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const onAttackMonster = vi.fn()
    const threat: PlayerThreatSource = {
      position: [5, 0],
      homePosition: [0, 0],
      activityRadius: 50,
      speed: 1,
      attackRadius: 20,
    }
    const agent = createPlayerAgent(
      [0, 0],
      makeConfig({
        attackRangeMeters: 10,
        attackDamageMs: 500,
        attackCooldownMs: 1_000,
        playerAttackDamage: 17,
        onAttackMonster,
        threatSources: () => [threat],
      }),
    )
    agent.update(0, 0)
    expect(agent.state).toBe('attacking')
    agent.update(0, 1_500)
    expect(onAttackMonster).not.toHaveBeenCalled()
  })

  it('findNearbyAttackTarget prefers the closer of multiple in-range threats', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const onAttackMonster = vi.fn()
    const far = makeThreat({ id: 'far', position: [8, 0], homePosition: [0, 0], activityRadius: 50, attackRadius: 20 })
    const near = makeThreat({ id: 'near', position: [3, 0], homePosition: [0, 0], activityRadius: 50, attackRadius: 20 })
    const agent = createPlayerAgent(
      [0, 0],
      makeConfig({
        attackRangeMeters: 10,
        attackDamageMs: 500,
        attackCooldownMs: 1_000,
        playerAttackDamage: 17,
        onAttackMonster,
        threatSources: () => [far, near],
      }),
    )
    agent.update(0, 0)
    expect(agent.attackTarget?.id).toBe('near')
  })

  it('updateAttacking recovers from missing attackTarget', () => {
    const threat = makeThreat({ id: 'm1', position: [5, 0], homePosition: [0, 0], activityRadius: 50, attackRadius: 20 })
    const agent = createPlayerAgent(
      [0, 0],
      makeConfig({
        attackRangeMeters: 10,
        attackDamageMs: 500,
        attackCooldownMs: 1000,
        playerAttackDamage: 17,
        onAttackMonster: vi.fn(),
        threatSources: () => [threat],
      }),
    )
    agent.update(0, 0)
    expect(agent.state).toBe('attacking')
    // attackTarget을 수동으로 제거한 다음 update → !attackTarget 가지 실행
    ;(agent as { attackTarget: PlayerThreatSource | null }).attackTarget = null
    agent.update(0, 100)
    expect(agent.state).toBe('exploring')
    expect(agent.attackTarget).toBeNull()
  })
})
