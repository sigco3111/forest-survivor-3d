import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  canWinAgainstThreat,
  computePlayerPower,
  computeThreatStrength,
  createPlayerAgent,
  findPreyTarget,
  isHostileThreat,
  isOutsidePlayerAttackRange,
  isThreatAtMeleeRange,
  isThreatWeakerThanPlayer,
  isWithinPlayerAttackRange,
  mustFlee,
  shouldFleeThreat,
  type PlayerAgentConfig,
  type PlayerThreatSource,
} from '../../src/game/player/agent'
import type { PlanePoint } from '../../src/game/resources/trees'
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
    playerMaxHealth: 100,
    killHealHealth: 15,
    playerBasePower: 40,
    powerPerWood: 1,
    monsterHealthPowerWeight: 0.35,
    monsterAttackPowerWeight: 1.5,
    huntAggroRangeMultiplier: 4,
    huntGiveUpRangeMultiplier: 6,
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

  it('tracks health: damage reduces hp and kills the player at zero', () => {
    const agent = createPlayerAgent([0, 0], makeConfig())
    expect(agent.health).toBe(100)
    expect(agent.maxHealth).toBe(100)

    agent.applyDamage(30)
    expect(agent.health).toBe(70)
    expect(agent.playerAlive).toBe(true)

    // 체력 0 도달 → 사망 플래그
    agent.applyDamage(70)
    expect(agent.health).toBe(0)
    expect(agent.playerAlive).toBe(false)

    // 이미 죽은 상태에서 추가 피격 → 0 클램프 유지
    agent.applyDamage(50)
    expect(agent.health).toBe(0)
  })

  it('applyKillHeal restores health up to maxHealth', () => {
    const agent = createPlayerAgent([0, 0], makeConfig())

    agent.applyDamage(40)
    expect(agent.health).toBe(60)

    agent.applyKillHeal()
    expect(agent.health).toBe(75)

    // 최대치 clamp: 여러 번 회복해도 maxHealth를 넘지 않는다
    agent.applyKillHeal()
    agent.applyKillHeal()
    agent.applyKillHeal()
    expect(agent.health).toBe(100)
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
    // player를 공격 사거리(20) * 1.5(30) 밖, activityRadius 안에서 시작.
    // woodCount=0 → canWinAgainstThreat=false 보장 → 도망.
    let threats: PlayerThreatSource[] = [makeThreat({ activityRadius: 200 })]
    const agent = createPlayerAgent([40, 0], makeConfig({ threatSources: () => threats }))
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
    // 체력 미지정 위협 = 전투력 ∞ (강한 적). 스캔 범위 80 밖이라 도망/사냥 모두 발동하지 않음
    const threat = makeThreat({ position: [100, 0], speed: 1, activityRadius: 200 })
    let threats: PlayerThreatSource[] = []
    const agent = createPlayerAgent(
      [0, 0],
      makeConfig({ treeResources: () => [tree], threatSources: () => threats }),
    )
    // woodCount를 충분히 설정해 전투력을 높인다
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
    const near = makeThreat({ position: [40, 0], activityRadius: 100 })
    const farther = makeThreat({ position: [60, 0], activityRadius: 100 })
    const agent = createPlayerAgent(
      [0, 0],
      makeConfig({ threatSources: () => [outside, near, farther] }),
    )
    // woodCount=0이고 적이 30m 밖 → 도망
    agent.woodCollected = 0

    agent.update(0, 0)

    expect(agent.state).toBe('fleeing')
  })

  it('uses exploration fallback when every flee route is blocked', () => {
    // player를 공격 사거리(20)*1.5(30) 밖 + activityRadius 안에서 시작, woodCount=0으로 도망 보장
    const threat = makeThreat({ position: [1, 0], homePosition: [0, 0], activityRadius: 50, attackRadius: 2 })
    const agent = createPlayerAgent(
      [40, 0],
      makeConfig({ collisionCheck: () => true, threatSources: () => [threat] }),
    )
    agent.woodCollected = 0

    agent.update(0, 0)

    expect(agent.state).toBe('fleeing')
    expect(agent.target).toEqual([40, 0])

    let collisionCalls = 0
    const outwardAgent = createPlayerAgent([40, 0], makeConfig({
      collisionCheck: () => collisionCalls++ < 16,
      threatSources: () => [threat],
    }))
    outwardAgent.woodCollected = 0
    collisionCalls = 0
    outwardAgent.update(0, 0)
    // distance=39, aggressiveRange=30 (player 공격 사거리 밖). activityRadius=50 안.
    // fallback [40+36, 0]=[76,0]가 activityRadius=50 밖 → fallback 사용 → [76,0]
    expect(outwardAgent.target).toEqual([76, 0])
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
    // woodCount 충분히 설정해 전투력 우위 → 도망 판단 없이 chop 가지 진행
    agent.woodCollected = 100
    agent.update(0, 0)
    agent.update(0, 0)
    expect(agent.state).toBe('chopping')

    threats = [makeThreat({ position: [500, 0], homePosition: [500, 0], activityRadius: 1_000, speed: 1, attackRadius: 20 })]
    agent.update(0, 100)
    expect(agent.state).toBe('chopping')
  })

  it('flees while chopping when the chop cannot finish before a fast threat arrives (chop branch true)', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const tree = makeTree({ position: [0, 0] })
    let threats: PlayerThreatSource[] = []
    const agent = createPlayerAgent(
      [0, 0],
      makeConfig({ treeResources: () => [tree], threatSources: () => threats }),
    )
    agent.woodCollected = 100
    agent.update(0, 0)
    agent.update(0, 0)
    expect(agent.state).toBe('chopping')

    // 강하고 매우 빠른 적이 30m 거리에서 접근: 남은 벌목 시간보다 도달이 빠름 → 도망
    threats = [makeThreat({ position: [30, 0], homePosition: [0, 0], activityRadius: 1_000, speed: 200, attackRadius: 2 })]
    agent.update(0.001, 100)
    expect(agent.state).toBe('fleeing')
  })

  it('findPreyTarget skips dead, stronger, out-of-area and out-of-scan threats', () => {
    const config = makeConfig({ threatSources: () => [] })
    const agent = createPlayerAgent([0, 0], config)
    agent.woodCollected = 100 // 전투력 140: 체력 140/공격력 14(전투력 70)까지 사냥 가능

    const dead = makeThreat({ id: 'dead', position: [5, 0], homePosition: [0, 0], activityRadius: 50, health: 0 })
    const stronger = makeThreat({ id: 'stronger', position: [6, 0], homePosition: [0, 0], activityRadius: 50, health: 500, attackDamage: 50 })
    const outOfArea = makeThreat({ id: 'outOfArea', position: [7, 0], homePosition: [100, 0], activityRadius: 5, health: 10 })
    const outOfScan = makeThreat({ id: 'outOfScan', position: [90, 0], homePosition: [90, 0], activityRadius: 200, health: 10 })
    expect(findPreyTarget(agent, { ...config, threatSources: () => [dead] })).toBeNull()
    expect(findPreyTarget(agent, { ...config, threatSources: () => [stronger] })).toBeNull()
    expect(findPreyTarget(agent, { ...config, threatSources: () => [outOfArea] })).toBeNull()
    expect(findPreyTarget(agent, { ...config, threatSources: () => [outOfScan] })).toBeNull()

    const prey = makeThreat({ id: 'prey', position: [15, 0], homePosition: [0, 0], activityRadius: 50, health: 65, attackDamage: 7 })
    expect(findPreyTarget(agent, { ...config, threatSources: () => [dead, stronger, outOfArea, outOfScan, prey] })?.id).toBe('prey')
  })

  it('findPreyTarget prefers the nearest beatable threat (isCloserThreat branches)', () => {
    const config = makeConfig({
      threatSources: () => [
        makeThreat({ id: 'far', position: [8, 0], homePosition: [0, 0], activityRadius: 50, health: 10 }),
        makeThreat({ id: 'near', position: [3, 0], homePosition: [0, 0], activityRadius: 50, health: 10 }),
      ],
    })
    const agent = createPlayerAgent([0, 0], makeConfig())
    // near(3m)가 먼저 교체되고 far(8m)는 isCloserThreat false 가지
    expect(findPreyTarget(agent, config)?.id).toBe('near')

    // 단일 위협 (nearestDistance Infinity → true 가지)
    const singleConfig = {
      ...config,
      threatSources: () => [makeThreat({ id: 'near', position: [3, 0], homePosition: [0, 0], activityRadius: 50, health: 10 })],
    }
    expect(findPreyTarget(agent, singleConfig)?.id).toBe('near')

    // 같은 거리 두 위협 (false 가지 - 첫 번째 유지)
    const tiedConfig = {
      ...config,
      threatSources: () => [
        makeThreat({ id: 'first', position: [3, 0], homePosition: [0, 0], activityRadius: 50, health: 10 }),
        makeThreat({ id: 'second', position: [3, 0], homePosition: [0, 0], activityRadius: 50, health: 10 }),
      ],
    }
    expect(findPreyTarget(agent, tiedConfig)?.id).toBe('first')
  })

  it('hunts down a weaker enemy that is inside scan range but outside attack range', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const prey = makeThreat({ id: 'goblin', position: [40, 0], homePosition: [0, 0], activityRadius: 100, speed: 1, attackRadius: 2, health: 30 })
    const onAttackMonster = vi.fn()
    const agent = createPlayerAgent(
      [0, 0],
      makeConfig({
        threatSources: () => [prey],
        onAttackMonster,
      }),
    )

    // 스캔 범위(80) 안 + 공격 사거리(20) 밖 → hunting 상태로 추격 시작
    agent.update(0.001, 0)
    expect(agent.state).toBe('hunting')
    expect(agent.attackTarget?.id).toBe('goblin')
    expect(agent.animation).toBe('walk')

    // 추격: 매 프레임 대상을 향해 이동한다 (사거리 25m 유지)
    agent.position = [65, 0]
    agent.update(0.5, 100)
    expect(agent.state).toBe('hunting')
    expect(agent.position[0]).toBeLessThan(65)

    // 사거리 진입 → attacking 전환
    agent.position = [55, 0]
    agent.update(0, 200)
    expect(agent.state).toBe('attacking')
    expect(onAttackMonster).not.toHaveBeenCalled() // 아직 스윙 윈도우 전
  })

  it('breaks off a flee to counter-attack when only weaker enemies remain hostile', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const chaser = makeThreat({ id: 'goblin', position: [18, 0], homePosition: [0, 0], activityRadius: 200, speed: 1, attackRadius: 2, health: 30 })
    const agent = createPlayerAgent([30, 0], makeConfig({ threatSources: () => [chaser] }))
    agent.state = 'fleeing'

    agent.update(0, 100)

    // 약한 적뿐이면 도망을 멈추고 되받아친다
    expect(agent.state).toBe('attacking')
    expect(agent.attackTarget?.id).toBe('goblin')
  })

  it('abandons a hunt when a stronger hostile shows up', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const prey = makeThreat({ id: 'goblin', position: [40, 0], homePosition: [30, 0], activityRadius: 100, speed: 1, health: 30 })
    let giant: PlayerThreatSource | null = makeThreat({ id: 'giant', position: [50, 0], homePosition: [50, 0], activityRadius: 100, speed: 30 })
    const threats = () => (giant ? [prey, giant] : [prey])
    const agent = createPlayerAgent([0, 0], makeConfig({ threatSources: threats }))

    // 첫 업데이트: 강한 거인이 활동 반경 안에 있고 도망 조건 충족 → 사냥보다 도망 우선
    agent.update(0, 0)
    expect(agent.state).toBe('fleeing')

    // 거인이 떠나면 같은 고블린을 다시 사냥한다 (사거리 35m → 추격)
    giant = null
    agent.position = [5, 0]
    agent.update(0, 1_000)
    expect(agent.state).toBe('hunting')
    expect(agent.attackTarget?.id).toBe('goblin')
  })

  it('ignores strong monsters that are not hostile (idle patrols never trigger fleeing)', () => {
    const patroller = makeThreat({
      id: 'giant',
      position: [60, 0],
      homePosition: [50, 0],
      activityRadius: 200,
      speed: 30,
      hostile: false,
    })
    const agent = createPlayerAgent([0, 0], makeConfig({ threatSources: () => [patroller] }))

    agent.update(0, 0)

    // 강한 적이지만 쫓아오지 않는 한 도망하지 않는다
    expect(agent.state).toBe('exploring')
    expect(agent.attackTarget).toBeNull()
  })

  it('gives up a hunt when the prey escapes the give-up range', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    let preyPosition: PlanePoint = [40, 0]
    const prey = () => [makeThreat({ id: 'goblin', position: [preyPosition[0], preyPosition[1]], homePosition: [0, 0], activityRadius: 500, speed: 1, health: 30 })]
    const agent = createPlayerAgent([0, 0], makeConfig({ threatSources: prey }))
    agent.update(0, 0)
    expect(agent.state).toBe('hunting')

    // 포기 범위(공격 사거리 20 × 6 = 120) 밖으로 도주 → 사냥 종료
    preyPosition = [150, 0]
    agent.update(0, 100)
    expect(agent.state).toBe('exploring')
    expect(agent.attackTarget).toBeNull()
  })

  it('stops fighting when the current target dies and flees when it becomes too strong', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    let goblinHealth = 30
    const goblin = () => [makeThreat({ id: 'goblin', position: [40, 0], homePosition: [0, 0], activityRadius: 500, speed: 1, health: goblinHealth })]
    const agent = createPlayerAgent([0, 0], makeConfig({ threatSources: goblin }))
    agent.update(0, 0)
    expect(agent.state).toBe('hunting')

    // 대상 사망 → 전투 종료
    goblinHealth = 0
    agent.update(0, 100)
    expect(agent.state).toBe('exploring')

    // 대상이 갑자기 강해지면(무리 합류 등) 더 붙지 않고 도망한다
    goblinHealth = 900
    agent.update(0, 200)
    expect(agent.state).toBe('fleeing')
  })

  it('switches from attacking back to hunting when the wounded target retreats out of range', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    let goblinPosition: PlanePoint = [10, 0]
    const goblin = () => [makeThreat({ id: 'goblin', position: [goblinPosition[0], goblinPosition[1]], homePosition: [0, 0], activityRadius: 500, speed: 1, attackRadius: 2, health: 30 })]
    const onAttackMonster = vi.fn()
    const config = makeConfig({
      attackRangeMeters: 20,
      attackDamageMs: 500,
      attackCooldownMs: 1_000,
      playerAttackDamage: 17,
      onAttackMonster,
      threatSources: goblin,
    })
    const agent = createPlayerAgent([0, 0], config)
    agent.update(0, 0)
    expect(agent.state).toBe('attacking')

    // 표적이 사거리(20) 밖으로 물러남. 포기 범위(120) 안 + 여전히 약함 → exploring이 아니라 추격(hunting) 전환
    goblinPosition = [45, 0]
    agent.update(0, 100)
    expect(agent.state).toBe('hunting')
    expect(agent.attackTarget?.id).toBe('goblin')

    // 추격 중 표적이 포기 범위 밖으로 완전히 이탈하면 전투를 종료한다
    goblinPosition = [250, 0]
    agent.update(0, 200)
    expect(agent.state).toBe('exploring')
    expect(agent.attackTarget).toBeNull()
  })

  it('keeps pursuing into attack range even after leaving the prey activity area', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    // 고블린의 활동 반경이 좁아서 추격하다 보면 플레이어가 반경 밖으로 나간다
    const goblin = () => [makeThreat({ id: 'goblin', position: [40, 0], homePosition: [0, 0], activityRadius: 25, speed: 1, attackRadius: 2, health: 30 })]
    const config = makeConfig({ threatSources: goblin })
    const agent = createPlayerAgent([0, 0], config)

    agent.update(0, 0)
    expect(agent.state).toBe('hunting')

    // 플레이어가 활동 반경(25) 밖까지 추격해 왔지만 표적은 사거리 안
    agent.position = [38, 0]
    agent.update(0, 100)
    expect(agent.state).toBe('attacking')
    expect(agent.attackTarget?.id).toBe('goblin')
  })

  it('disengages when an attack target retreats beyond the give-up range or turns strong', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    let goblinHealth = 30
    let goblinPosition: PlanePoint = [10, 0]
    const goblin = () => [makeThreat({ id: 'goblin', position: [goblinPosition[0], goblinPosition[1]], homePosition: [0, 0], activityRadius: 500, speed: 1, attackRadius: 2, health: goblinHealth })]
    const config = makeConfig({
      attackRangeMeters: 20,
      threatSources: goblin,
    })
    const agent = createPlayerAgent([0, 0], config)
    agent.update(0, 0)
    expect(agent.state).toBe('attacking')

    // 포기 범위(120) 밖으로 도주 → 전투 종료
    goblinPosition = [200, 0]
    agent.update(0, 100)
    expect(agent.state).toBe('exploring')

    // 포기 범위 안에 돌아와도 더 이상 약하지 않으면 붙지 않는다 → resolve 단계에서 도망 전환
    goblinPosition = [30, 0]
    goblinHealth = 900
    agent.update(0, 200)
    expect(agent.state).toBe('fleeing')
    expect(agent.attackTarget).toBeNull()
  })

  it('registers a failed area attempt once per encounter instead of every frame', () => {
    const threat = makeThreat({ position: [40, 0], homePosition: [0, 0], activityRadius: 200, speed: 30, attackRadius: 2 })
    const agent = createPlayerAgent([0, 0], makeConfig({ threatSources: () => [threat] }))
    agent.woodCollected = 0

    agent.update(0, 100)
    expect(agent.state).toBe('fleeing')
    expect(agent.failedAreaAttempt?.count).toBe(1)

    // 도망 지속 중에는 카운트가 증가하지 않는다
    agent.update(0, 200)
    agent.update(0, 300)
    expect(agent.failedAreaAttempt?.count).toBe(1)
  })

  it('ends a flee when only non-hostile monsters remain nearby', () => {
    const patroller = makeThreat({
      id: 'patrol',
      position: [55, 0],
      homePosition: [50, 0],
      activityRadius: 200,
      speed: 30,
      hostile: false,
    })
    const agent = createPlayerAgent([50, 0], makeConfig({ threatSources: () => [patroller] }))

    // 도망 상태에서 적대적인 몬스터가 모두 사라진 경우: 비적대 개체는 무시하고 바로 복귀한다
    agent.state = 'fleeing'
    agent.target = [50, 0]
    agent.update(0.001, 100)

    expect(agent.state).toBe('exploring')
  })

  it('shouldFleeThreat returns true for distant unknown-health threats regardless of state', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    // 위협 멀리 (attackRange=20 밖) + 체력 미지정(전투력 ∞) → 도망
    const threat = makeThreat({ position: [30, 0], homePosition: [0, 0], activityRadius: 100, attackRadius: 2 })
    const config = makeConfig()
    const choppingAgent = createPlayerAgent([0, 0], config)
    choppingAgent.state = 'chopping'
    expect(shouldFleeThreat(choppingAgent, 0, threat, config)).toBe(true)
    const exploringAgent = createPlayerAgent([0, 0], config)
    exploringAgent.state = 'exploring'
    expect(shouldFleeThreat(exploringAgent, 0, threat, config)).toBe(true)
    const approachingAgent = createPlayerAgent([0, 0], config)
    approachingAgent.state = 'approaching'
    expect(shouldFleeThreat(approachingAgent, 0, threat, config)).toBe(true)
  })

  it('shouldFleeThreat returns false for distant weaker threats (no auto-flee)', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    // 체력 50 → 전투력 17.5, 플레이어 기본 전투력 40보다 약함 → 도망 안 함
    const threat = makeThreat({ position: [30, 0], homePosition: [0, 0], activityRadius: 100, attackRadius: 2, health: 50 })
    const config = makeConfig()
    const exploringAgent = createPlayerAgent([0, 0], config)
    exploringAgent.state = 'exploring'
    expect(shouldFleeThreat(exploringAgent, 0, threat, config)).toBe(false)
    const approachingAgent = createPlayerAgent([0, 0], config)
    approachingAgent.state = 'approaching'
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

  it('canWinAgainstThreat uses the power comparison (base + wood vs health/damage weights)', () => {
    const config = makeConfig()
    // 고블린형: 체력 65/공격력 7 → 전투력 65*0.35 + 7*1.5 = 33.25 < 기본 전투력 40 → 처음부터 이김
    const goblin = makeThreat({ health: 65, attackDamage: 7 })
    const freshAgent = createPlayerAgent([0, 0], config)
    expect(canWinAgainstThreat(freshAgent, goblin, config)).toBe(true)
    // 거인형: 체력 140/공격력 14 → 전투력 70 → 나무 30개까지는 못 이기고(동점은 패배), 31개부터 이김
    const giant = makeThreat({ health: 140, attackDamage: 14 })
    const losingAgent = createPlayerAgent([0, 0], config)
    losingAgent.woodCollected = 30
    expect(canWinAgainstThreat(losingAgent, giant, config)).toBe(false)
    losingAgent.woodCollected = 31
    expect(canWinAgainstThreat(losingAgent, giant, config)).toBe(true)
    // 체력 정보가 없는 위협은 전투력 ∞ → 나무가 아무리 많아도 못 이김으로 간주
    const unknownThreat = makeThreat()
    const richAgent = createPlayerAgent([0, 0], config)
    richAgent.woodCollected = 9_999
    expect(canWinAgainstThreat(richAgent, unknownThreat, config)).toBe(false)
  })

  it('mustFlee mirrors canWinAgainstThreat', () => {
    const config = makeConfig()
    const weakThreat = makeThreat({ health: 10 })
    const strongThreat = makeThreat({ health: 500, attackDamage: 50 })
    const agent = createPlayerAgent([0, 0], config)
    expect(mustFlee(agent, weakThreat, config)).toBe(false)
    expect(mustFlee(agent, strongThreat, config)).toBe(true)
  })

  it('computePlayerPower and computeThreatStrength follow the configured weights', () => {
    const config = makeConfig()
    const agent = createPlayerAgent([0, 0], config)
    expect(computePlayerPower(agent, config)).toBe(40)
    agent.woodCollected = 12
    expect(computePlayerPower(agent, config)).toBe(52)

    // 체력*0.35 + 공격력*1.5
    expect(computeThreatStrength(makeThreat({ health: 100, attackDamage: 10 }), config)).toBeCloseTo(35 + 15)
    // 공격력 미지정 → 체력 항만 계산
    expect(computeThreatStrength(makeThreat({ health: 100 }), config)).toBeCloseTo(35)
    // 체력 미지정 → 알 수 없는 위협은 ∞
    expect(computeThreatStrength(makeThreat(), config)).toBe(Number.POSITIVE_INFINITY)

    const goblin = makeThreat({ health: 65, attackDamage: 7 })
    expect(isThreatWeakerThanPlayer(agent, goblin, config)).toBe(true)
    const giant = makeThreat({ health: 140, attackDamage: 14 })
    expect(isThreatWeakerThanPlayer(agent, giant, config)).toBe(false)
  })

  it('isHostileThreat defaults to hostile and respects the hostile flag', () => {
    expect(isHostileThreat(makeThreat())).toBe(true)
    expect(isHostileThreat(makeThreat({ hostile: false }))).toBe(false)
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

  it('engages combat even with low wood when threat is within aggressive range', () => {
    // 적이 공격 사거리(20) 안 + 활동 반경 안이면 wood가 거의 없어도 전투 진입
    const threat = makeThreat({ id: 'near', position: [15, 0], homePosition: [0, 0], activityRadius: 200, attackRadius: 2, attackDamage: 10 })
    const config = makeConfig({ threatSources: () => [threat] })
    const agent = createPlayerAgent([0, 0], config)
    agent.woodCollected = 1 // 한 번 공격에 죽지만 가까우면 전투 진입
    agent.update(0, 0)
    expect(agent.state).toBe('attacking')
  })

  it('fights back when a stronger enemy closes inside its attack radius (cornered)', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const onAttackMonster = vi.fn()
    // 체력 미지정 = 전투력 ∞ (강한 적). attackRadius(20) 안으로 들어왔지만
    // 플레이어 공격 사거리(10) 밖인 위치 [15,0] → 도망 대신 추격을 걸어 붙는다
    const threat = makeThreat({ id: 'giant', position: [15, 0], homePosition: [0, 0], activityRadius: 50, speed: 1, attackRadius: 20 })
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
    expect(agent.state).toBe('hunting')
    expect(agent.attackTarget?.id).toBe('giant')

    // 사거리 안까지 접근한 뒤에는 공격 전환
    agent.position = [8, 0]
    agent.update(0, 100)
    expect(agent.state).toBe('attacking')
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

  it('engages the nearest threat when multiple strong enemies crowd into melee range', () => {
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
