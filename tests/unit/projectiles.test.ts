import { describe, expect, it, vi } from 'vitest'

import {
  createProjectileManager,
} from '../../src/game/resources/projectiles'
import type { PlanePoint } from '../../src/game/resources/trees'

describe('projectile manager', () => {
  it('advances flight by the exact fraction and clamps at impact', () => {
    const onHit = vi.fn()
    const manager = createProjectileManager({ speedUnitsPerSecond: 110 }, { onHit })

    manager.spawn([0, 0], [100, 0], 7)
    // 110 × 0.5 / 100 = 0.55 — 아직 비행 중
    manager.update(0.5)
    expect(manager.active()).toHaveLength(1)
    expect(manager.active()[0]?.progress).toBe(0.55)
    expect(onHit).not.toHaveBeenCalled()

    // 0.55 + 110 × 1 / 100 = 1.65 → 1로 클램프되어 명중
    manager.update(1)
    expect(onHit).toHaveBeenCalledTimes(1)
    expect(onHit).toHaveBeenCalledWith(7)
    expect(manager.active()).toEqual([])
  })

  it('flies across multiple frames: half progress then arrival', () => {
    const onHit = vi.fn()
    const manager = createProjectileManager({ speedUnitsPerSecond: 10 }, { onHit })

    manager.spawn([0, 0], [20, 0], 4)
    manager.update(1)
    // 10 × 1 / 20 = 0.5
    expect(manager.active()[0]?.progress).toBe(0.5)
    expect(onHit).not.toHaveBeenCalled()

    manager.update(1)
    expect(onHit).toHaveBeenCalledTimes(1)
    expect(onHit).toHaveBeenCalledWith(4)
    expect(manager.active()).toEqual([])
  })

  it('holds a zero-distance projectile until the next update hits it', () => {
    const onHit = vi.fn()
    const manager = createProjectileManager({ speedUnitsPerSecond: 50 }, { onHit })

    manager.spawn([5, 5], [5, 5], 9)
    const flying = manager.active()
    expect(flying).toHaveLength(1)
    expect(flying[0]?.progress).toBe(1)
    expect(onHit).not.toHaveBeenCalled()

    manager.update(0.016)
    expect(onHit).toHaveBeenCalledTimes(1)
    expect(onHit).toHaveBeenCalledWith(9)
    expect(manager.active()).toEqual([])
  })

  it('resolves same-frame arrivals in spawn order with sequential ids', () => {
    const onHit = vi.fn()
    const manager = createProjectileManager({ speedUnitsPerSecond: 100 }, { onHit })

    manager.spawn([0, 0], [10, 0], 11)
    manager.spawn([0, 0], [20, 0], 22)
    expect(manager.active().map(p => p.id)).toEqual([1, 2])

    manager.update(1)
    expect(onHit.mock.calls.map(call => call[0])).toEqual([11, 22])
    expect(manager.active()).toEqual([])
  })

  it('keeps slow flights airborne while faster ones land independently', () => {
    const onHit = vi.fn()
    const manager = createProjectileManager({ speedUnitsPerSecond: 100 }, { onHit })

    manager.spawn([0, 0], [1000, 0], 3)
    manager.spawn([0, 0], [50, 0], 6)

    manager.update(1)
    // 느린 투사체(0.1)는 공중에 남고, 빠른 투사체(2.0 → 클램프)만 명중한다
    expect(onHit).toHaveBeenCalledTimes(1)
    expect(onHit).toHaveBeenCalledWith(6)
    const remaining = manager.active()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.damage).toBe(3)
    expect(remaining[0]?.progress).toBe(0.1)
  })

  it('clears every flight without firing onHit', () => {
    const onHit = vi.fn()
    const manager = createProjectileManager({ speedUnitsPerSecond: 100 }, { onHit })

    manager.spawn([0, 0], [10, 0], 5)
    manager.spawn([5, 5], [5, 5], 8)
    manager.clear()
    expect(manager.active()).toEqual([])

    manager.update(1)
    expect(onHit).not.toHaveBeenCalled()
  })

  it('copies spawn endpoints so later caller mutations do not matter', () => {
    const onHit = vi.fn()
    const manager = createProjectileManager({ speedUnitsPerSecond: 100 }, { onHit })

    const from: PlanePoint = [0, 0]
    const to: PlanePoint = [100, 0]
    manager.spawn(from, to, 2)
    from[0] = 999
    to[0] = -999

    const flying = manager.active()
    expect(flying[0]?.from).toEqual([0, 0])
    expect(flying[0]?.to).toEqual([100, 0])

    manager.update(1)
    expect(onHit).toHaveBeenCalledTimes(1)
  })
})
