import { AnimationClip, Object3D } from 'three'
import { describe, expect, it, vi } from 'vitest'

import { createPlayerAnimationController } from '../../src/game/player/animations'
import { createMonsterAnimationController } from '../../src/game/player/monster-animations'

function clips(names: string[]) {
  return names.map(name => new AnimationClip(name, 1, []))
}

describe('player animation controller', () => {
  it('matches named clips, switches actions, and updates the mixer', () => {
    const controller = createPlayerAnimationController(
      new Object3D(),
      clips(['death', 'idle', 'interact', 'run', 'walk', 'wave']),
    )
    const walk = controller.actions.walk!
    const run = controller.actions.run!
    const walkFadeOut = vi.spyOn(walk, 'fadeOut')
    const runReset = vi.spyOn(run, 'reset')

    controller.play('run')
    controller.play('run')
    controller.update(0.016)

    expect(runReset).toHaveBeenCalledOnce()
    expect(walkFadeOut).toHaveBeenCalledWith(0.2)
  })

  it('uses indexed fallbacks and safely ignores missing actions', () => {
    const fallbackClips = Array.from({ length: 17 }, (_, index) =>
      new AnimationClip(`clip-${index}`, 1, []),
    )
    const fallback = createPlayerAnimationController(new Object3D(), fallbackClips, 'death')
    expect(Object.values(fallback.actions).every(Boolean)).toBe(true)

    const empty = createPlayerAnimationController(new Object3D(), [])
    expect(Object.values(empty.actions).every(action => action === null)).toBe(true)
    empty.play('idle')
  })
})

describe('monster animation controller', () => {
  it('matches named clips and cross-fades between actions', () => {
    const source = clips(['idle', 'walk', 'run', 'attack', 'death', 'hitrecieve', 'tending'])
    const controller = createMonsterAnimationController(new Object3D(), source)

    controller.play('walk')
    controller.play('walk')
    controller.play('attack')
    controller.update(0.016)
  })

  it('uses indexed fallbacks and ignores absent clips', () => {
    const fallbackClips = Array.from({ length: 7 }, (_, index) =>
      new AnimationClip(`clip-${index}`, 1, []),
    )
    const fallback = createMonsterAnimationController(new Object3D(), fallbackClips, 'death')
    fallback.play('run')

    const empty = createMonsterAnimationController(new Object3D(), [])
    empty.play('hit')
  })
})
