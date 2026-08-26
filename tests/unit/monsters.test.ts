import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createMonsterAgent,
  createMonsterResources,
  createBossMonster,
  createRespawnMonster,
  applyElitePrefix,
  eliteChanceForTier,
  effectiveDetectionRadius,
  pickElitePrefix,
  tierStatScale,
  type ElitePrefix,
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

  it('createRespawnMonster applies strength multiplier and tier scaling', () => {
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
      tierScalePerTier: 1.25,
    }

    // 티어 1 리스폰: 배율만 적용 (Goblin 0.5 → 체력 50/공격 5). modelNames[2] = 'Goblin'
    const goblin = createRespawnMonster(baseConfig, 'monster-respawn-0', 2, 1)
    expect(goblin.id).toBe('monster-respawn-0')
    expect(goblin.modelName).toBe('Goblin')
    expect(goblin.health).toBe(50)
    expect(goblin.maxHealth).toBe(50)
    expect(goblin.attackDamage).toBe(5)
    expect(Math.hypot(...goblin.position)).toBeLessThanOrEqual(400)

    // 티어 3 리스폰: 배율 × 1.25² = ×1.5625 (Giant 2.0 → 체력 round(312.5)=313/공격 round(31.25)=31)
    const giant = createRespawnMonster(baseConfig, 'monster-respawn-1', 1, 3)
    expect(giant.modelName).toBe('Giant')
    expect(giant.health).toBe(313)
    expect(giant.maxHealth).toBe(313)
    expect(giant.attackDamage).toBe(31)

    // tierScalePerTier 미설정 → 스케일링 없음 (기본 가지)
    const { tierScalePerTier: _omitted, ...withoutScaling } = baseConfig
    const plain = createRespawnMonster(withoutScaling, 'monster-respawn-2', 2, 5)
    expect(plain.health).toBe(50)

    // 범위 밖 인덱스 + 배율 미설정 → 기본 이름(Demon)/기본 배율(1) 가지
    const { strengthMultipliers: _multipliers, ...withoutMultipliers } = baseConfig
    const fallback = createRespawnMonster(withoutMultipliers, 'monster-respawn-3', 99, 1)
    expect(fallback.modelName).toBe('Demon')
    expect(fallback.health).toBe(100)

    // 티어 0 이하는 스케일 1로 클램프된다 (음수 지수 방지)
    const floorClamp = createRespawnMonster(baseConfig, 'monster-respawn-floor', 2, 0)
    expect(floorClamp.health).toBe(50)
  })

  it('tierStatScale grows geometrically and ignores invalid configs', () => {
    // 티어 1 = 기준 (배율 1)
    expect(tierStatScale(1, 1.25)).toBe(1)
    // 티어 N = scalePerTier^(N-1) — 1.25의 거듭제곱은 부동소수점에서도 정확하다
    expect(tierStatScale(3, 1.25)).toBe(1.5625)
    expect(tierStatScale(4, 1.25)).toBeCloseTo(1.953125)
    // 미설정 → 성장 없음
    expect(tierStatScale(9, undefined)).toBe(1)
    // 1 이하 배율 → 성장 꺼짐
    expect(tierStatScale(9, 1)).toBe(1)
    expect(tierStatScale(9, 0.8)).toBe(1)
    // 티어 0/음수 → 클램프
    expect(tierStatScale(0, 1.25)).toBe(1)
    expect(tierStatScale(-3, 1.25)).toBe(1)
  })

  it('elite chance gates by tier and grows with a cap', () => {
    const config = { firstTier: 3, baseChance: 0.12, chancePerTier: 0.03, chanceCap: 0.35 }

    // 첫 티어 미만 → 엘리트 없음
    expect(eliteChanceForTier(1, config)).toBe(0)
    expect(eliteChanceForTier(2, config)).toBe(0)
    // 첫 엘리트 티어 → 기본 확률
    expect(eliteChanceForTier(3, config)).toBeCloseTo(0.12)
    // 티어당 선형 증가 (티어 5 = 0.12 + 2×0.03)
    expect(eliteChanceForTier(5, config)).toBeCloseTo(0.18)
    // 상한 클램프 (티어 99라도 0.35)
    expect(eliteChanceForTier(99, config)).toBeCloseTo(0.35)
  })

  it('pickElitePrefix maps the random deterministically and tolerates empty lists', () => {
    const prefixes: ElitePrefix[] = [
      { id: 'swift' },
      { id: 'brute' },
      { id: 'cunning' },
    ]

    // 빈 목록 → null (평범한 개체 유지)
    expect(pickElitePrefix([], 0.5)).toBeNull()
    // 인덱스 매핑: floor(0.5×3)=1 → brute, 경계값은 마지막 요소로 클램프
    expect(pickElitePrefix(prefixes, 0.5)?.id).toBe('brute')
    expect(pickElitePrefix(prefixes, 0)?.id).toBe('swift')
    expect(pickElitePrefix(prefixes, 0.999)?.id).toBe('cunning')
    // random이 정확히 1이어도 안전 (모듈로 클램프)
    expect(pickElitePrefix(prefixes, 1)?.id).toBe('swift')
    // 비정상 random(NaN/음수)도 첫 접두사로 안전하게 폴백한다
    expect(pickElitePrefix(prefixes, Number.NaN)?.id).toBe('swift')
    expect(pickElitePrefix(prefixes, -0.5)?.id).toBe('swift')
  })

  it('applyElitePrefix returns a boosted copy without mutating the input', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const base = createRespawnMonster({
      modelUrls: ['/goblin.glb'],
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
    }, 'monster-elite-src', 0, 1)

    const swift: ElitePrefix = { id: 'swift', color: '#7dfcff', speedMultiplier: 1.35, healthMultiplier: 1.25 }
    const promoted = applyElitePrefix(base, swift)

    // 새 객체 — 원본은 훼손되지 않는다
    expect(promoted).not.toBe(base)
    expect(base.health).toBe(100)
    expect(base.eliteId).toBeUndefined()

    // 스탯 반올림 적용 + eliteId 기록
    expect(promoted.eliteId).toBe('swift')
    expect(promoted.maxHealth).toBe(125)
    expect(promoted.health).toBe(125)
    expect(promoted.speed).toBeCloseTo(22 * 1.35)
    // 미지정 배율은 그대로 (반올림 동일값)
    expect(promoted.attackDamage).toBe(base.attackDamage)
    expect(promoted.detectionRadius).toBe(base.detectionRadius)

    // 전체 배율 접두사: 공격력/쿨다운/탐지 반경 모두 반올림 적용
    const full: ElitePrefix = {
      id: 'brute',
      healthMultiplier: 1.8,
      attackMultiplier: 1.4,
      attackCooldownMultiplier: 0.7,
      detectionMultiplier: 1.6,
    }
    const brute = applyElitePrefix(base, full)
    expect(brute.eliteId).toBe('brute')
    expect(brute.maxHealth).toBe(180)
    expect(brute.attackDamage).toBe(Math.round(10 * 1.4))
    expect(brute.attackCooldownMs).toBe(Math.round(1500 * 0.7))
    expect(brute.detectionRadius).toBe(Math.round(120 * 1.6))

    // 체력 배율이 없는 접두사도 안전 (?? 1 기본 가지)
    const bare: ElitePrefix = { id: 'cunning' }
    const unchanged = applyElitePrefix(base, bare)
    expect(unchanged.eliteId).toBe('cunning')
    expect(unchanged.maxHealth).toBe(base.health)
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
      tierScalePerTier: 1.25,
      bossHealthMultiplier: 2,
      bossDamageMultiplier: 0.8,
    }

    // 티어 2 보스: 체력 round(100 × 1.4 × 2 × 1.25) = 350 / 공격 round(10 × 1.4 × 0.8 × 1.25) = 14
    const boss = createBossMonster(config, 'boss-5', 2)

    expect(boss.id).toBe('boss-5')
    expect(boss.modelName).toBe('Giant')
    expect(boss.modelIndex).toBe(1)
    expect(boss.isBoss).toBe(true)
    expect(boss.maxHealth).toBe(350)
    expect(boss.health).toBe(350)
    expect(boss.attackDamage).toBe(14)
    // 시각적으로 크고 (modelScale × 1.6), 활동 반경 전체를 배회
    expect(boss.scale).toBeCloseTo(9.6)
    expect(boss.activityRadius).toBe(170)
    expect(Math.hypot(...boss.position)).toBeLessThanOrEqual(400)

    // 티어가 오른 보스는 기하급수로 강해진다 (티어 3 = ×1.5625)
    const strongerBoss = createBossMonster(config, 'boss-10', 3)
    expect(strongerBoss.maxHealth).toBe(438) // round(100 × 2.8 × 1.5625)
    expect(strongerBoss.attackDamage).toBe(18) // round(10 × 1.12 × 1.5625)

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

  it('fleeHealthRatio monsters flee instead of staggering when badly wounded', () => {
    const resource = makeResource({ health: 100, maxHealth: 100, fleeHealthRatio: 0.25, position: [0, 0] })
    const agent = createMonsterAgent(resource)
    agent.state = 'attack'

    // 체력 100 → 20 (비율 0.2 ≤ 0.25): 경직 대신 도주
    const hitContext = makeContext({ incomingPlayerHits: [{ id: 'monster', damage: 80 }] })
    agent.update(0, 1_000, hitContext)
    expect(resource.health).toBe(20)
    expect(agent.state).toBe('flee')
    expect(agent.animation).toBe('run')

    // 안전 거리 확보 전: 도주 상태를 유지하고 매 프레임 플레이어 반대 방향으로 도망친다
    agent.position = [50, 0]
    agent.update(0.1, 1_500, makeContext({ playerPosition: [10, 0], playerIsChopping: false }))
    expect(agent.state).toBe('flee')
    expect(agent.target[0]).toBeGreaterThan(50) // 플레이어 반대 방향 = +X

    // 도주는 플레이어 반대 방향으로 진행된다

    // 안전 거리(탐지 반경 × fleeSafeDistanceMultiplier = 120 × 1.8 = 216) 확보 시 도주 종료 + 겁먹음
    agent.position = [400, 0]
    const safeContext = makeContext({ playerPosition: [10, 0], playerIsChopping: false })
    agent.update(0.5, 2_000, safeContext)
    expect(agent.state).toBe('idle')
    expect(agent.coweredUntil).toBe(2_000 + 9_000)

    // 겁먹은 상태에서는 자극받아도(팩 응집) 재추격하지 않는다
    agent.position = [50, 0]
    agent.provokedUntil = 20_000
    agent.update(0, 3_000, makeContext({ playerIsChopping: true }))
    expect(agent.state).toBe('idle')

    // cower 만료 후에는 같은 자리에서 다시 추격한다
    agent.update(0, 12_000, makeContext({ playerIsChopping: true }))
    expect(agent.state).toBe('chase')
  })

  it('wounded cowards above the ratio still stagger like everyone else', () => {
    const resource = makeResource({ health: 100, maxHealth: 100, fleeHealthRatio: 0.25, position: [0, 0] })
    const agent = createMonsterAgent(resource)
    agent.state = 'attack'

    // 체력 100 → 83 (비율 0.83 > 0.25): 평범한 경직
    const hitContext = makeContext({ incomingPlayerHits: [{ id: 'monster', damage: 17 }] })
    agent.update(0, 1_000, hitContext)
    expect(agent.state).toBe('hit')
    expect(agent.animation).toBe('hit')
  })

  it('ranged species hold their distance and fire projectiles instead of melee', () => {
    const onAttackPlayer = vi.fn()
    const onRangedAttack = vi.fn()
    const resource = makeResource({ rangedRange: 70, attackCooldownMs: 1_000, position: [0, 0], speed: 40 })

    // 사거리 70 안이지만 근접 거리(20) 밖에서 바로 공격 상태로 전환한다
    const farContext = makeContext({ playerPosition: [50, 0], onAttackPlayer, onRangedAttack })
    const agent = createMonsterAgent(resource)
    agent.update(0, 0, farContext)
    expect(agent.state).toBe('chase')
    agent.update(0, 100, farContext)
    expect(agent.state).toBe('attack')

    // 쿨다운 도달 → 원거리 발사 (onAttackPlayer 아님)
    agent.update(0, 1_200, farContext)
    expect(onRangedAttack).toHaveBeenCalledTimes(1)
    expect(onRangedAttack.mock.calls[0][2]).toBe(resource.attackDamage)
    expect(onAttackPlayer).not.toHaveBeenCalled()

    // 근접 거리로 들어오면 일반 근접 공격으로 전환된다
    const closeContext = makeContext({ playerPosition: [10, 0], onAttackPlayer, onRangedAttack })
    agent.update(0, 2_300, closeContext)
    expect(onAttackPlayer).toHaveBeenCalledTimes(1)
    expect(onRangedAttack).toHaveBeenCalledTimes(1)

    // 사거리를 벗어나면 다시 추격한다 (근접 종족의 30 포기 로직 대신 자기 사거리 사용)
    agent.update(0, 2_400, makeContext({ playerPosition: [90, 0], onAttackPlayer, onRangedAttack }))
    expect(agent.state).toBe('chase')
  })

  it('dampens the effective detection radius with the campfire multiplier', () => {
    const dayDamped = effectiveDetectionRadius({ detectionMultiplier: 0.45 })
    expect(dayDamped).toBeCloseTo(135 * 0.45)

    // 밤 확대와 모닥불 감쇠가 함께 곱해진다
    const nightDamped = effectiveDetectionRadius({ isNight: true, detectionMultiplier: 0.45 })
    expect(nightDamped).toBeCloseTo(135 * 1.5 * 0.45)

    // 미지정 → 기존 동작 유지
    expect(effectiveDetectionRadius({})).toBe(135)

    // 모닥불 빛 안의 플레이어는 밤에도 덜 들킨다 (추격 게이트에 동일 적용)
    const dampedNight = makeContext({ playerPosition: [180, 0], isNight: true, detectionMultiplier: 0.4 })
    const dampedAgent = createMonsterAgent(makeResource({ health: 100 }))
    dampedAgent.update(0, 0, dampedNight)
    expect(dampedAgent.state).toBe('idle')
  })

  it('detours around obstacles and freezes when fully enclosed', () => {
    const agent = createMonsterAgent(makeResource({ speed: 10 }))
    agent.state = 'patrol'
    agent.position = [0, 0]
    agent.target = [10, 0]

    // 직진 후보만 막힘 → 우회 팬의 다음 각도(+π/6)로 빠져나온다.
    // baseAngle = atan2(dx, dz) = π/2 → 스텝 방향 (sin 2π/3, cos 2π/3)
    agent.update(0.5, 0, makeContext({
      playerIsChopping: false,
      obstacleCheck: pos => pos[1] === 0 && pos[0] > 0,
    }))
    expect(agent.position[0]).toBeCloseTo(5 * Math.sin(Math.PI / 2 + Math.PI / 6))
    expect(agent.position[1]).toBeCloseTo(5 * Math.cos(Math.PI / 2 + Math.PI / 6))

    // 전부 막힘 → 제자리 유지
    agent.position = [0, 0]
    agent.update(0.5, 100, makeContext({ playerIsChopping: false, obstacleCheck: () => true }))
    expect(agent.position).toEqual([0, 0])
  })

  it('carries special abilities from speciesBehavior into spawned resources', () => {
    const config = {
      modelUrls: ['/demon.glb'],
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
      attackCooldownMs: 1_000,
      activityRadius: 170,
      modelScale: 6,
      hitStunMs: 700,
      // 단일 URL → modelNames[0] = 'Demon' 이므로 Demon 키로 검증한다
      speciesBehavior: {
        Demon: {
          speedMultiplier: 1.25,
          fleeHealthRatio: 0.25,
          ranged: { range: 70, projectileSpeed: 110 },
        },
      } as Record<string, import('../../src/game/resources/monsters').SpeciesBehavior>,
    }

    const [spawned] = createMonsterResources(config)
    expect(spawned.modelName).toBe('Demon')
    expect(spawned.fleeHealthRatio).toBe(0.25)
    expect(spawned.rangedRange).toBe(70)

    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const respawned = createRespawnMonster(config, 'respawn-1', 0, 1)
    expect(respawned.fleeHealthRatio).toBe(0.25)
    expect(respawned.rangedRange).toBe(70)
  })

  it('carries status infliction recipes from speciesBehavior into spawned and respawned monsters', () => {
    const meleeStatus = { kind: 'bleed' as const, potency: 3, durationMs: 6000, tickIntervalMs: 1000 }
    const rangedStatus = { kind: 'slow' as const, potency: 0.55, durationMs: 4000 }
    const config = {
      modelUrls: ['/demon.glb'],
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
      attackCooldownMs: 1_000,
      activityRadius: 170,
      modelScale: 6,
      hitStunMs: 700,
      speciesBehavior: {
        Demon: {
          ranged: { range: 70, projectileSpeed: 110, status: rangedStatus },
          meleeStatus,
        },
      } as Record<string, import('../../src/game/resources/monsters').SpeciesBehavior>,
    }

    const [spawned] = createMonsterResources(config)
    expect(spawned.rangedStatus).toEqual(rangedStatus)
    expect(spawned.meleeStatus).toEqual(meleeStatus)

    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const respawned = createRespawnMonster(config, 'respawn-2', 0, 1)
    expect(respawned.rangedStatus).toEqual(rangedStatus)
    expect(respawned.meleeStatus).toEqual(meleeStatus)
  })

  it('a slammed (stunned) monster stops chasing/attacking until the stun wears off', () => {
    const stun = { kind: 'stun' as const, durationMs: 1600 }
    const hitContext = makeContext({
      playerIsChopping: true,
      incomingPlayerHits: [{ id: 'monster', damage: 17, status: stun }],
    })
    const resource = makeResource({ health: 100, attackCooldownMs: 1_000, position: [0, 0], speed: 10 })
    const agent = createMonsterAgent(resource)
    agent.state = 'chase'
    agent.target = [50, 0]

    // 기절 부여 프레임: 피해 + hit 유사 상태
    agent.update(0, 1_000, hitContext)
    expect(resource.health).toBe(83)
    expect(agent.state).toBe('hit')
    expect(agent.animation).toBe('hit')
    expect(agent.statuses).toHaveLength(1)

    // 기절 지속 중: chase 컨텍스트여도 제자리 — 이동도 공격도 없다
    const frozenPosition = [...agent.position]
    agent.update(0.1, 1_100, makeContext({ playerIsChopping: true }))
    expect(agent.state).toBe('hit')
    expect(agent.position).toEqual(frozenPosition)

    // 기절 만료 후: hit 경직 타이머를 거쳐 추격 재개
    agent.update(0.55, 2_650, makeContext({ playerIsChopping: true })) // 만료 프레임, hitTimer 550ms
    expect(agent.state).toBe('hit') // 아직 hitStunMs(700) 미달
    agent.update(0.15, 2_800, makeContext({ playerIsChopping: true }))
    expect(agent.state).toBe('chase')
    expect(agent.animation).toBe('run')
    expect(agent.statuses).toHaveLength(0)
  })

  it('stun takes priority over the flee response of cowering species', () => {
    const stun = { kind: 'stun' as const, durationMs: 1600 }
    const context = makeContext({
      playerIsChopping: true,
      incomingPlayerHits: [{ id: 'monster', damage: 90, status: stun }],
    })
    const resource = makeResource({ health: 100, maxHealth: 100, fleeHealthRatio: 0.25 })
    const agent = createMonsterAgent(resource)
    agent.state = 'attack'

    agent.update(0, 1_000, context)

    // 체력 10/100 → 도주 임계(25) 이하지만 기절이 우선한다
    expect(resource.health).toBe(10)
    expect(agent.state).toBe('hit')
    expect(agent.statuses.map(status => status.kind)).toEqual(['stun'])
  })

  it('bleed ticks damage the monster over time and can finish it off', () => {
    const resource = makeResource({ health: 5 })
    const agent = createMonsterAgent(resource)
    agent.statuses.push({ kind: 'bleed', potency: 3, expiresAt: 60_000, tickIntervalMs: 1000, nextTickInMs: 0 })

    agent.update(0.5, 10_000, makeContext({ playerIsChopping: false }))
    expect(resource.health).toBe(2)
    expect(agent.state).not.toBe('death')

    agent.update(0.5, 10_500, makeContext({ playerIsChopping: false }))
    expect(resource.health).toBe(-1)
    expect(agent.state).toBe('death')
    expect(agent.animation).toBe('death')
  })

  it('slow statuses multiply the movement speed used by moveToward', () => {
    const context = makeContext({ playerIsChopping: false })
    const slowed = createMonsterAgent(makeResource({ speed: 10 }))
    slowed.state = 'patrol'
    slowed.position = [0, 0]
    slowed.target = [100, 0]
    slowed.statuses.push({ kind: 'slow', potency: 0.5, expiresAt: 60_000 })

    slowed.update(0.5, 0, context)
    expect(slowed.position[0]).toBeCloseTo(2.5) // 10 × 0.5 × 0.5

    const normal = createMonsterAgent(makeResource({ speed: 10 }))
    normal.state = 'patrol'
    normal.position = [0, 0]
    normal.target = [100, 0]
    normal.update(0.5, 0, context)
    expect(normal.position[0]).toBeCloseTo(5)
  })

  it('passes species status recipes through melee and ranged attacks', () => {
    const onAttackPlayer = vi.fn()
    const meleeStatus = { kind: 'bleed' as const, potency: 3, durationMs: 6000, tickIntervalMs: 1000 }
    const meleer = createMonsterAgent(makeResource({ attackCooldownMs: 1_000, meleeStatus }))
    meleer.state = 'attack'
    meleer.lastAttackTime = 0

    meleer.update(0, 1_000, makeContext({ onAttackPlayer }))
    expect(onAttackPlayer).toHaveBeenCalledWith(meleeStatus)

    const onRangedAttack = vi.fn()
    const rangedStatus = { kind: 'slow' as const, potency: 0.55, durationMs: 4000 }
    const caster = createMonsterAgent(makeResource({ attackCooldownMs: 1_000, rangedRange: 70, rangedStatus }))
    caster.state = 'attack'
    caster.position = [0, 0]
    caster.lastAttackTime = 0
    // 원거리 유지 사거리(20 < 거리 ≤ 70)에서 공격 지속
    caster.update(0, 1_000, makeContext({ onRangedAttack, playerPosition: [40, 0] }))

    expect(onRangedAttack).toHaveBeenCalledTimes(1)
    const call = onRangedAttack.mock.calls[0]
    expect(call[0]).toEqual([0, 0])
    expect(call[1]).toEqual([40, 0])
    expect(call[2]).toBe(caster.resource.attackDamage)
    expect(call[3]).toEqual(rangedStatus)
  })

  it('attacks without a recipe still call onAttackPlayer with a single argument', () => {
    const onAttackPlayer = vi.fn()
    const plain = createMonsterAgent(makeResource({ attackCooldownMs: 1_000 }))
    plain.state = 'attack'
    plain.lastAttackTime = 0

    plain.update(0, 1_000, makeContext({ onAttackPlayer }))

    expect(onAttackPlayer).toHaveBeenCalledTimes(1)
    expect(onAttackPlayer.mock.calls[0]).toHaveLength(0)
  })
})
