import { describe, expect, it } from 'vitest'

import { createLightingController } from '../../src/game/time/lighting'

function createLights() {
  return {
    hemisphere: { intensity: 0 },
    ambient: { intensity: 0 },
    key: { intensity: 0 },
    rim: { intensity: 0 },
  }
}

describe('createLightingController', () => {
  it.each([
    ['day', 0.5, [1.9, 0.55, 4.6, 1.1]],
    ['night', 0.1, [0.6, 0.2, 1.2, 0.3]],
    ['dawn', 0.3, [1.25, 0.375, 2.9, 0.7]],
    ['dusk', 0.7, [1.25, 0.375, 2.9, 0.7]],
  ] as const)('applies %s lighting', (timeOfDay, progress, expected) => {
    const lights = createLights()
    const controller = createLightingController(
      lights as unknown as Parameters<typeof createLightingController>[0],
    )

    controller.update(progress, timeOfDay)

    expect([
      lights.hemisphere.intensity,
      lights.ambient.intensity,
      lights.key.intensity,
      lights.rim.intensity,
    ]).toEqual(expected.map(value => expect.closeTo(value)))
  })
})
