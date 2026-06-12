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

export type TreeResourceConfig = {
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
const NOISE_OCTAVES = [
	{ frequency: 1, amplitude: 0.58 },
	{ frequency: 2.1, amplitude: 0.28 },
	{ frequency: 4.3, amplitude: 0.14 },
]

export function createNoiseTrees(config: TreeResourceConfig): TreeResource[] {
	const trees: TreeResource[] = []
	const halfGrid = Math.floor(config.gridSize / 2)

	for (let row = -halfGrid; row <= halfGrid; row += 1) {
		for (let column = -halfGrid; column <= halfGrid; column += 1) {
			const offsetX = (column + (Math.abs(row) % 2) * 0.5) * config.radiusMeters / halfGrid
			const offsetZ = row * config.radiusMeters * SQRT_3_HALF / halfGrid
			const distance = Math.hypot(offsetX, offsetZ)

			if (distance > config.radiusMeters) continue

			const noise = fractalNoise(
				column * config.noiseScale,
				row * config.noiseScale,
				config.seed,
			)
			const edgeFalloff = 1 - Math.max(0, distance / config.radiusMeters - 0.72) / 0.28
			const density = noise * Math.max(0, Math.min(1, edgeFalloff))

			if (density < config.densityThreshold) continue

			const jitterAngle = random2D(column, row, config.seed + 101) * Math.PI * 2
			const jitterRadius = random2D(column, row, config.seed + 202) * 18
			const modelIndex = Math.floor(random2D(column, row, config.seed + 303) * config.modelUrls.length)

			trees.push({
				id: `tree-${row + halfGrid}-${column + halfGrid}`,
				modelIndex: Math.min(config.modelUrls.length - 1, modelIndex),
				position: [
					offsetX + Math.cos(jitterAngle) * jitterRadius,
					offsetZ + Math.sin(jitterAngle) * jitterRadius,
				],
				rotation: random2D(column, row, config.seed + 404) * Math.PI * 2,
				scale: config.modelScale * (0.82 + random2D(column, row, config.seed + 505) * 0.36),
				wood: config.woodPerTree,
				noise,
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

export function distanceMeters(from: PlanePoint, to: PlanePoint) {
	return Math.hypot(to[0] - from[0], to[1] - from[1])
}

function fractalNoise(x: number, y: number, seed: number) {
	let value = 0
	let amplitudeTotal = 0

	NOISE_OCTAVES.forEach(octave => {
		value += valueNoise(x * octave.frequency, y * octave.frequency, seed) * octave.amplitude
		amplitudeTotal += octave.amplitude
	})

	return value / amplitudeTotal
}

function valueNoise(x: number, y: number, seed: number) {
	const x0 = Math.floor(x)
	const y0 = Math.floor(y)
	const x1 = x0 + 1
	const y1 = y0 + 1
	const sx = smoothstep(x - x0)
	const sy = smoothstep(y - y0)
	const top = lerp(random2D(x0, y0, seed), random2D(x1, y0, seed), sx)
	const bottom = lerp(random2D(x0, y1, seed), random2D(x1, y1, seed), sx)
	return lerp(top, bottom, sy)
}

function random2D(x: number, y: number, seed: number) {
	const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123
	return value - Math.floor(value)
}

function smoothstep(value: number) {
	return value * value * (3 - 2 * value)
}

function lerp(start: number, end: number, amount: number) {
	return start + (end - start) * amount
}
