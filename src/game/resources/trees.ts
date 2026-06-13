import { createNoise2D } from 'simplex-noise'

export type PlanePoint = [number, number]

export type TreeResource = {
	id: string
	modelIndex: number
	position: PlanePoint
	rotation: number
	scale: number
	wood: number
	noise: number
	collected: boolean
}

type TreeResourceConfig = {
	densityThreshold: number
	deadModelUrls: string[]
	gridSize: number
	maxTrees: number
	modelScale: number
	modelUrls: string[]
	noiseScale: number
	radiusMeters: number
	seed: number
	woodPerTree: number
}

const SQRT_3_HALF = Math.sqrt(3) / 2

function seededRandom(seed: number) {
	let s = seed
	return () => {
		s = (s * 16807 + 0) % 2147483647
		return (s - 1) / 2147483646
	}
}

export function createNoiseTrees(config: TreeResourceConfig): TreeResource[] {
	const trees: TreeResource[] = []
	const halfGrid = Math.floor(config.gridSize / 2)
	const noise2d = createNoise2D(seededRandom(config.seed))
	const jitter = createNoise2D(seededRandom(config.seed + 101))
	const rotation = createNoise2D(seededRandom(config.seed + 202))
	const scaleNoise = createNoise2D(seededRandom(config.seed + 303))
	const modelNoise = createNoise2D(seededRandom(config.seed + 404))

	for (let row = -halfGrid; row <= halfGrid; row += 1) {
		for (let column = -halfGrid; column <= halfGrid; column += 1) {
			const offsetX = (column + (Math.abs(row) % 2) * 0.5) * config.radiusMeters / halfGrid
			const offsetZ = row * config.radiusMeters * SQRT_3_HALF / halfGrid
			const distance = Math.hypot(offsetX, offsetZ)

			if (distance > config.radiusMeters) continue

			// 用 simplex noise 生成密度
			const n = noise2d(column * config.noiseScale, row * config.noiseScale)
			const density = (n + 1) * 0.5 // simplex 返回 [-1, 1]，映射到 [0, 1]
			const edgeFalloff = 1 - Math.max(0, distance / config.radiusMeters - 0.72) / 0.28
			const finalDensity = density * Math.max(0, Math.min(1, edgeFalloff))

			if (finalDensity < config.densityThreshold) continue

			const jx = jitter(column * 0.7, row * 0.7) * 18
			const jz = jitter(column * 0.7 + 100, row * 0.7 + 100) * 18
			const modelIndex = Math.floor((modelNoise(column * 0.5, row * 0.5) + 1) * 0.5 * config.modelUrls.length)

			trees.push({
				id: `tree-${row + halfGrid}-${column + halfGrid}`,
				modelIndex: Math.min(config.modelUrls.length - 1, modelIndex),
				position: [offsetX + jx, offsetZ + jz],
				rotation: (rotation(column * 0.3, row * 0.3) + 1) * Math.PI,
				scale: config.modelScale * (0.82 + (scaleNoise(column * 0.4, row * 0.4) + 1) * 0.5 * 0.36),
				wood: config.woodPerTree,
				noise: finalDensity,
				collected: false,
			})
		}
	}

	return trees.sort((left, right) => right.noise - left.noise).slice(0, config.maxTrees)
}

export function findNearbyTree(
	trees: TreeResource[],
	position: PlanePoint,
	radiusMeters: number,
): TreeResource | null {
	let closestTree: TreeResource | null = null
	let closestDistance = radiusMeters

	for (const tree of trees) {
		if (tree.collected) continue

		const distance = distanceMeters(position, tree.position)
		if (distance <= closestDistance) {
			closestTree = tree
			closestDistance = distance
		}
	}

	return closestTree
}

export function collectTree(tree: TreeResource) {
	tree.collected = true
	return tree
}

export function createRandomTree(
	existingTrees: TreeResource[],
	modelCount: number,
	config: { radiusMeters: number; modelScale: number; woodPerTree: number; respawnMinSpacing: number },
	forcedPosition?: PlanePoint,
): TreeResource | null {
	const maxRadius = config.radiusMeters * 0.8

	for (let attempt = 0; attempt < 10; attempt++) {
		const position: PlanePoint = forcedPosition
			? [...forcedPosition]
			: (() => {
					const angle = Math.random() * Math.PI * 2
					const dist = Math.random() * maxRadius
					return [Math.cos(angle) * dist, Math.sin(angle) * dist] as PlanePoint
				})()

		const tooClose = existingTrees.some(tree => {
			if (tree.collected) return false
			return distanceMeters(position, tree.position) < config.respawnMinSpacing
		})
		if (tooClose) continue

		return {
			id: `tree-rand-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
			modelIndex: Math.floor(Math.random() * modelCount),
			position,
			rotation: Math.random() * Math.PI * 2,
			scale: config.modelScale * (0.82 + Math.random() * 0.36),
			wood: config.woodPerTree,
			noise: 0.5,
			collected: false,
		}
	}

	return null
}

function distanceMeters(from: PlanePoint, to: PlanePoint) {
	return Math.hypot(to[0] - from[0], to[1] - from[1])
}
