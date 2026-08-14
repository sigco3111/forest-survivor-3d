import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createPlayerAgent,
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
    let threats: PlayerThreatSource[] = [makeThreat()]
    const agent = createPlayerAgent([1, 0], makeConfig({ threatSources: () => threats }))

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
    const near = makeThreat({ position: [2, 0], activityRadius: 30 })
    const farther = makeThreat({ position: [10, 0], activityRadius: 30 })
    const agent = createPlayerAgent(
      [0, 0],
      makeConfig({ threatSources: () => [outside, near, farther] }),
    )

    agent.update(0, 0)

    expect(agent.state).toBe('fleeing')
  })

  it('uses exploration fallback when every flee route is blocked', () => {
    const threat = makeThreat({ position: [1, 0], homePosition: [0, 0], activityRadius: 20 })
    const agent = createPlayerAgent(
      [0, 0],
      makeConfig({ collisionCheck: () => true, threatSources: () => [threat] }),
    )

    agent.update(0, 0)

    expect(agent.state).toBe('fleeing')
    expect(agent.target).toEqual([0, 0])

    let collisionCalls = 0
    const outwardAgent = createPlayerAgent([10, 0], makeConfig({
      collisionCheck: () => collisionCalls++ < 16,
      threatSources: () => [threat],
    }))
    collisionCalls = 0
    outwardAgent.update(0, 0)
    expect(outwardAgent.target).toEqual([46, 0])
  })
})
