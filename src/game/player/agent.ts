import {
	collectTree,
	findNearbyTree,
	type PlanePoint,
	type TreeResource,
} from '../resources/trees'

export type PlayerAgentState = 'exploring' | 'approaching' | 'chopping' | 'fleeing'

export type PlayerThreatSource = {
	position: PlanePoint
	homePosition: PlanePoint
	activityRadius: number
	speed: number
	attackRadius: number
}

type AvoidedArea = {
	center: PlanePoint
	radius: number
	expiresAt: number
}

type FailedAreaAttempt = {
	center: PlanePoint
	radius: number
	count: number
	lastAttemptAt: number
}

export type PlayerAgentConfig = {
	exploreDistance: number       // 探索/扫描树的半径
	speed: number                 // 移动速度（单位/秒）
	collectRadius: number         // 开始砍树的距离
	chopDurationMs: number        // 砍树耗时（毫秒）
	worldRadius: number           // 世界半径
	collisionCheck: (position: PlanePoint) => boolean
	treeResources: () => TreeResource[]
	threatSources: () => PlayerThreatSource[]
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
	playerAlive: boolean
	avoidedAreas: AvoidedArea[]
	failedAreaAttempt: FailedAreaAttempt | null

	update(delta: number, now: number): void
}

const AREA_FAILURE_LIMIT = 2
const AREA_FAILURE_MEMORY_MS = 22_000
const AREA_AVOID_DURATION_MS = 45_000
const AREA_AVOID_PADDING = 45

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
		playerAlive: true,
		avoidedAreas: [],
		failedAreaAttempt: null,

		update(delta, now) {
			if (!this.playerAlive) return
			pruneAvoidedAreas(this, now)

			const threat = findActiveThreat(this.position, config)
			if (threat && shouldFleeThreat(this, now, threat, config)) {
				registerFailedAreaAttempt(this, threat, now)
				startFleeing(this, threat, config, now)
			}

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
				case 'fleeing':
					updateFleeing(this, delta, config)
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
		agent.target = pickExplorationTarget(agent.position, config, agent.avoidedAreas)
	}

	// 每隔一小段距离扫描附近是否有树
	const nearbyTree = findNearbyTree(
		availableTrees(agent, config),
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
		agent.target = pickExplorationTarget(agent.position, config, agent.avoidedAreas)
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
		agent.target = pickExplorationTarget(agent.position, config, agent.avoidedAreas)
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
		agent.failedAreaAttempt = null
		agent.activeTree = null
		agent.choppingProgress = 0
		agent.state = 'exploring'
		agent.target = pickExplorationTarget(agent.position, config, agent.avoidedAreas)
		agent.animation = 'walk'
	}
}

// ===== 逃跑：看到怪物追击/攻击时停止砍树，跑出怪物活动半径 =====
function updateFleeing(agent: PlayerAgent, delta: number, config: PlayerAgentConfig) {
	const threat = findActiveThreat(agent.position, config)

	if (threat && distanceTo(agent.target, threat.homePosition) <= threat.activityRadius) {
		agent.target = pickFleeTarget(agent.position, threat, config)
	}

	moveToward(agent, delta, config)
	agent.bearing = faceTarget(agent, agent.target)
	agent.animation = 'walk'

	if (!threat && distanceTo(agent.position, agent.target) < 3) {
		agent.state = 'exploring'
		agent.activeTree = null
		agent.choppingProgress = 0
		agent.target = pickExplorationTarget(agent.position, config, agent.avoidedAreas)
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
		agent.target = pickExplorationTarget(agent.position, config, agent.avoidedAreas)
		return
	}

	agent.position = newPosition
}

function faceTarget(agent: PlayerAgent, target: PlanePoint): number {
	return Math.atan2(target[0] - agent.position[0], target[1] - agent.position[1])
}

// ===== 目标选择 =====
function pickExplorationTarget(
	position: PlanePoint,
	config: PlayerAgentConfig,
	avoidedAreas: AvoidedArea[] = [],
): PlanePoint {
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

		if (!config.collisionCheck(next) && !isInsideAvoidedArea(next, avoidedAreas)) return next
	}

	return [position[0], position[1]]
}

function startFleeing(
	agent: PlayerAgent,
	threat: PlayerThreatSource,
	config: PlayerAgentConfig,
	now: number,
) {
	agent.state = 'fleeing'
	agent.activeTree = null
	agent.choppingProgress = 0
	agent.animation = 'walk'
	pruneAvoidedAreas(agent, now)
	agent.target = pickFleeTarget(agent.position, threat, config)
	agent.bearing = faceTarget(agent, agent.target)
}

function registerFailedAreaAttempt(agent: PlayerAgent, threat: PlayerThreatSource, now: number) {
	const radius = threat.activityRadius + AREA_AVOID_PADDING
	const previous = agent.failedAreaAttempt
	const isSameArea = previous
		&& distanceTo(previous.center, threat.homePosition) <= Math.max(previous.radius, radius)
		&& now - previous.lastAttemptAt <= AREA_FAILURE_MEMORY_MS

	const count = isSameArea ? previous.count + 1 : 1
	agent.failedAreaAttempt = {
		center: [...threat.homePosition],
		radius,
		count,
		lastAttemptAt: now,
	}

	if (count < AREA_FAILURE_LIMIT) return

	agent.avoidedAreas.push({
		center: [...threat.homePosition],
		radius,
		expiresAt: now + AREA_AVOID_DURATION_MS,
	})
	agent.failedAreaAttempt = null
}

function pruneAvoidedAreas(agent: PlayerAgent, now: number) {
	if (!agent.avoidedAreas.length) return
	agent.avoidedAreas = agent.avoidedAreas.filter(area => area.expiresAt > now)
}

function availableTrees(agent: PlayerAgent, config: PlayerAgentConfig): TreeResource[] {
	if (!agent.avoidedAreas.length) return config.treeResources()
	return config.treeResources().filter(tree => !isInsideAvoidedArea(tree.position, agent.avoidedAreas))
}

function isInsideAvoidedArea(position: PlanePoint, avoidedAreas: AvoidedArea[]): boolean {
	return avoidedAreas.some(area => distanceTo(position, area.center) <= area.radius)
}

function shouldFleeThreat(
	agent: PlayerAgent,
	now: number,
	threat: PlayerThreatSource,
	config: PlayerAgentConfig,
): boolean {
	if (agent.state === 'fleeing') return false
	if (agent.state !== 'chopping') return true

	const remainingChopMs = Math.max(0, config.chopDurationMs - (now - lastTreeScan))
	const distanceBeforeHit = Math.max(0, distanceTo(agent.position, threat.position) - threat.attackRadius)
	const timeUntilHitMs = (distanceBeforeHit / Math.max(threat.speed, 1)) * 1000
	const fleeTarget = pickFleeTarget(agent.position, threat, config)
	const timeToEscapeMs = (distanceTo(agent.position, fleeTarget) / Math.max(config.speed, 1)) * 1000

	return remainingChopMs + timeToEscapeMs > timeUntilHitMs
}

function findActiveThreat(position: PlanePoint, config: PlayerAgentConfig): PlayerThreatSource | null {
	let nearestThreat: PlayerThreatSource | null = null
	let nearestDistance = Number.POSITIVE_INFINITY

	for (const threat of config.threatSources()) {
		const distanceFromHome = distanceTo(position, threat.homePosition)
		if (distanceFromHome > threat.activityRadius) continue

		const distanceFromThreat = distanceTo(position, threat.position)
		if (distanceFromThreat < nearestDistance) {
			nearestThreat = threat
			nearestDistance = distanceFromThreat
		}
	}

	return nearestThreat
}

function pickFleeTarget(
	position: PlanePoint,
	threat: PlayerThreatSource,
	config: PlayerAgentConfig,
): PlanePoint {
	const buffer = Math.max(config.collectRadius * 2, 36)
	const dx = position[0] - threat.homePosition[0]
	const dz = position[1] - threat.homePosition[1]
	const distanceFromHome = Math.max(Math.hypot(dx, dz), 1)
	const baseAngle = Math.atan2(dx, dz)
	const targetDistance = threat.activityRadius + buffer

	for (let attempt = 0; attempt < 16; attempt++) {
		const direction = attempt % 2 === 0 ? 1 : -1
		const spread = Math.ceil(attempt / 2) * (Math.PI / 8)
		const angle = baseAngle + direction * spread
		const target = clampToWorld([
			threat.homePosition[0] + Math.sin(angle) * targetDistance,
			threat.homePosition[1] + Math.cos(angle) * targetDistance,
		], config)

		if (
			distanceTo(target, threat.homePosition) > threat.activityRadius + config.collectRadius
			&& !config.collisionCheck(target)
		) {
			return target
		}
	}

	const fallback = clampToWorld([
		position[0] + (dx / distanceFromHome) * buffer,
		position[1] + (dz / distanceFromHome) * buffer,
	], config)
	if (distanceTo(fallback, threat.homePosition) > threat.activityRadius) return fallback

	return pickExplorationTarget(position, config, [])
}

function clampToWorld(point: PlanePoint, config: PlayerAgentConfig): PlanePoint {
	const distanceFromCenter = Math.hypot(point[0], point[1])
	const maxDistance = config.worldRadius * 0.82
	if (distanceFromCenter <= maxDistance) return point

	return [
		point[0] * (maxDistance / distanceFromCenter),
		point[1] * (maxDistance / distanceFromCenter),
	]
}

function distanceTo(from: PlanePoint, to: PlanePoint): number {
	return Math.hypot(to[0] - from[0], to[1] - from[1])
}
