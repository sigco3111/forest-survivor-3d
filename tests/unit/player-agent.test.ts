import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  canWinAgainstThreat,
  computePlayerPower,
  computeThreatStrength,
  createPlayerAgent,
  expForLevel,
  findPreyTarget,
  findSeekTarget,
  isHostileThreat,
  isOutsidePlayerAttackRange,
  isPlayerCritical,
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
    regenHealthAmount: 2,
    regenIntervalMs: 1000,
    criticalHealthRatio: 0.25,
    expBase: 100,
    expGrowth: 1.6,
    levelAttackBonus: 3,
    levelHealthBonus: 20,
    levelSpeedBonus: 1,
    huntScanRangePerLevel: 20,
    upgradeCostBase: 30,
    upgradeCostGrowth: 1.5,
    weaponAttackPerTier: 6,
    weaponPowerPerTier: 40,
    reserveWood: 10,
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

  it('regenerates health on a cadence while out of combat and pauses during combat', () => {
    const agent = createPlayerAgent([0, 0], makeConfig())
    agent.applyDamage(30)
    expect(agent.health).toBe(70)

    // 탐색 중: 600ms는 틱 간격(1000ms) 미만 → 회복 없음
    agent.update(0.6, 0)
    expect(agent.health).toBe(70)

    // 누적 1100ms → 틱 도달, +2 회복
    agent.update(0.5, 600)
    expect(agent.health).toBe(72)

    // 이미 만 피 → clamp
    agent.health = agent.maxHealth
    agent.update(1.2, 1_100)
    expect(agent.health).toBe(agent.maxHealth)

    // 전투(공격) 중에는 회복 타이머 리셋 → 회복 없음
    agent.health = 50
    agent.state = 'attacking'
    agent.attackTarget = makeThreat({ id: 'm1', position: [5, 0], homePosition: [0, 0], activityRadius: 50, attackRadius: 20 })
    agent.update(2, 2_000)
    expect(agent.health).toBe(50)
    expect(agent.regenTimer).toBe(0)
  })

  it('addExperience levels up and boosts attack/health/speed', () => {
    const config = makeConfig()
    const agent = createPlayerAgent([0, 0], config)
    expect(agent.level).toBe(1)
    expect(agent.attackDamage).toBe(17)

    // 기준치 미만 → 레벨 유지, 경험치만 누적
    agent.addExperience(50)
    expect(agent.level).toBe(1)
    expect(agent.exp).toBe(50)

    // 100 도달 → 레벨 2: 공격 +3, 최대체력 +20(동시 회복), 속도 +1
    agent.addExperience(50)
    expect(agent.level).toBe(2)
    expect(agent.exp).toBe(0)
    expect(agent.attackDamage).toBe(20)
    expect(agent.maxHealth).toBe(120)
    expect(agent.health).toBe(120)
    expect(config.speed).toBe(11)

    // 이미 만 피격 상태에서 레벨업 → 최대치 clamp 가지
    agent.applyDamage(0)
    agent.health = 115
    agent.addExperience(160) // 2→3 레벨 기준치
    expect(agent.level).toBe(3)
    expect(agent.health).toBe(135) // min(140, 115+20)
    expect(agent.attackDamage).toBe(23)
  })

  it('expForLevel follows the configured growth curve', () => {
    const config = makeConfig()
    expect(expForLevel(1, config)).toBe(100)
    expect(expForLevel(2, config)).toBe(160)
    expect(expForLevel(3, config)).toBe(256)
  })

  it('upgradeWeapon spends wood and permanently boosts attack and power', () => {
    const config = makeConfig()
    const agent = createPlayerAgent([0, 0], config)
    expect(agent.weaponTier).toBe(0)
    expect(agent.nextUpgradeCost()).toBe(30)

    // 나무 부족 → 강화 실패, 상태 불변
    agent.woodCollected = 10
    expect(agent.upgradeWeapon()).toBe(false)
    expect(agent.weaponTier).toBe(0)

    // 비상 비축(10)을 남기는지 검증: 강화 후 9가 남는 39는 거절
    agent.woodCollected = 39
    expect(agent.upgradeWeapon()).toBe(false)
    expect(agent.weaponTier).toBe(0)
    expect(agent.woodCollected).toBe(39)

    // 강화 성공: 나무 30 소비, 비축 10 정확히 남김 (경계값 포함), 공격 +6, 전투력 가중 +40
    agent.woodCollected = 40
    expect(agent.upgradeWeapon()).toBe(true)
    expect(agent.weaponTier).toBe(1)
    expect(agent.woodCollected).toBe(10)
    expect(agent.attackDamage).toBe(23) // 17 + 6
    expect(agent.weaponPower).toBe(40)
    expect(agent.nextUpgradeCost()).toBe(45) // 30 × 1.5
  })

  it('auto-upgrades the weapon every frame while wood affords it (reserve kept)', () => {
    const config = makeConfig()
    const agent = createPlayerAgent([0, 0], config)
    agent.woodCollected = 100

    agent.update(0, 0)

    // 30 소비(잔여 70) → 45 소비(잔여 25, 비축 10 이상) → 다음 68은 비축 미달 → 정지
    expect(agent.weaponTier).toBe(2)
    expect(agent.woodCollected).toBe(25)
    expect(agent.attackDamage).toBe(29) // 17 + 6×2
    expect(agent.weaponPower).toBe(80)
  })

  it('computePlayerPower includes the weapon contribution', () => {
    const config = makeConfig()
    const agent = createPlayerAgent([0, 0], config)
    agent.woodCollected = 20
    agent.weaponPower = 80
    expect(computePlayerPower(agent, config)).toBe(40 + 20 + 80)
  })

  it('findSeekTarget picks the nearest weaker enemy worldwide', () => {
    const config = makeConfig({ threatSources: () => [] })
    const agent = createPlayerAgent([0, 0], config)

    const dead = makeThreat({ id: 'dead', position: [10, 0], homePosition: [0, 0], activityRadius: 1, health: 0 })
    const stronger = makeThreat({ id: 'stronger', position: [12, 0], homePosition: [0, 0], activityRadius: 1, health: 900 })
    // 스캔 범위(80)와 활동 반경을 전부 벗어난 원거리 사냥감 — seek는 이것도 잡는다
    const farPrey = makeThreat({ id: 'farPrey', position: [400, 0], homePosition: [400, 0], activityRadius: 50, health: 30 })
    const nearPrey = makeThreat({ id: 'nearPrey', position: [200, 0], homePosition: [200, 0], activityRadius: 50, health: 30 })
    const tiedPrey = makeThreat({ id: 'tiedPrey', position: [0, 200], homePosition: [0, 200], activityRadius: 50, health: 30 })

    expect(findSeekTarget(agent, { ...config, threatSources: () => [dead] })).toBeNull()
    expect(findSeekTarget(agent, { ...config, threatSources: () => [stronger] })).toBeNull()
    // 동거리 타이 → isCloserThreat false 가지, 먼저 나온 nearPrey 유지
    expect(findSeekTarget(agent, { ...config, threatSources: () => [dead, stronger, farPrey, nearPrey, tiedPrey] })?.id).toBe('nearPrey')
  })

  it('exploring drifts toward the nearest weaker enemy instead of wandering', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const prey = makeThreat({ id: 'goblin', position: [300, 0], homePosition: [300, 0], activityRadius: 50, speed: 1, health: 30 })
    const agent = createPlayerAgent([0, 0], makeConfig({ threatSources: () => [prey] }))
    agent.target = [0, 0] // 도착 상태로 만들어 탐색 재선택을 유도

    agent.update(0.001, 0)

    // 무작위 탐색 지점이 아니라 사냥감 위치를 향해 진행한다 (아직 스캔 범위 밖이라 hunting 아님)
    expect(agent.state).toBe('exploring')
    expect(agent.target).toEqual([300, 0])
  })

  it('widens the prey scan range as the level grows', () => {
    const config = makeConfig({ threatSources: () => [] })
    const agent = createPlayerAgent([0, 0], config)
    const prey = makeThreat({ id: 'prey', position: [100, 0], homePosition: [0, 0], activityRadius: 200, health: 30 })

    // 레벨 1: 스캔 80 → 밖
    expect(findPreyTarget(agent, { ...config, threatSources: () => [prey] })).toBeNull()

    // 레벨 3: 스캔 80 + 2×20 = 120 → 잡힘
    agent.level = 3
    expect(findPreyTarget(agent, { ...config, threatSources: () => [prey] })?.id).toBe('prey')
  })

  it('isPlayerCritical marks health at or below the configured ratio', () => {
    const config = makeConfig()
    const agent = createPlayerAgent([0, 0], config)

    agent.health = 25 // 100 × 0.25 → 경계값 포함
    expect(isPlayerCritical(agent, config)).toBe(true)
    agent.health = 26
    expect(isPlayerCritical(agent, config)).toBe(false)
  })

  it('breaks off an ongoing fight and flees when health turns critical', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const threat = makeThreat({ id: 'm1', position: [5, 0], homePosition: [0, 0], activityRadius: 100, speed: 1, attackRadius: 20, health: 30 })
    const config = makeConfig({ attackRangeMeters: 10, threatSources: () => [threat] })
    const agent = createPlayerAgent([0, 0], config)
    agent.woodCollected = 100 // 전투력 우위 → 평소엔 싸움

    agent.update(0, 0)
    expect(agent.state).toBe('attacking')

    // 체력 20%로 급락 → 교전 즉시 이탈 후 도주
    agent.health = 20
    agent.update(0, 100)
    expect(agent.state).toBe('fleeing')

    // 위기 체력에서 표적 없는 공격 상태면 그냥 전투를 종료한다 (break-off null-target 가지)
    agent.state = 'attacking'
    agent.attackTarget = null
    agent.update(0, 200)
    expect(agent.state).toBe('exploring')
  })

  it('breaks off a hunt when health turns critical', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const prey = makeThreat({ id: 'goblin', position: [40, 0], homePosition: [0, 0], activityRadius: 500, speed: 1, health: 30 })
    const agent = createPlayerAgent([0, 0], makeConfig({ threatSources: () => [prey] }))

    agent.update(0, 0)
    expect(agent.state).toBe('hunting')

    agent.health = 20
    agent.update(0, 100)
    expect(agent.state).toBe('fleeing')
  })

  it('flees from any hostile threat while critical, even a beatable one', () => {
    const chaser = makeThreat({ id: 'goblin', position: [15, 0], homePosition: [0, 0], activityRadius: 200, speed: 1, attackRadius: 2, health: 10 })
    const config = makeConfig({ threatSources: () => [chaser] })
    const agent = createPlayerAgent([0, 0], config)
    agent.woodCollected = 100 // 이길 수 있어도 위기 체력에선 도주
    agent.health = 20

    agent.update(0, 0)

    expect(agent.state).toBe('fleeing')
  })

  it('does not start new fights or seek prey while critical', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    // 비적대(배회 중) 사냥감이 스캔 범위 안에 있어도 위기 체력에선 교전하지 않는다
    const prey = makeThreat({ id: 'goblin', position: [15, 0], homePosition: [0, 0], activityRadius: 200, speed: 1, attackRadius: 2, health: 10, hostile: false })
    const agent = createPlayerAgent([0, 0], makeConfig({ threatSources: () => [prey] }))
    agent.woodCollected = 100
    agent.health = 20

    agent.update(0, 0)

    expect(agent.state).toBe('exploring')
    expect(agent.attackTarget).toBeNull()
  })

  it('stops seeking prey while critical', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const prey = makeThreat({ id: 'goblin', position: [300, 0], homePosition: [300, 0], activityRadius: 50, speed: 1, health: 10, hostile: false })
    const agent = createPlayerAgent([0, 0], makeConfig({ threatSources: () => [prey] }))
    agent.health = 20
    agent.target = [0, 0]

    agent.update(0.001, 0)

    // 사냥 직행 대신 무작위 탐색 지점을 고른다
    expect(agent.state).toBe('exploring')
    expect(agent.target).not.toEqual([300, 0])
  })

  it('steers around obstacles blocking the straight path', () => {
    const agent = createPlayerAgent([0, 0], makeConfig({
      // 정면(x축 라인)만 막힘: 우회 각도로는 통과 가능
      collisionCheck: position => position[1] === 0 && position[0] > 0,
    }))
    agent.target = [10, 0]
    agent.update(0.5, 0)

    // 직진 [5,0]은 막혔지만 우회에 성공해 z축으로 벗어난 위치로 이동
    expect(agent.position).not.toEqual([0, 0])
    expect(agent.position[1]).not.toBe(0)
  })

  it('gives up a tree when every direction is blocked while approaching', () => {
    const tree = makeTree({ position: [30, 0] })
    const agent = createPlayerAgent([0, 0], makeConfig({
      collisionCheck: () => true,
      treeResources: () => [tree],
    }))
    agent.state = 'approaching'
    agent.activeTree = tree
    agent.update(0.5, 0)

    expect(agent.state).toBe('exploring')
    expect(agent.activeTree).toBeNull()
  })

  it('abandons combat when fully blocked while hunting', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const prey = makeThreat({ id: 'goblin', position: [40, 0], homePosition: [0, 0], activityRadius: 200, speed: 1, health: 30 })
    const agent = createPlayerAgent([0, 0], makeConfig({
      collisionCheck: () => true,
      threatSources: () => [prey],
    }))

    agent.update(0, 0)
    // resolve가 사냥을 시작해도 이동이 막히면 같은 프레임에 전투를 종료한다
    expect(agent.state).toBe('exploring')
    expect(agent.attackTarget).toBeNull()
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
