import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  collectTree,
  createNoiseTrees,
  createRandomTree,
  findNearbyTree,
  type TreeResource,
} from '../../src/game/resources/trees'

function makeTree(overrides: Partial<TreeResource> = {}): TreeResource {
  return {
    id: 'tree',
    modelIndex: 0,
    position: [0, 0],
    rotation: 0,
    scale: 1,
    wood: 3,
    noise: 0.5,
    collected: false,
    ...overrides,
  }
}

describe('tree resources', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('generates a deterministic, density-sorted tree set', () => {
    const config = {
      densityThreshold: 0.35,
      deadModelUrls: ['/dead.glb'],
      gridSize: 12,
      maxTrees: 16,
      modelScale: 10,
      modelUrls: ['/one.glb', '/two.glb'],
      noiseScale: 0.12,
      radiusMeters: 200,
      seed: 42,
      woodPerTree: 4,
    }

    const first = createNoiseTrees(config)
    const second = createNoiseTrees(config)

    expect(first).toEqual(second)
    expect(first.length).toBeGreaterThan(0)
    expect(first.length).toBeLessThanOrEqual(config.maxTrees)
    expect(first.every(tree => tree.wood === 4 && !tree.collected)).toBe(true)
    expect(first.every(tree => tree.modelIndex >= 0 && tree.modelIndex < 2)).toBe(true)
    expect(first.every((tree, index) => index === 0 || first[index - 1].noise >= tree.noise)).toBe(true)
  })

  it('finds the closest available tree and marks it collected', () => {
    const closest = makeTree({ id: 'closest', position: [2, 0] })
    const collected = makeTree({ id: 'collected', position: [1, 0], collected: true })
    const farther = makeTree({ id: 'farther', position: [4, 0] })

    expect(findNearbyTree([farther, collected, closest], [0, 0], 5)).toBe(closest)
    expect(collectTree(closest)).toBe(closest)
    expect(closest.collected).toBe(true)
    expect(findNearbyTree([farther, collected, closest], [0, 0], 3)).toBeNull()
  })

  it('respects minimum spacing when creating a replacement tree', () => {
    const existing = [makeTree({ position: [0, 0] })]
    const config = {
      radiusMeters: 100,
      modelScale: 10,
      woodPerTree: 5,
      respawnMinSpacing: 20,
    }

    expect(createRandomTree(existing, 2, config, [10, 0])).toBeNull()

    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const replacement = createRandomTree(existing, 2, config, [30, 0])

    expect(replacement).toMatchObject({
      modelIndex: 1,
      position: [30, 0],
      scale: 10,
      wood: 5,
      collected: false,
    })
  })

  it('creates a random-position tree and ignores collected neighbors', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const collectedNeighbor = makeTree({ collected: true, position: [-40, 0] })

    const tree = createRandomTree(
      [collectedNeighbor],
      1,
      { radiusMeters: 100, modelScale: 10, woodPerTree: 2, respawnMinSpacing: 100 },
    )

    expect(tree).not.toBeNull()
    expect(tree!.position[0]).toBeCloseTo(-40)
    expect(tree!.position[1]).toBeCloseTo(0)
  })
})
