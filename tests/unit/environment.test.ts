import { describe, expect, it } from 'vitest'

import { createEnvironmentObjects } from '../../src/game/resources/environment'

const config = {
  modelUrls: {
    flower: ['/flower.glb'],
    grass: ['/grass-1.glb', '/grass-2.glb'],
    plant: ['/plant.glb'],
  },
  seed: 4200,
  count: 200,
  radiusMeters: 100,
  scaleRange: [2, 5] as [number, number],
  collisionRadius: 6,
}

describe('createEnvironmentObjects', () => {
  it('generates a deterministic set within configured bounds', () => {
    const objects = createEnvironmentObjects(config)

    expect(objects).toEqual(createEnvironmentObjects(config))
    expect(objects).toHaveLength(config.count)
    expect(new Set(objects.map(object => object.modelCategory))).toEqual(
      new Set(['flower', 'grass', 'plant']),
    )
    expect(objects.every(object => Math.hypot(...object.position) <= 85)).toBe(true)
    expect(objects.every(object => object.scale >= 2 && object.scale <= 5)).toBe(true)
    expect(objects.every(object => object.modelIndex >= 0)).toBe(true)
  })

  it('supports an empty environment', () => {
    expect(createEnvironmentObjects({ ...config, count: 0 })).toEqual([])
  })
})
