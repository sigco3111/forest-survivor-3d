import {
	collectTree,
	findNearbyTree,
	type PlanePoint,
	type TreeResource,
} from '../resources/trees'

export type PlayerAgentState = 'exploring' | 'approaching' | 'chopping'

export type PlayerAgentConfig = {
	exploreDistance: number       // 探索/扫描树的半径
	speed: number                 // 移动速度（单位/秒）
	collectRadius: number         // 开始砍树的距离
	chopDurationMs: number        // 砍树耗时（毫秒）
	worldRadius: number           // 世界半径
	collisionCheck: (position: PlanePoint) => boolean
	treeResources: () => TreeResource[]
}

export type PlayerAgent = {
	state: PlayerAgentState
	position: PlanePoint
	bearing: number
	target: PlanePoint
	choppingProgress: number
	activeTree: TreeResource | null
	woodCollected: number
	animation: 'walk' | 'interact' | null
	lastCollectedTree: TreeResource | null

	update(delta: number, now: number): void
}

export function createPlayerAgent(
	startPosition: PlanePoint,
	config: PlayerAgentConfig,
): PlayerAgent {
	return {
		state: 'exploring',
		position: [...startPosition],
		bearing: 0,
		target: pickExplorationTarget(startPosition, config),
		choppingProgress: 0,
		activeTree: null,
		woodCollected: 0,
		animation: 'walk',
		lastCollectedTree: null,

		update(delta, now) {
			switch (this.state) {
				case 'exploring':
					updateExploring(this, delta, config)
					break
				case 'approaching':
					updateApproaching(this, delta, config)
					break
				case 'chopping':
					updateChopping(this, now, config)
					break
			}
		},
	}
}

// ===== 探索：随机走，扫描范围内有树就靠近 =====
let lastTreeScan = 0

function updateExploring(agent: PlayerAgent, delta: number, config: PlayerAgentConfig) {
	moveToward(agent, delta, config)

	if (distanceTo(agent.position, agent.target) < 2) {
		agent.target = pickExplorationTarget(agent.position, config)
	}

	// 每隔一小段距离扫描附近是否有树
	const nearbyTree = findNearbyTree(
		config.treeResources(),
		agent.position,
		config.exploreDistance,
	)

	if (nearbyTree) {
		agent.activeTree = nearbyTree
		agent.target = [...nearbyTree.position]
		agent.state = 'approaching'
		agent.bearing = faceTarget(agent, agent.target)
	}
}

// ===== 向树靠近 =====
function updateApproaching(agent: PlayerAgent, delta: number, config: PlayerAgentConfig) {
	if (!agent.activeTree || agent.activeTree.collected) {
		agent.activeTree = null
		agent.state = 'exploring'
		agent.target = pickExplorationTarget(agent.position, config)
		agent.animation = 'walk'
		return
	}

	agent.target = [...agent.activeTree.position]
	moveToward(agent, delta, config)
	agent.bearing = faceTarget(agent, agent.target)

	const dist = distanceTo(agent.position, agent.activeTree.position)
	if (dist <= config.collectRadius) {
		agent.state = 'chopping'
		agent.choppingProgress = 0.01
		agent.animation = 'interact'
		lastTreeScan = performance.now()
	}
}

// ===== 砍树 =====
function updateChopping(agent: PlayerAgent, now: number, config: PlayerAgentConfig) {
	if (!agent.activeTree) {
		agent.state = 'exploring'
		agent.target = pickExplorationTarget(agent.position, config)
		agent.animation = 'walk'
		return
	}

	// 面向树
	agent.bearing = faceTarget(agent, agent.activeTree.position)

	// 更新进度
	agent.choppingProgress = Math.min(1, (now - lastTreeScan) / config.chopDurationMs)

	if (agent.choppingProgress >= 1) {
		const tree = collectTree(agent.activeTree)
		agent.woodCollected += tree.wood
		agent.lastCollectedTree = tree
		agent.activeTree = null
		agent.choppingProgress = 0
		agent.state = 'exploring'
		agent.target = pickExplorationTarget(agent.position, config)
		agent.animation = 'walk'
	}
}

// ===== 移动 =====
function moveToward(agent: PlayerAgent, delta: number, config: PlayerAgentConfig) {
	const dx = agent.target[0] - agent.position[0]
	const dz = agent.target[1] - agent.position[1]
	const distance = Math.hypot(dx, dz)

	if (distance < 1) return

	const travelDistance = Math.min(distance, config.speed * delta)
	const directionX = dx / distance
	const directionZ = dz / distance
	const newPosition: PlanePoint = [
		agent.position[0] + directionX * travelDistance,
		agent.position[1] + directionZ * travelDistance,
	]

	if (config.collisionCheck(newPosition)) {
		agent.target = pickExplorationTarget(agent.position, config)
		return
	}

	agent.position = newPosition
}

function faceTarget(agent: PlayerAgent, target: PlanePoint): number {
	return Math.atan2(target[0] - agent.position[0], target[1] - agent.position[1])
}

// ===== 目标选择 =====
function pickExplorationTarget(position: PlanePoint, config: PlayerAgentConfig): PlanePoint {
	for (let attempt = 0; attempt < 10; attempt++) {
		const minDistance = config.exploreDistance * 0.55
		const distance = minDistance + Math.random() * (config.exploreDistance - minDistance)
		const angle = Math.random() * Math.PI * 2
		let next: PlanePoint = [
			position[0] + Math.sin(angle) * distance,
			position[1] + Math.cos(angle) * distance,
		]
		const distanceFromCenter = Math.hypot(next[0], next[1])

		if (distanceFromCenter > config.worldRadius * 0.84) {
			next = [
				next[0] * (config.worldRadius * 0.72 / distanceFromCenter),
				next[1] * (config.worldRadius * 0.72 / distanceFromCenter),
			]
		}

		if (!config.collisionCheck(next)) return next
	}

	return [position[0], position[1]]
}

function distanceTo(from: PlanePoint, to: PlanePoint): number {
	return Math.hypot(to[0] - from[0], to[1] - from[1])
}
