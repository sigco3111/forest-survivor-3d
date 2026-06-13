import type {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
} from 'three'
import type { TimeOfDay } from './day-cycle'

type Lights = {
  hemisphere: HemisphereLight
  ambient: AmbientLight
  key: DirectionalLight
  rim: DirectionalLight
}

type LightValues = {
  hemisphereIntensity: number
  ambientIntensity: number
  keyIntensity: number
  rimIntensity: number
}

const DAY_VALUES: LightValues = {
  hemisphereIntensity: 1.9,
  ambientIntensity: 0.55,
  keyIntensity: 4.6,
  rimIntensity: 1.1,
}

const NIGHT_VALUES: LightValues = {
  hemisphereIntensity: 0.6,
  ambientIntensity: 0.2,
  keyIntensity: 1.2,
  rimIntensity: 0.3,
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpValues(from: LightValues, to: LightValues, t: number): LightValues {
  return {
    hemisphereIntensity: lerp(from.hemisphereIntensity, to.hemisphereIntensity, t),
    ambientIntensity: lerp(from.ambientIntensity, to.ambientIntensity, t),
    keyIntensity: lerp(from.keyIntensity, to.keyIntensity, t),
    rimIntensity: lerp(from.rimIntensity, to.rimIntensity, t),
  }
}

export type LightingController = {
  update(dayProgress: number, timeOfDay: TimeOfDay): void
}

export function createLightingController(lights: Lights): LightingController {
  return {
    update(dayProgress: number, timeOfDay: TimeOfDay) {
      let values: LightValues

      switch (timeOfDay) {
        case 'day':
          values = DAY_VALUES
          break
        case 'night':
          values = NIGHT_VALUES
          break
        case 'dawn': {
          // dayProgress 在 0.25..0.35，映射到 0..1
          const t = (dayProgress - 0.25) / 0.1
          values = lerpValues(NIGHT_VALUES, DAY_VALUES, t)
          break
        }
        case 'dusk': {
          // dayProgress 在 0.65..0.75，映射到 0..1
          const t = (dayProgress - 0.65) / 0.1
          values = lerpValues(DAY_VALUES, NIGHT_VALUES, t)
          break
        }
      }

      lights.hemisphere.intensity = values.hemisphereIntensity
      lights.ambient.intensity = values.ambientIntensity
      lights.key.intensity = values.keyIntensity
      lights.rim.intensity = values.rimIntensity
    },
  }
}
