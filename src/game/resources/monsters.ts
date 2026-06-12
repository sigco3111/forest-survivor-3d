import type { PlanePoint } from '../resources/trees'

export type MonsterResource = {
	id: string
	modelName: string
	modelIndex: number
	position: PlanePoint
	rotation: number
	scale: number
	homePosition: PlanePoint
	patrolRadius: number
	speed: number
	detectionRadius: number
	health: number
	maxHealth: number
	attackDamage: number
	attackCooldownMs: number
}

export type MonsterAgentState = 'idle' | 'patrol' | 'chase' | 'attack' | 'death'

export type MonsterAgent = {
	resource: MonsterResource
	state: MonsterAgentState
	position: PlanePoint
	bearing: number
	target: PlanePoint
	animation: string
	lastAttackTime: number
	stateTimer: number

	update(delta: number, now: number, playerPosition: PlanePoint, playerAlive: boolean): void
}

type MonsterConfig = {
	modelUrls: string[]
	seed: number
	count: number
	radiusMeters: number
	scaleRange: [number, number]
	patrolRadius: number
	speed: number
	detectionRadius: number
	attackRadius: number
	health: number
	attackDamage: number
	attackCooldownMs: number
	modelScale: number
}

function seededRandom(seed: number) {
	let s = seed
	return () => {
		s = (s * 16807 + 0) % 2147483647
		return (s - 1) / 2147483646
	}
}

export function createMonsterResources(config: MonsterConfig): MonsterResource[] {
	const monsters: MonsterResource[] = []
	const maxRadius = config.radiusMeters * 0.8
	const rand = seededRandom(config.seed)
	const modelNames = ['Demon', 'Giant', 'Goblin', 'Skeleton', 'Yeti', 'Zombie']

	for (let i = 0; i < config.count; i++) {
		const angle = rand() * Math.PI * 2
		const dist = Math.sqrt(rand()) * maxRadius
		const position: PlanePoint = [Math.cos(angle) * dist, Math.sin(angle) * dist]
		const modelIndex = Math.floor(rand() * config.modelUrls.length)
		const [minScale, maxScale] = config.scaleRange
		const scale = config.modelScale * (minScale + rand() * (maxScale - minScale))

		monsters.push({
			id: `monster-${i}`,
			modelName: modelNames[modelIndex] || modelNames[0],
			modelIndex,
			position,
			rotation: rand() * Math.PI * 2,
			scale,
			homePosition: [...position],
			patrolRadius: config.patrolRadius * (0.7 + rand() * 0.6),
			speed: config.speed * (0.8 + rand() * 0.4),
			detectionRadius: config.detectionRadius,
			health: config.health,
			maxHealth: config.health,
			attackDamage: config.attackDamage,
			attackCooldownMs: config.attackCooldownMs,
		})
	}

	return monsters
}

export function createMonsterAgent(resource: MonsterResource): MonsterAgent {
	return {
		resource,
		state: 'idle',
		position: [...resource.position],
		bearing: resource.rotation,
		target: [...resource.position],
		animation: 'idle',
		lastAttackTime: 0,
		stateTimer: 0,

		update(delta, now, playerPosition, playerAlive) {
			if (this.resource.health <= 0) {
				if (this.state !== 'death') {
					this.state = 'death'
					this.animation = 'death'
				}
				return
			}

			const distToPlayer = Math.hypot(
				playerPosition[0] - this.position[0],
				playerPosition[1] - this.position[1],
			)

			switch (this.state) {
				case 'idle':
					updateIdle(this, delta, distToPlayer, playerAlive)
					break
				case 'patrol':
					updatePatrol(this, delta, distToPlayer, playerAlive)
					break
				case 'chase':
					updateChase(this, delta, now, distToPlayer, playerPosition, playerAlive)
					break
				case 'attack':
					updateAttack(this, delta, now, distToPlayer, playerPosition, playerAlive)
					break
			}
		},
	}
}

function updateIdle(agent: MonsterAgent, delta: number, distToPlayer: number, playerAlive: boolean) {
	if (playerAlive && distToPlayer < agent.resource.detectionRadius) {
		agent.state = 'chase'
		agent.animation = 'run'
		return
	}

	agent.stateTimer += delta
	if (agent.stateTimer > 2 + Math.random() * 3) {
		agent.stateTimer = 0
		agent.state = 'patrol'
		agent.animation = 'walk'
		agent.target = pickPatrolTarget(agent)
	}
}

function updatePatrol(agent: MonsterAgent, delta: number, distToPlayer: number, playerAlive: boolean) {
	if (playerAlive && distToPlayer < agent.resource.detectionRadius) {
		agent.state = 'chase'
		agent.animation = 'run'
		return
	}

	moveToward(agent, delta)

	if (distanceTo(agent.position, agent.target) < 3) {
		agent.state = 'idle'
		agent.animation = 'idle'
		agent.stateTimer = 0
	}
}

function updateChase(agent: MonsterAgent, delta: number, now: number, distToPlayer: number, playerPosition: PlanePoint, playerAlive: boolean) {
	if (!playerAlive || distToPlayer > agent.resource.detectionRadius * 1.5) {
		agent.state = 'idle'
		agent.animation = 'idle'
		agent.stateTimer = 0
		return
	}

	agent.target = [...playerPosition]
	moveToward(agent, delta)
	agent.bearing = faceTarget(agent, playerPosition)

	if (distToPlayer < 20) {
		agent.state = 'attack'
		agent.animation = 'attack'
		agent.lastAttackTime = now
	}
}

function updateAttack(agent: MonsterAgent, delta: number, now: number, distToPlayer: number, playerPosition: PlanePoint, playerAlive: boolean) {
	agent.bearing = faceTarget(agent, playerPosition)

	if (!playerAlive || distToPlayer > 30) {
		agent.state = playerAlive ? 'chase' : 'idle'
		agent.animation = playerAlive ? 'run' : 'idle'
		return
	}

	// 攻击由外部通过 lastAttackTime 和 attackCooldownMs 控制
}

// ===== 辅助函数 =====

function moveToward(agent: MonsterAgent, delta: number) {
	const dx = agent.target[0] - agent.position[0]
	const dz = agent.target[1] - agent.position[1]
	const distance = Math.hypot(dx, dz)
	if (distance < 1) return

	const speed = agent.resource.speed * delta
	const travelDistance = Math.min(distance, speed)
	agent.position = [
		agent.position[0] + (dx / distance) * travelDistance,
		agent.position[1] + (dz / distance) * travelDistance,
	]
	if (agent.state !== 'chase') {
		agent.bearing = Math.atan2(dx, dz)
	}
}

function faceTarget(agent: MonsterAgent, target: PlanePoint): number {
	return Math.atan2(target[0] - agent.position[0], target[1] - agent.position[1])
}

function pickPatrolTarget(agent: MonsterAgent): PlanePoint {
	const angle = Math.random() * Math.PI * 2
	const dist = Math.random() * agent.resource.patrolRadius
	return [
		agent.resource.homePosition[0] + Math.cos(angle) * dist,
		agent.resource.homePosition[1] + Math.sin(angle) * dist,
	]
}

function distanceTo(from: PlanePoint, to: PlanePoint): number {
	return Math.hypot(to[0] - from[0], to[1] - from[1])
}
