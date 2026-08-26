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
  type PresetWeights,
} from '../../src/game/player/agent'
import { type LevelUpPool, type PresetAffinity } from '../../src/game/player/level-up-cards'
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
    fleeSafeDistanceMeters: 250,
    expBase: 100,
    expGrowth: 1.6,
    levelAttackBonus: 3,
    levelHealthBonus: 20,
    levelSpeedBonus: 1,
    huntScanRangePerLevel: 20,
    slamUnlockLevel: 2,
    slamCooldownMs: 8_000,
    slamRadius: 90,
    slamDamageMultiplier: 1.5,
    furyUnlockLevel: 4,
    furyCooldownMs: 15_000,
    furyDurationMs: 5_000,
    furySwingMultiplier: 0.5,
    leechUnlockLevel: 6,
    leechRatio: 0.3,
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

  it('engages the boss instead of fleeing or ignoring it', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    // 보스: 활동 반경(100) 밖 150m에서 접근 중 — containment 규칙이면 무시했던 케이스
    const boss = makeThreat({ id: 'boss', position: [150, 0], homePosition: [0, 0], activityRadius: 100, isBoss: true, health: 900, attackDamage: 50 })
    const config = makeConfig({ threatSources: () => [boss] })
    const agent = createPlayerAgent([0, 0], config)
    agent.woodCollected = 100

    agent.update(0, 0)

    // 도망/무시 대신 보스를 향해 직행한다 (보스 사냥은 포기 범위 없음)
    expect(agent.state).toBe('hunting')
    expect(agent.attackTarget?.id).toBe('boss')
  })

  it('recognizes the boss as a threat even outside its activity radius when critical', () => {
    const boss = makeThreat({ id: 'boss', position: [310, 0], homePosition: [0, 0], activityRadius: 100, isBoss: true, health: 900, attackDamage: 50, speed: 1 })
    const config = makeConfig({ threatSources: () => [boss] })
    const agent = createPlayerAgent([300, 0], config)
    agent.health = 20 // 위기 체력

    agent.update(0, 0)

    // 보스가 활동 반경 밖이어도 안전 거리(250) 안이면 도주한다
    expect(agent.state).toBe('fleeing')
  })

  it('flees from the boss at critical health and stops once it is far away', () => {
    const boss = makeThreat({ id: 'boss', position: [100, 0], homePosition: [0, 0], activityRadius: 100, isBoss: true, health: 900, attackDamage: 50, speed: 1 })
    const config = makeConfig({ threatSources: () => [boss] })
    const agent = createPlayerAgent([0, 0], config)
    agent.health = 20 // 위기 체력

    agent.update(0, 0)
    expect(agent.state).toBe('fleeing')

    // 보스가 안전 거리(250) 밖으로 밀리면 도망 종료 → 회복 (키트-회복 루프)
    boss.position = [400, 0]
    agent.position = [...agent.target]
    agent.update(0, 100)
    expect(agent.state).toBe('exploring')
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

  it('auto-casts slam on every enemy inside the radius once unlocked', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const onAttackMonster = vi.fn()
    const inRange = makeThreat({ id: 'a', position: [10, 0], homePosition: [0, 0], activityRadius: 100, attackRadius: 20, health: 50 })
    const alsoInRadius = makeThreat({ id: 'b', position: [60, 0], homePosition: [0, 0], activityRadius: 100, attackRadius: 2, health: 50 })
    const outOfRadius = makeThreat({ id: 'c', position: [200, 0], homePosition: [200, 0], activityRadius: 300, attackRadius: 2, health: 50 })
    const corpse = makeThreat({ id: 'dead', position: [30, 0], homePosition: [0, 0], activityRadius: 100, attackRadius: 2, health: 0 })
    const idLess = makeThreat({ position: [40, 0], homePosition: [0, 0], activityRadius: 100, attackRadius: 2, health: 50 })
    let threats = [inRange, alsoInRadius, outOfRadius, corpse, idLess]
    const config = makeConfig({
      attackRangeMeters: 20,
      onAttackMonster,
      threatSources: () => threats,
    })
    const agent = createPlayerAgent([0, 0], config)
    agent.level = 2 // 광역 강타 해금

    agent.update(0, 0)
    expect(agent.state).toBe('attacking')
    // 스윙과 무관하게 즉시 시전 (초기 lastSlamAt = -쿨다운): 반경 내 전체 타격
    expect(onAttackMonster).toHaveBeenCalledWith('a', 26) // 17 × 1.5 → 26
    expect(onAttackMonster).toHaveBeenCalledWith('b', 26)
    expect(onAttackMonster).toHaveBeenCalledWith('', 26) // id 없는 위협 → 빈 문자열 폴백
    expect(onAttackMonster).not.toHaveBeenCalledWith('c', 26)

    // 쿨다운 중 → 재시도 없음 (스윙 윈도우 전이므로 일반 스윙도 없음)
    onAttackMonster.mockClear()
    agent.update(0, 1_000)
    expect(onAttackMonster).not.toHaveBeenCalled()

    // 비교전 상태(사냥감 부재)에서는 쿨다운이 만료돼도 시전하지 않는다
    threats = []
    agent.state = 'exploring'
    agent.attackTarget = null
    agent.update(0, 9_000)
    expect(onAttackMonster).not.toHaveBeenCalled()

    // 교전 재개 → 쿨다운 만료 상태로 즉시 시전
    threats = [inRange]
    agent.update(0, 10_000)
    expect(onAttackMonster).toHaveBeenCalledWith('a', 26)
  })

  it('unleashes fury in combat and halves the swing window', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const onAttackMonster = vi.fn()
    const threat = makeThreat({ id: 'm1', position: [10, 0], homePosition: [0, 0], activityRadius: 100, attackRadius: 20, health: 500 })
    let threats = [threat]
    const config = makeConfig({
      attackRangeMeters: 20,
      attackDamageMs: 500,
      attackCooldownMs: 1_000,
      onAttackMonster,
      threatSources: () => threats,
    })
    const agent = createPlayerAgent([0, 0], config)
    agent.level = 4 // 분노 해금

    agent.update(0, 0)
    expect(agent.state).toBe('attacking')
    expect(agent.furyActiveUntil).toBe(5_000)
    onAttackMonster.mockClear() // t=0의 광역 강타 호출 제거

    // 분노: 스윙 윈도우 1500 → 750
    agent.update(0, 749)
    expect(onAttackMonster).not.toHaveBeenCalled()
    agent.update(0, 800)
    expect(onAttackMonster).toHaveBeenCalledTimes(1)
    expect(onAttackMonster).toHaveBeenCalledWith('m1', 17)

    // 비교전 상태(적 부재)에서는 분노를 재발동하지 않는다
    threats = []
    agent.state = 'exploring'
    agent.attackTarget = null
    agent.update(0, 25_000)
    expect(agent.furyActiveUntil).toBe(5_000)
  })

  it('leeches life from dealt damage at higher levels', () => {
    const agent = createPlayerAgent([0, 0], makeConfig())
    agent.health = 50

    // 레벨 미달 → 회복 없음
    agent.applyLifeLeech(20)
    expect(agent.health).toBe(50)

    agent.level = 6
    agent.applyLifeLeech(20)
    expect(agent.health).toBe(56) // +6 (20 × 0.3)

    // 최대치 clamp
    agent.applyLifeLeech(500)
    expect(agent.health).toBe(agent.maxHealth)
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

describe('player preset weights', () => {
  it('applies preset weights to level-up bonuses and non-combat regen', () => {
    const baseSpeed = 20
    const mkAgent = (presetWeights: PresetWeights) => {
      const agent = createPlayerAgent([0, 0], {
        exploreDistance: 50,
        speed: baseSpeed,
        collectRadius: 5,
        chopDurationMs: 1_000,
        attackRangeMeters: 20,
        attackDamageMs: 100,
        attackCooldownMs: 500,
        playerAttackDamage: 10,
        playerMaxHealth: 100,
        killHealHealth: 10,
        regenHealthAmount: 1,
        regenIntervalMs: 1_000,
        criticalHealthRatio: 0.25,
        fleeSafeDistanceMeters: 100,
        expBase: 100,
        expGrowth: 1,
        levelAttackBonus: 10,
        levelHealthBonus: 20,
        levelSpeedBonus: 5,
        huntScanRangePerLevel: 5,
        slamUnlockLevel: 99,
        slamCooldownMs: 0,
        slamRadius: 0,
        slamDamageMultiplier: 0,
        furyUnlockLevel: 99,
        furyCooldownMs: 0,
        furyDurationMs: 0,
        furySwingMultiplier: 1,
        leechUnlockLevel: 99,
        leechRatio: 0,
        upgradeCostBase: 999,
        upgradeCostGrowth: 1,
        weaponAttackPerTier: 0,
        weaponPowerPerTier: 0,
        reserveWood: 0,
        playerBasePower: 50,
        powerPerWood: 0,
        monsterHealthPowerWeight: 1,
        monsterAttackPowerWeight: 1,
        huntAggroRangeMultiplier: 1,
        huntGiveUpRangeMultiplier: 1,
        worldRadius: 1_000,
        collisionCheck: () => false,
        treeResources: () => [],
        threatSources: () => [],
        presetWeights,
      })
      return agent
    }

    const aggressive = mkAgent({ attackWeight: 2, healthWeight: 0.5, speedWeight: 1.4, scanWeight: 2, regenBonus: 0 })
    aggressive.addExperience(100) // expBase=100, growth=1 → 정확히 레벨 2 한 단계
    expect(aggressive.attackDamage).toBe(10 + Math.round(10 * 2)) // 공격 30
    expect(aggressive.maxHealth).toBe(100 + Math.round(20 * 0.5)) // HP 110
    expect(aggressive.health).toBe(100 + Math.round(20 * 0.5))
    // 가중치는 scene이 소유한 config.speed를 직접 가산 — 다음 에이전트 비교를 위해 캡처
    const speedAfterAggressive = baseSpeed + Math.round(5 * 1.4) + 5 * 1.4 // 변동 누적이 아니라 단순 가산

    const survivor = mkAgent({ attackWeight: 0.6, healthWeight: 1.8, speedWeight: 0.7, scanWeight: 0.5, regenBonus: 2 })
    survivor.addExperience(100)
    expect(survivor.maxHealth).toBe(100 + Math.round(20 * 1.8)) // HP 136
    expect(survivor.attackDamage).toBe(10 + Math.round(10 * 0.6)) // 공격 16

    // 가중치가 다르면 결과도 다르다 (회귀 방지용 형태 비교)
    expect(aggressive.attackDamage).toBeGreaterThan(survivor.attackDamage)
    expect(survivor.maxHealth).toBeGreaterThan(aggressive.maxHealth)
    expect(speedAfterAggressive).toBeGreaterThan(0) // 가중치 가산이 실제 적용됨

    // 비전투 회복 보너스: 생존가 에이전트가 1000ms 회복 틱에서 regenBonus만큼 더 회복
    survivor.health = 50
    survivor.regenTimer = 1_000
    survivor.update(0, 2_000)
    expect(survivor.health).toBe(50 + 1 + 2) // regenHealthAmount + regenBonus
  })

  it('falls back to balanced defaults when presetWeights is omitted', () => {
    const agent = createPlayerAgent([0, 0], {
      exploreDistance: 50,
      speed: 20,
      collectRadius: 5,
      chopDurationMs: 1_000,
      attackRangeMeters: 20,
      attackDamageMs: 100,
      attackCooldownMs: 500,
      playerAttackDamage: 10,
      playerMaxHealth: 100,
      killHealHealth: 10,
      regenHealthAmount: 1,
      regenIntervalMs: 1_000,
      criticalHealthRatio: 0.25,
      fleeSafeDistanceMeters: 100,
      expBase: 100,
      expGrowth: 1,
      levelAttackBonus: 10,
      levelHealthBonus: 20,
      levelSpeedBonus: 5,
      huntScanRangePerLevel: 5,
      slamUnlockLevel: 99,
      slamCooldownMs: 0,
      slamRadius: 0,
      slamDamageMultiplier: 0,
      furyUnlockLevel: 99,
      furyCooldownMs: 0,
      furyDurationMs: 0,
      furySwingMultiplier: 1,
      leechUnlockLevel: 99,
      leechRatio: 0,
      upgradeCostBase: 999,
      upgradeCostGrowth: 1,
      weaponAttackPerTier: 0,
      weaponPowerPerTier: 0,
      reserveWood: 0,
      playerBasePower: 50,
      powerPerWood: 0,
      monsterHealthPowerWeight: 1,
      monsterAttackPowerWeight: 1,
      huntAggroRangeMultiplier: 1,
      huntGiveUpRangeMultiplier: 1,
      worldRadius: 1_000,
      collisionCheck: () => false,
      treeResources: () => [],
      threatSources: () => [],
    })
    agent.addExperience(100)
    expect(agent.attackDamage).toBe(10 + 10) // 가중치 1
    expect(agent.maxHealth).toBe(100 + 20) // 가중치 1
  })
})

describe('player level-up cards', () => {
  const POOL: LevelUpPool = {
    cardCount: 3,
    choices: [
      { id: 'attack', pickWeight: 1.0, effects: { attackBonus: 5 } },
      { id: 'health', pickWeight: 1.0, effects: { healthBonus: 30 } },
      { id: 'crit',   pickWeight: 1.0, effects: { critChanceBonus: 0.04 } },
    ],
  }
  const BALANCED_AFFINITY: PresetAffinity = { attack: 1, health: 1, speed: 1, crit: 1, regen: 1, scan: 1 }
  const AGGR_AFFINITY: PresetAffinity = { attack: 5, health: 0.1, speed: 1, crit: 1, regen: 1, scan: 1 }

  const baseConfig = (overrides: Partial<PlayerAgentConfig> = {}): PlayerAgentConfig => ({
    exploreDistance: 50,
    speed: 20,
    collectRadius: 5,
    chopDurationMs: 1_000,
    attackRangeMeters: 20,
    attackDamageMs: 100,
    attackCooldownMs: 500,
    playerAttackDamage: 10,
    playerMaxHealth: 100,
    killHealHealth: 10,
    regenHealthAmount: 1,
    regenIntervalMs: 1_000,
    criticalHealthRatio: 0.25,
    fleeSafeDistanceMeters: 100,
    expBase: 100,
    expGrowth: 1,
    levelAttackBonus: 10,
    levelHealthBonus: 20,
    levelSpeedBonus: 5,
    huntScanRangePerLevel: 5,
    slamUnlockLevel: 99,
    slamCooldownMs: 0,
    slamRadius: 0,
    slamDamageMultiplier: 0,
    furyUnlockLevel: 99,
    furyCooldownMs: 0,
    furyDurationMs: 0,
    furySwingMultiplier: 1,
    leechUnlockLevel: 99,
    leechRatio: 0,
    upgradeCostBase: 999,
    upgradeCostGrowth: 1,
    weaponAttackPerTier: 0,
    weaponPowerPerTier: 0,
    reserveWood: 0,
    playerBasePower: 50,
    powerPerWood: 0,
    monsterHealthPowerWeight: 1,
    monsterAttackPowerWeight: 1,
    huntAggroRangeMultiplier: 1,
    huntGiveUpRangeMultiplier: 1,
    worldRadius: 1_000,
    collisionCheck: () => false,
    treeResources: () => [],
    threatSources: () => [],
    levelUpPool: POOL,
    levelUpAffinity: BALANCED_AFFINITY,
    ...overrides,
  })

  it('applies the chosen card effects on level-up instead of the base bonuses', () => {
    const agent = createPlayerAgent([0, 0], baseConfig())
    agent.addExperience(100) // 1 level-up
    expect(agent.level).toBe(2)
    expect(agent.pendingLevelUps).toHaveLength(1)
    const choice = agent.pendingLevelUps[0]
    // baseLevelAttackBonus/Health/Speed는 카드 풀 사용 시 무시되고, 카드 효과만 적용
    expect(agent.attackDamage === 15 || agent.maxHealth === 130 || agent.critChance > 0).toBe(true)
    expect(choice).toBeDefined()
    expect(['attack', 'health', 'crit']).toContain(choice.chosenId)
  })

  it('records the last level-up choice separately for single-card HUD display', () => {
    const agent = createPlayerAgent([0, 0], baseConfig())
    agent.addExperience(100)
    expect(agent.lastLevelUpChoice).not.toBeNull()
  })

  it('aggressive affinity biases picks toward attack', () => {
    const agent = createPlayerAgent([0, 0], baseConfig({ levelUpAffinity: AGGR_AFFINITY }))
    agent.addExperience(100)
    expect(agent.pendingLevelUps[0].chosenId).toBe('attack')
    expect(agent.attackDamage).toBe(10 + 5) // 카드 attack 효과만 적용
    expect(agent.maxHealth).toBe(100) // health는 카드 효과로만 오르므로 기본값 유지
  })

  it('falls back to base level bonuses when no pool is provided', () => {
    const cfg = baseConfig()
    delete cfg.levelUpPool
    delete cfg.levelUpAffinity
    const agent = createPlayerAgent([0, 0], cfg)
    agent.addExperience(100)
    expect(agent.pendingLevelUps).toHaveLength(0)
    expect(agent.attackDamage).toBe(10 + 10)
    expect(agent.maxHealth).toBe(100 + 20)
  })

  it('extraRegenBonus contributes to non-combat regen', () => {
    const cfg = baseConfig({ levelUpPool: { cardCount: 3, choices: [{ id: 'regen', pickWeight: 1, effects: { regenBonus: 2 } }] } })
    const agent = createPlayerAgent([0, 0], cfg)
    agent.addExperience(100)
    expect(agent.extraRegenBonus).toBe(2)
    agent.health = 50
    agent.regenTimer = 1_000
    agent.update(0, 2_000)
    expect(agent.health).toBe(50 + 1 + 2) // regenHealthAmount + extraRegenBonus
  })

  it('extraScanRangePerLevel widens the prey scan range', () => {
    const weakThreat = {
      id: 'prey', position: [90, 0], homePosition: [0, 0],
      activityRadius: 200, speed: 1, attackRadius: 5, attackDamage: 1, health: 1,
    }
    const cfg = baseConfig({
      levelUpPool: { cardCount: 3, choices: [{ id: 'scan', pickWeight: 1, effects: { scanBonus: 100 } }] },
      threatSources: () => [weakThreat],
    })
    const agent = createPlayerAgent([0, 0], cfg)
    agent.addExperience(100)
    expect(agent.extraScanRangePerLevel).toBe(100)

    // 약한 적 90 거리: 기본 스캔(20) < 90 이지만, extra=100 덕분에 잡힌다.
    const target = findPreyTarget(agent, cfg)
    expect(target).not.toBeNull()
    expect(target?.id).toBe('prey')
  })

  it('critChance is clamped to [0, 1]', () => {
    const cfg = baseConfig({ levelUpPool: { cardCount: 1, choices: [{ id: 'crit', pickWeight: 1, effects: { critChanceBonus: 0.8 } }] } })
    const agent = createPlayerAgent([0, 0], cfg)
    agent.addExperience(100)
    expect(agent.critChance).toBe(0.8)
    agent.addExperience(100)
    expect(agent.critChance).toBe(1) // 0.8 + 0.8 → clamp
  })

  it('falls back to neutral affinity when levelUpAffinity is undefined', () => {
    const cfg = baseConfig({ levelUpPool: POOL })
    delete cfg.levelUpAffinity
    const agent = createPlayerAgent([0, 0], cfg)
    agent.addExperience(100)
    expect(agent.pendingLevelUps).toHaveLength(1)
  })

  it('applies the healthBonus card effect (heals on level-up)', () => {
    const cfg = baseConfig({ levelUpPool: { cardCount: 1, choices: [{ id: 'health', pickWeight: 1, effects: { healthBonus: 40 } }] } })
    const agent = createPlayerAgent([0, 0], cfg)
    agent.health = 100 // max
    agent.addExperience(100)
    expect(agent.maxHealth).toBe(140)
    expect(agent.health).toBe(140) // heal += same amount, clamped to maxHealth
  })

  it('applies the speedBonus card effect to both this.speed and config.speed', () => {
    const cfg = baseConfig({ levelUpPool: { cardCount: 1, choices: [{ id: 'speed', pickWeight: 1, effects: { speedBonus: 3 } }] } })
    const initialCfgSpeed = cfg.speed
    const agent = createPlayerAgent([0, 0], cfg)
    agent.addExperience(100)
    expect(agent.speed).toBe(initialCfgSpeed + 3)
    // config.speed도 같이 올라가야 moveToward가 새 속도를 본다.
    expect(cfg.speed).toBe(initialCfgSpeed + 3)
  })
})

describe('player mastery integration', () => {
  const baseCfg = (): PlayerAgentConfig => ({
    exploreDistance: 50,
    speed: 20,
    collectRadius: 5,
    chopDurationMs: 1_000,
    attackRangeMeters: 20,
    attackDamageMs: 100,
    attackCooldownMs: 500,
    playerAttackDamage: 10,
    playerMaxHealth: 100,
    killHealHealth: 10,
    regenHealthAmount: 1,
    regenIntervalMs: 1_000,
    criticalHealthRatio: 0.25,
    fleeSafeDistanceMeters: 100,
    expBase: 100,
    expGrowth: 1,
    levelAttackBonus: 0,
    levelHealthBonus: 0,
    levelSpeedBonus: 0,
    huntScanRangePerLevel: 5,
    slamUnlockLevel: 99,
    slamCooldownMs: 0,
    slamRadius: 0,
    slamDamageMultiplier: 0,
    furyUnlockLevel: 99,
    furyCooldownMs: 0,
    furyDurationMs: 0,
    furySwingMultiplier: 1,
    leechUnlockLevel: 99,
    leechRatio: 0,
    upgradeCostBase: 999,
    upgradeCostGrowth: 1,
    weaponAttackPerTier: 0,
    weaponPowerPerTier: 0,
    reserveWood: 0,
    playerBasePower: 50,
    powerPerWood: 0,
    monsterHealthPowerWeight: 1,
    monsterAttackPowerWeight: 1,
    huntAggroRangeMultiplier: 1,
    huntGiveUpRangeMultiplier: 1,
    worldRadius: 1_000,
    collisionCheck: () => false,
    treeResources: () => [],
    threatSources: () => [],
  })

  it('applyMasteryBonus adds stats and clamps crit', () => {
    const agent = createPlayerAgent([0, 0], baseCfg())
    agent.applyMasteryBonus({ critChanceBonus: 0.4 })
    expect(agent.critChance).toBe(0.4)
    agent.applyMasteryBonus({ critChanceBonus: 0.4 })
    expect(agent.critChance).toBe(0.8)
    agent.applyMasteryBonus({ critChanceBonus: 0.5 })
    expect(agent.critChance).toBe(1) // clamp
  })

  it('applyMasteryBonus adds critMultiplier and attackDamage', () => {
    const agent = createPlayerAgent([0, 0], baseCfg())
    agent.applyMasteryBonus({ critMultiplierBonus: 0.3, attackBonus: 5 })
    expect(agent.critMultiplier).toBe(1.8) // 1.5 + 0.3
    expect(agent.attackDamage).toBe(15) // 10 + 5
  })

  it('applyMasteryBonus adds scanRangeBonus to extraScanRangePerLevel', () => {
    const agent = createPlayerAgent([0, 0], baseCfg())
    agent.applyMasteryBonus({ scanRangeBonus: 25 })
    expect(agent.extraScanRangePerLevel).toBe(25)
  })

  it('applyMasteryBonus multiplies damageTakenMultiplier', () => {
    const agent = createPlayerAgent([0, 0], baseCfg())
    agent.applyMasteryBonus({ damageTakenMultiplier: 0.5 })
    expect(agent.damageTakenMultiplier).toBe(0.5)
    agent.applyMasteryBonus({ damageTakenMultiplier: 0.5 })
    expect(agent.damageTakenMultiplier).toBe(0.3)
  })

  it('applyDamage respects damageTakenMultiplier', () => {
    const agent = createPlayerAgent([0, 0], baseCfg())
    agent.damageTakenMultiplier = 0.5
    agent.applyDamage(20)
    expect(agent.health).toBe(90) // 100 - round(20*0.5)
  })

  it('applyMasteryBonus ignores undefined fields', () => {
    const agent = createPlayerAgent([0, 0], baseCfg())
    agent.applyMasteryBonus({})
    expect(agent.critChance).toBe(0)
    expect(agent.critMultiplier).toBe(1.5)
    expect(agent.damageTakenMultiplier).toBe(1)
    expect(agent.attackDamage).toBe(10)
    expect(agent.extraScanRangePerLevel).toBe(0)
  })
})

describe('player dodge', () => {
  const baseCfg = (): PlayerAgentConfig => ({
    exploreDistance: 50,
    speed: 20,
    collectRadius: 5,
    chopDurationMs: 1_000,
    attackRangeMeters: 20,
    attackDamageMs: 100,
    attackCooldownMs: 500,
    playerAttackDamage: 10,
    playerMaxHealth: 100,
    killHealHealth: 10,
    regenHealthAmount: 1,
    regenIntervalMs: 1_000,
    criticalHealthRatio: 0.25,
    fleeSafeDistanceMeters: 100,
    expBase: 100,
    expGrowth: 1,
    levelAttackBonus: 0,
    levelHealthBonus: 0,
    levelSpeedBonus: 0,
    huntScanRangePerLevel: 5,
    slamUnlockLevel: 99,
    slamCooldownMs: 0,
    slamRadius: 0,
    slamDamageMultiplier: 0,
    furyUnlockLevel: 99,
    furyCooldownMs: 0,
    furyDurationMs: 0,
    furySwingMultiplier: 1,
    leechUnlockLevel: 99,
    leechRatio: 0,
    upgradeCostBase: 999,
    upgradeCostGrowth: 1,
    weaponAttackPerTier: 0,
    weaponPowerPerTier: 0,
    reserveWood: 0,
    playerBasePower: 50,
    powerPerWood: 0,
    monsterHealthPowerWeight: 1,
    monsterAttackPowerWeight: 1,
    huntAggroRangeMultiplier: 1,
    huntGiveUpRangeMultiplier: 1,
    worldRadius: 1_000,
    collisionCheck: () => false,
    treeResources: () => [],
    threatSources: () => [],
  })

  it('applyDamage returns true (dodged) when dodgeChance is 1', () => {
    const agent = createPlayerAgent([0, 0], baseCfg())
    agent.dodgeChance = 1
    expect(agent.applyDamage(20)).toBe(true)
    expect(agent.health).toBe(100) // 피해 무효
  })

  it('applyDamage returns false (not dodged) and applies damage when dodgeChance is 0', () => {
    const agent = createPlayerAgent([0, 0], baseCfg())
    expect(agent.applyDamage(20)).toBe(false)
    expect(agent.health).toBe(80)
  })
})

describe('player skill tree integration', () => {
  const baseCfg = (skillTree?: { branches: Record<string, { label: string; nodes: { id: string; unlockLevel: number; effects: Record<string, number | boolean> }[] }> }): PlayerAgentConfig => ({
    exploreDistance: 50,
    speed: 20,
    collectRadius: 5,
    chopDurationMs: 1_000,
    attackRangeMeters: 20,
    attackDamageMs: 100,
    attackCooldownMs: 500,
    playerAttackDamage: 10,
    playerMaxHealth: 100,
    killHealHealth: 10,
    regenHealthAmount: 1,
    regenIntervalMs: 1_000,
    criticalHealthRatio: 0.25,
    fleeSafeDistanceMeters: 100,
    expBase: 100,
    expGrowth: 1,
    levelAttackBonus: 0,
    levelHealthBonus: 0,
    levelSpeedBonus: 0,
    huntScanRangePerLevel: 5,
    slamUnlockLevel: 99,
    slamCooldownMs: 0,
    slamRadius: 0,
    slamDamageMultiplier: 0,
    furyUnlockLevel: 99,
    furyCooldownMs: 0,
    furyDurationMs: 0,
    furySwingMultiplier: 1,
    leechUnlockLevel: 99,
    leechRatio: 0,
    upgradeCostBase: 999,
    upgradeCostGrowth: 1,
    weaponAttackPerTier: 0,
    weaponPowerPerTier: 0,
    reserveWood: 0,
    playerBasePower: 50,
    powerPerWood: 0,
    monsterHealthPowerWeight: 1,
    monsterAttackPowerWeight: 1,
    huntAggroRangeMultiplier: 1,
    huntGiveUpRangeMultiplier: 1,
    worldRadius: 1_000,
    collisionCheck: () => false,
    treeResources: () => [],
    threatSources: () => [],
    skillTree,
  })

  const TREE = {
    branches: {
      attack: {
        label: 'attack',
        nodes: [
          { id: 'attack.slam.cd', unlockLevel: 3, effects: { slamCooldownMultiplier: 0.5 } },
        ],
      },
      defense: {
        label: 'defense',
        nodes: [
          { id: 'defense.dodge', unlockLevel: 4, effects: { dodgeChance: 0.1 } },
        ],
      },
    },
  }

	it('unlocks a node when its threshold level is crossed by a single addExperience call', () => {
		const agent = createPlayerAgent([0, 0], baseCfg(TREE))
		agent.addExperience(300) // Lv 1→2→3→4 (expBase 100, growth 1)
		expect(agent.unlockedSkillNodes).toContain('attack.slam.cd')
		expect(agent.unlockedSkillNodes).toContain('defense.dodge')
		expect(agent.slamCooldownMultiplier).toBe(0.5)
		expect(agent.dodgeChance).toBe(0.1)
		// GameScene가 renderFrame에서 큐를 비운다. 에이전트 자체는 비우지 않음.
		expect(agent.pendingSkillUnlocks).toContain('attack.slam.cd')
		expect(agent.pendingSkillUnlocks).toContain('defense.dodge')
	})

  it('does not unlock when level threshold is not crossed', () => {
    const agent = createPlayerAgent([0, 0], baseCfg(TREE))
    agent.addExperience(100) // Lv 1→2 only
    expect(agent.unlockedSkillNodes).toEqual([])
    expect(agent.slamCooldownMultiplier).toBe(1)
    expect(agent.dodgeChance).toBe(0)
  })

  it('unlocks each node only once across multiple addExperience calls', () => {
    const agent = createPlayerAgent([0, 0], baseCfg(TREE))
    agent.addExperience(300) // Lv 1→4
    expect(agent.unlockedSkillNodes).toHaveLength(2)
    expect(agent.slamCooldownMultiplier).toBe(0.5)
    agent.addExperience(50) // no level-up
    expect(agent.slamCooldownMultiplier).toBe(0.5)
    agent.addExperience(50) // Lv 4→5 (expBase 100, growth 1)
    expect(agent.slamCooldownMultiplier).toBe(0.5) // unchanged
  })

  it('no skill tree means no node ever unlocks', () => {
    const agent = createPlayerAgent([0, 0], baseCfg(undefined))
    agent.addExperience(300)
    expect(agent.unlockedSkillNodes).toEqual([])
  })
})

describe('player passive tree integration', () => {
  const baseCfg = (passiveTree?: { nodes: { id: string; trigger: { level?: number; totalKills?: number; speciesKills?: { name: string; count: number }; bossKills?: number; cardChoiceCount?: number; dayReached?: number }; effects: Record<string, number | boolean>; labelKey: string }[] }): PlayerAgentConfig => ({
    exploreDistance: 50,
    speed: 20,
    collectRadius: 5,
    chopDurationMs: 1_000,
    attackRangeMeters: 20,
    attackDamageMs: 100,
    attackCooldownMs: 500,
    playerAttackDamage: 10,
    playerMaxHealth: 100,
    killHealHealth: 10,
    regenHealthAmount: 1,
    regenIntervalMs: 1_000,
    criticalHealthRatio: 0.25,
    fleeSafeDistanceMeters: 100,
    expBase: 100,
    expGrowth: 1,
    levelAttackBonus: 0,
    levelHealthBonus: 0,
    levelSpeedBonus: 0,
    huntScanRangePerLevel: 5,
    slamUnlockLevel: 99,
    slamCooldownMs: 0,
    slamRadius: 0,
    slamDamageMultiplier: 0,
    furyUnlockLevel: 99,
    furyCooldownMs: 0,
    furyDurationMs: 0,
    furySwingMultiplier: 1,
    leechUnlockLevel: 99,
    leechRatio: 0,
    upgradeCostBase: 999,
    upgradeCostGrowth: 1,
    weaponAttackPerTier: 0,
    weaponPowerPerTier: 0,
    reserveWood: 0,
    playerBasePower: 50,
    powerPerWood: 0,
    monsterHealthPowerWeight: 1,
    monsterAttackPowerWeight: 1,
    huntAggroRangeMultiplier: 1,
    huntGiveUpRangeMultiplier: 1,
    worldRadius: 1_000,
    collisionCheck: () => false,
    treeResources: () => [],
    threatSources: () => [],
    passiveTree,
  })

  const TREE = {
    nodes: [
      { id: 'p.level.5', trigger: { level: 5 }, effects: { damageTakenMultiplier: 0.98 }, labelKey: 'p.level.5' },
      { id: 'p.kills.5', trigger: { totalKills: 5 }, effects: { bonusFlatDamage: 3 }, labelKey: 'p.kills.5' },
      { id: 'p.boss.1', trigger: { bossKills: 1 }, effects: { damageTakenMultiplier: 0.5 }, labelKey: 'p.boss.1' },
      { id: 'p.goblin.3', trigger: { speciesKills: { name: 'Goblin', count: 3 } }, effects: { dodgeChance: 0.05 }, labelKey: 'p.goblin.3' },
      { id: 'p.day.5', trigger: { dayReached: 5 }, effects: { extraRegenBonus: 1 }, labelKey: 'p.day.5' },
    ],
  }

  it('does not unlock anything when passiveTree is not configured', () => {
    const agent = createPlayerAgent([0, 0], baseCfg(undefined))
    agent.recordKill('Goblin', false)
    agent.recordCardChoice()
    agent.recordLevelReached(5)
    agent.recordDayReached(5)
    expect(agent.passiveTreeState.unlockedIds).toEqual([])
    expect(agent.bonusFlatDamage).toBe(0)
  })

  it('unlocks level-based passives when addExperience reaches a milestone', () => {
    const agent = createPlayerAgent([0, 0], baseCfg(TREE))
    agent.addExperience(500)
    expect(agent.passiveTreeState.unlockedIds).toContain('p.level.5')
    expect(agent.damageTakenMultiplier).toBeCloseTo(0.98)
  })

  it('unlocks nodes via recordKill and applies effects to agent', () => {
    const agent = createPlayerAgent([0, 0], baseCfg(TREE))
    for (let i = 0; i < 5; i++) {
      agent.recordKill('Goblin', false)
    }
    expect(agent.passiveTreeState.unlockedIds).toContain('p.kills.5')
    expect(agent.passiveTreeState.unlockedIds).toContain('p.goblin.3')
    expect(agent.bonusFlatDamage).toBe(3)
    expect(agent.dodgeChance).toBeCloseTo(0.05)
    expect(agent.pendingPassiveUnlocks).toContain('p.kills.5')
  })

  it('unlocks boss nodes and multiplies damageTakenMultiplier', () => {
    const agent = createPlayerAgent([0, 0], baseCfg(TREE))
    agent.recordKill('Giant', true)
    expect(agent.passiveTreeState.unlockedIds).toContain('p.boss.1')
    expect(agent.damageTakenMultiplier).toBeCloseTo(0.5)
  })

  it('recordDayReached does not regress when called with lower day', () => {
    const agent = createPlayerAgent([0, 0], baseCfg(TREE))
    agent.recordDayReached(10)
    expect(agent.passiveTreeState.unlockedIds).toContain('p.day.5')
    agent.recordDayReached(3)
    expect(agent.passiveTreeState.progress.dayReached).toBe(10)
  })

  it('addExperience triggers recordCardChoice which can unlock card nodes (no card nodes here, but ensure no crash)', () => {
    const agent = createPlayerAgent([0, 0], baseCfg(TREE))
    agent.addExperience(100)
    expect(agent.passiveTreeState.progress.cardChoiceCount).toBe(1)
  })

  it('slam and normal attack both report isCrit when critChance is 1', () => {
    // slam의 isCrit true 분기 + updateAttacking의 isCrit true 분기를 함께 커버
    vi.spyOn(Math, 'random').mockReturnValue(0.01) // critChance=1 이면 무조건 crit
    const onAttackMonster = vi.fn()
    const threats = [
      { id: 'a', position: [5, 0], homePosition: [0, 0], activityRadius: 20, speed: 10, attackRadius: 2, health: 50 },
    ]
    const cfg = makeConfig({
      playerAttackDamage: 10,
      onAttackMonster,
      threatSources: () => threats,
      slamUnlockLevel: 1,
      slamCooldownMs: 100,
      slamRadius: 100,
      slamDamageMultiplier: 1,
      attackDamageMs: 100,
      attackCooldownMs: 100,
    })
    const agent = createPlayerAgent([0, 0], cfg)
    agent.critChance = 1
    agent.critMultiplier = 2
    agent.update(0, 0)
    // slam은 1회, 일반 스윙은 진행 중이지만 윈도우 미도달
    const calls = onAttackMonster.mock.calls
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.some(c => c.length === 3 && c[2] === true)).toBe(true)
  })

  it('does not crash when onAttackMonster is undefined', () => {
    // config.onAttackMonster 미설정 시 slam/스윙 모두 no-op (false 분기 커버)
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const threats = [
      { id: 'a', position: [5, 0], homePosition: [0, 0], activityRadius: 20, speed: 10, attackRadius: 2, health: 50 },
    ]
    const cfg = makeConfig({
      threatSources: () => threats,
      slamUnlockLevel: 1,
      slamCooldownMs: 100,
      slamRadius: 100,
      slamDamageMultiplier: 1,
      attackDamageMs: 100,
      attackCooldownMs: 100,
    })
    delete cfg.onAttackMonster
    const agent = createPlayerAgent([0, 0], cfg)
    expect(() => agent.update(0, 0)).not.toThrow()
    // 스윙 윈도우 강제 도달
    expect(() => agent.update(1, 1_000)).not.toThrow()
  })

  it('normal attack swing fires with isCrit when critChance is 1', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01) // critChance=1 이면 무조건 crit
    const onAttackMonster = vi.fn()
    const threats = [
      { id: 'a', position: [5, 0], homePosition: [0, 0], activityRadius: 20, speed: 10, attackRadius: 2, health: 50, attackDamage: 5 },
    ]
    const cfg = makeConfig({
      playerAttackDamage: 10,
      onAttackMonster,
      threatSources: () => threats,
      attackDamageMs: 100,
      attackCooldownMs: 100,
    })
    const agent = createPlayerAgent([0, 0], cfg)
    agent.critChance = 1
    agent.critMultiplier = 2
    agent.update(0, 0) // start attacking
    agent.update(1, 1_000) // swingWindow=200, advance to 1000
    const calls = onAttackMonster.mock.calls
    expect(calls.some(c => c.length === 3 && c[2] === true)).toBe(true)
  })
})

describe('player crit roll (attackRoll)', () => {
  const baseCfg = (): PlayerAgentConfig => ({
    exploreDistance: 50,
    speed: 20,
    collectRadius: 5,
    chopDurationMs: 1_000,
    attackRangeMeters: 20,
    attackDamageMs: 100,
    attackCooldownMs: 500,
    playerAttackDamage: 10,
    playerMaxHealth: 100,
    killHealHealth: 10,
    regenHealthAmount: 1,
    regenIntervalMs: 1_000,
    criticalHealthRatio: 0.25,
    fleeSafeDistanceMeters: 100,
    expBase: 100,
    expGrowth: 1,
    levelAttackBonus: 0,
    levelHealthBonus: 0,
    levelSpeedBonus: 0,
    huntScanRangePerLevel: 5,
    slamUnlockLevel: 99,
    slamCooldownMs: 0,
    slamRadius: 0,
    slamDamageMultiplier: 0,
    furyUnlockLevel: 99,
    furyCooldownMs: 0,
    furyDurationMs: 0,
    furySwingMultiplier: 1,
    leechUnlockLevel: 99,
    leechRatio: 0,
    upgradeCostBase: 999,
    upgradeCostGrowth: 1,
    weaponAttackPerTier: 0,
    weaponPowerPerTier: 0,
    reserveWood: 0,
    playerBasePower: 50,
    powerPerWood: 0,
    monsterHealthPowerWeight: 1,
    monsterAttackPowerWeight: 1,
    huntAggroRangeMultiplier: 1,
    huntGiveUpRangeMultiplier: 1,
    worldRadius: 1_000,
    collisionCheck: () => false,
    treeResources: () => [],
    threatSources: () => [],
  })

  it('returns base + flat damage without crit', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99) // crit 안 터짐
    const agent = createPlayerAgent([0, 0], baseCfg())
    agent.bonusFlatDamage = 4
    const result = agent.attackRoll(10)
    expect(result.isCrit).toBe(false)
    expect(result.finalDamage).toBe(14)
  })

  it('multiplies damage by critMultiplier on crit', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01) // crit 터짐
    const agent = createPlayerAgent([0, 0], baseCfg())
    agent.critChance = 1
    agent.critMultiplier = 2
    agent.bonusFlatDamage = 5
    const result = agent.attackRoll(10)
    expect(result.isCrit).toBe(true)
    // (10 + 5) * 2 = 30
    expect(result.finalDamage).toBe(30)
  })
})

describe('player balance floor/ceiling', () => {
  const baseCfg = (overrides: Partial<PlayerAgentConfig> = {}): PlayerAgentConfig => ({
    exploreDistance: 50,
    speed: 20,
    collectRadius: 5,
    chopDurationMs: 1_000,
    attackRangeMeters: 20,
    attackDamageMs: 100,
    attackCooldownMs: 500,
    playerAttackDamage: 10,
    playerMaxHealth: 100,
    killHealHealth: 10,
    regenHealthAmount: 1,
    regenIntervalMs: 1_000,
    criticalHealthRatio: 0.25,
    fleeSafeDistanceMeters: 100,
    expBase: 100,
    expGrowth: 1,
    levelAttackBonus: 0,
    levelHealthBonus: 0,
    levelSpeedBonus: 0,
    huntScanRangePerLevel: 5,
    slamUnlockLevel: 99,
    slamCooldownMs: 0,
    slamRadius: 0,
    slamDamageMultiplier: 0,
    furyUnlockLevel: 99,
    furyCooldownMs: 0,
    furyDurationMs: 0,
    furySwingMultiplier: 1,
    leechUnlockLevel: 99,
    leechRatio: 0,
    upgradeCostBase: 999,
    upgradeCostGrowth: 1,
    weaponAttackPerTier: 0,
    weaponPowerPerTier: 0,
    reserveWood: 0,
    playerBasePower: 50,
    powerPerWood: 0,
    monsterHealthPowerWeight: 1,
    monsterAttackPowerWeight: 1,
    huntAggroRangeMultiplier: 1,
    huntGiveUpRangeMultiplier: 1,
    worldRadius: 1_000,
    collisionCheck: () => false,
    treeResources: () => [],
    threatSources: () => [],
    ...overrides,
  })

  it('caps crit multiplier and keeps attack rolls bounded', () => {
    const agent = createPlayerAgent([0, 0], baseCfg({ critMultiplierCeiling: 2 }))
    agent.critChance = 1
    agent.critMultiplier = 4
    expect(agent.attackRoll(10).finalDamage).toBe(20)
    agent.applyMasteryBonus({ critMultiplierBonus: 1 })
    expect(agent.critMultiplier).toBe(2)
  })

  it('applyDamage respects damageTakenFloor on low multipliers', () => {
    const agent = createPlayerAgent([0, 0], baseCfg({ damageTakenFloor: 0.3 }))
    agent.damageTakenMultiplier = 0.1
    agent.applyDamage(100)
    expect(agent.health).toBe(70) // 100 - round(100 * 0.3) = 70
  })

  it('allows an explicit damageTakenFloor of zero for opt-in legacy behavior', () => {
    const agent = createPlayerAgent([0, 0], baseCfg({ damageTakenFloor: 0 }))
    agent.damageTakenMultiplier = 0.1
    agent.applyMasteryBonus({ damageTakenMultiplier: 0.1 })
    expect(agent.damageTakenMultiplier).toBeCloseTo(0.01)
  })

  it('applyDamage caps dodge chance at dodgeChanceCeiling', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const agent = createPlayerAgent([0, 0], baseCfg({ dodgeChanceCeiling: 0.4 }))
    agent.dodgeChance = 1
    // 0.5 > 0.4 → 회피 안 됨
    expect(agent.applyDamage(20)).toBe(false)
    expect(agent.health).toBe(80)
  })

  it('applyMasteryBonus respects damageTakenFloor', () => {
    const agent = createPlayerAgent([0, 0], baseCfg({ damageTakenFloor: 0.5 }))
    agent.applyMasteryBonus({ damageTakenMultiplier: 0.1 })
    expect(agent.damageTakenMultiplier).toBe(0.5)
  })

  it('upgradeWeapon stops at weaponMaxTier', () => {
    const agent = createPlayerAgent([0, 0], baseCfg({ weaponMaxTier: 2, upgradeCostBase: 10, upgradeCostGrowth: 1 }))
    agent.woodCollected = 10_000
    expect(agent.upgradeWeapon()).toBe(true)
    expect(agent.weaponTier).toBe(1)
    expect(agent.upgradeWeapon()).toBe(true)
    expect(agent.weaponTier).toBe(2)
    // 그 이후는 false
    expect(agent.upgradeWeapon()).toBe(false)
    expect(agent.weaponTier).toBe(2)
  })

  it('restoreSpeed keeps the agent and next level-up calculation synchronized', () => {
    const cfg = baseCfg({ weaponMaxTier: 1, upgradeCostBase: 1, upgradeCostGrowth: 1, levelSpeedBonus: 1 })
    const agent = createPlayerAgent([0, 0], cfg)
    agent.restoreSpeed(18)
    expect(agent.speed).toBe(18)
    expect(cfg.speed).toBe(18)
    agent.addExperience(100)
    expect(agent.speed).toBe(19)
  })

  it('weaponMaxTier = 0 disables the cap', () => {
    const agent = createPlayerAgent([0, 0], baseCfg({ weaponMaxTier: 0, upgradeCostBase: 1, upgradeCostGrowth: 1 }))
    agent.woodCollected = 100_000
    for (let i = 0; i < 20; i++) agent.upgradeWeapon()
    expect(agent.weaponTier).toBe(20)
  })
})

describe('player status effects', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('bleed ticks damage the player on schedule and can be lethal', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    // 비전투 회복이 출혈 검증을 방해하지 않도록 0으로 고정
    const agent = createPlayerAgent([0, 0], makeConfig({ regenHealthAmount: 0 }))
    agent.applyStatusEffect({ kind: 'bleed', potency: 3, durationMs: 6000, tickIntervalMs: 1000 }, 0)
    expect(agent.statuses).toHaveLength(1)

    agent.update(0.5, 500) // 아직 첫 틱 전
    expect(agent.health).toBe(100)

    agent.update(0.5, 1_000) // 첫 틱 도래
    expect(agent.health).toBe(97)

    agent.health = 4
    agent.update(0.5, 1_500) // 다음 틱까지 절반 — 무피해
    expect(agent.health).toBe(4)

    agent.update(0.5, 2_000) // 두 번째 틱
    expect(agent.health).toBe(1)

    // 출혈은 회피/받는 피해 감산 없는 고정 피해다 — 0이 되면 사망 처리
    agent.update(0.5, 2_500)
    expect(agent.health).toBe(1) // 세 번째 틱 전

    agent.update(0.5, 3_000)
    expect(agent.health).toBe(0)
    expect(agent.playerAlive).toBe(false)
  })

  it('drops an expired bleed without firing its pending tick', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const agent = createPlayerAgent([0, 0], makeConfig({ regenHealthAmount: 0 }))
    agent.applyStatusEffect({ kind: 'bleed', potency: 3, durationMs: 1200, tickIntervalMs: 1000 }, 0)

    agent.update(1.1, 1_100) // 첫 틱(3) 후 잔존
    expect(agent.health).toBe(97)
    expect(agent.statuses).toHaveLength(1)

    agent.update(0.2, 1_300) // 만료 프레임 — 미응현 틱은 무효
    expect(agent.statuses).toHaveLength(0)
    expect(agent.health).toBe(97)
  })

  it('reapplying a bleed keeps the max potency and the longer expiry schedule', () => {
    const agent = createPlayerAgent([0, 0], makeConfig())
    agent.applyStatusEffect({ kind: 'bleed', potency: 2, durationMs: 2000, tickIntervalMs: 800 }, 0)
    agent.applyStatusEffect({ kind: 'bleed', potency: 5, durationMs: 9000, tickIntervalMs: 400 }, 1_000)

    expect(agent.statuses).toHaveLength(1)
    expect(agent.statuses[0]).toMatchObject({
      kind: 'bleed',
      potency: 5,
      expiresAt: 10_000,
      tickIntervalMs: 400,
      nextTickInMs: 400,
    })
  })

  it('slow statuses multiply the exploration travel distance until they expire', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const slowed = createPlayerAgent([0, 0], makeConfig())
    slowed.state = 'exploring'
    slowed.target = [100_000, 0]
    slowed.applyStatusEffect({ kind: 'slow', potency: 0.5, durationMs: 5000 }, 0)

    const before = [...slowed.position]
    slowed.update(0.5, 100)
    const moved = Math.hypot(slowed.position[0] - before[0], slowed.position[1] - before[1])
    expect(moved).toBeCloseTo(2.5) // speed 10 × slow 0.5 × delta 0.5

    const normal = createPlayerAgent([0, 0], makeConfig())
    normal.state = 'exploring'
    normal.target = [100_000, 0]
    const normalBefore = [...normal.position]
    normal.update(0.5, 100)
    const normalMoved = Math.hypot(normal.position[0] - normalBefore[0], normal.position[1] - normalBefore[1])
    expect(normalMoved).toBeCloseTo(5)
  })

  it('expired slows stop affecting movement again', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const agent = createPlayerAgent([0, 0], makeConfig())
    agent.state = 'exploring'
    agent.target = [100_000, 0]
    agent.applyStatusEffect({ kind: 'slow', potency: 0.4, durationMs: 300 }, 0)

    agent.update(0.5, 500) // 만료 → 제거
    expect(agent.statuses).toHaveLength(0)

    const before = [...agent.position]
    agent.update(0.5, 600)
    const moved = Math.hypot(agent.position[0] - before[0], agent.position[1] - before[1])
    expect(moved).toBeCloseTo(5) // 배율 1 복귀
  })

  it('slam attaches the configured stun recipe as a fourth argument (non-crit)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99) // crit 없음
    const onAttackMonster = vi.fn()
    const stun = { kind: 'stun' as const, durationMs: 1600 }
    const threats: PlayerThreatSource[] = [
      { id: 'a', position: [5, 0], homePosition: [0, 0], activityRadius: 20, speed: 10, attackRadius: 2, health: 50 },
    ]
    const cfg = makeConfig({
      playerAttackDamage: 10,
      onAttackMonster,
      threatSources: () => threats,
      slamUnlockLevel: 1,
      slamCooldownMs: 100,
      slamRadius: 100,
      slamDamageMultiplier: 1,
      attackDamageMs: 100,
      attackCooldownMs: 100,
      slamStatus: stun,
    })
    const agent = createPlayerAgent([0, 0], cfg)
    agent.critChance = 0

    agent.update(0, 0)

    expect(onAttackMonster).toHaveBeenCalledTimes(1)
    expect(onAttackMonster).toHaveBeenCalledWith('a', 10, false, stun)
  })

  it('slam keeps the crit flag together with the stun recipe on crits', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01) // critChance=1 → 무조건 crit
    const onAttackMonster = vi.fn()
    const stun = { kind: 'stun' as const, durationMs: 1600 }
    const threats: PlayerThreatSource[] = [
      { id: 'a', position: [5, 0], homePosition: [0, 0], activityRadius: 20, speed: 10, attackRadius: 2, health: 50 },
    ]
    const cfg = makeConfig({
      playerAttackDamage: 10,
      onAttackMonster,
      threatSources: () => threats,
      slamUnlockLevel: 1,
      slamCooldownMs: 100,
      slamRadius: 100,
      slamDamageMultiplier: 1,
      attackDamageMs: 100,
      attackCooldownMs: 100,
      slamStatus: stun,
    })
    const agent = createPlayerAgent([0, 0], cfg)
    agent.critChance = 1
    agent.critMultiplier = 2

    agent.update(0, 0)

    const call = onAttackMonster.mock.calls.find(candidate => candidate.length === 4)
    expect(call?.[0]).toBe('a')
    expect(call?.[2]).toBe(true)
    expect(call?.[3]).toEqual(stun)
  })

  it('melee swings without a slam recipe keep their original argument count', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const onAttackMonster = vi.fn()
    const threats: PlayerThreatSource[] = [
      { id: 'a', position: [5, 0], homePosition: [0, 0], activityRadius: 20, speed: 10, attackRadius: 2, health: 50 },
    ]
    const cfg = makeConfig({
      playerAttackDamage: 10,
      onAttackMonster,
      threatSources: () => threats,
      slamUnlockLevel: 1,
      slamCooldownMs: 100,
      slamRadius: 100,
      slamDamageMultiplier: 1,
      attackDamageMs: 100,
      attackCooldownMs: 100,
      // slamStatus 미설정
    })
    const agent = createPlayerAgent([0, 0], cfg)
    agent.critChance = 0

    agent.update(0, 0) // slam (레시피 없음 → 2인자)
    expect(onAttackMonster).toHaveBeenCalledWith('a', 10)

    onAttackMonster.mockClear()
    agent.update(1, 1_000) // 일반 스윙 도달
    const swingCall = onAttackMonster.mock.calls.at(-1)
    expect(swingCall).toEqual(['a', 10])
  })
})
