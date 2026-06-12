import { createNoise2D } from 'simplex-noise'

import type { PlanePoint } from './trees'

export type EnvironmentObject = {
	id: string
	modelCategory: 'flower' | 'grass' | 'plant'
	modelIndex: number
	position: PlanePoint
	rotation: number
	scale: number
}

type EnvironmentConfig = {
	modelUrls: Record<string, string[]>
	seed: number
	count: number
	radiusMeters: number
	scaleRange: [number, number]
	collisionRadius: number
}

const CATEGORIES: Array<{ name: 'flower' | 'grass' | 'plant'; weight: number }> = [
	{ name: 'grass', weight: 0.5 },
	{ name: 'flower', weight: 0.25 },
	{ name: 'plant', weight: 0.25 },
]

function seededRandom(seed: number) {
	let s = seed
	return () => {
		s = (s * 16807 + 0) % 2147483647
		return (s - 1) / 2147483646
	}
}

export function createEnvironmentObjects(config: EnvironmentConfig): EnvironmentObject[] {
	const objects: EnvironmentObject[] = []
	const maxRadius = config.radiusMeters * 0.85
	const angleNoise = createNoise2D(seededRandom(config.seed))
	const distNoise = createNoise2D(seededRandom(config.seed + 100))
	const catNoise = createNoise2D(seededRandom(config.seed + 200))
	const modelNoise = createNoise2D(seededRandom(config.seed + 300))
	const scaleNoise = createNoise2D(seededRandom(config.seed + 400))
	const rotNoise = createNoise2D(seededRandom(config.seed + 500))

	for (let i = 0; i < config.count; i++) {
		const ni = i * 0.37 // 噪声采样间距，避免相邻输入太近
		const angle = (angleNoise(ni, 0) + 1) * Math.PI
		const distFactor = (distNoise(ni, 100) + 1) * 0.5 // [0, 1]
		const dist = Math.sqrt(distFactor) * maxRadius
		const position: PlanePoint = [Math.cos(angle) * dist, Math.sin(angle) * dist]

		const catRoll = (catNoise(ni, 200) + 1) * 0.5 // [0, 1]
		let cumulative = 0
		let category: 'flower' | 'grass' | 'plant' = 'grass'
		for (const cat of CATEGORIES) {
			cumulative += cat.weight
			if (catRoll < cumulative) {
				category = cat.name
				break
			}
		}

		const urls = config.modelUrls[category]
		const modelIndex = Math.floor((modelNoise(ni, 300) + 1) * 0.5 * urls.length)
		const [minScale, maxScale] = config.scaleRange
		const scale = minScale + (scaleNoise(ni, 400) + 1) * 0.5 * (maxScale - minScale)

		objects.push({
			id: `env-${i}`,
			modelCategory: category,
			modelIndex: Math.min(urls.length - 1, modelIndex),
			position,
			rotation: (rotNoise(ni, 500) + 1) * Math.PI,
			scale,
		})
	}

	return objects
}
