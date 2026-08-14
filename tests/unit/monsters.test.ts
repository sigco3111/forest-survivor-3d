import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createMonsterAgent,
  createMonsterResources,
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
    })

    expect(resources.some(resource => resource.modelIndex === 6 && resource.modelName === 'Demon')).toBe(true)
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
})
