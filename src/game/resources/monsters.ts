import { MONSTER_GUARDIAN_CONFIG } from '../../config'
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
	activityRadius: number
	hitStunMs: number
}

export type MonsterAgentState = 'idle' | 'patrol' | 'tendPlants' | 'chase' | 'attack' | 'hit' | 'death'

export type MonsterUpdateContext = {
	playerPosition: PlanePoint
	playerAlive: boolean
	playerIsChopping: boolean
	playerIsFleeing: boolean
	/** 밤 여부. 밤에는 경계(탐지) 범위가 nightDetectionMultiplier배로 확대된다. */
	isNight?: boolean
	/**
	 * 플레이어의 스윙이 이 프레임에 겨냥한 몬스터. 유일한 플레이어 공격 경로다.
	 * 스윙 쿨다운(플레이어 에이전트)이 공격 빈도를 제한하므로 몬스터 쿨다운과 경쟁하지 않는다.
	 */
	incomingPlayerHit?: { id: string; damage: number }
	onAttackPlayer: () => void
}

export type MonsterAgent = {
	resource: MonsterResource
	state: MonsterAgentState
	position: PlanePoint
	bearing: number
	target: PlanePoint
	animation: string
	lastAttackTime: number
	stateTimer: number
	hitTimer: number
	tendTarget: PlanePoint | null
	tendTimer: number
	plantCallback: ((position: PlanePoint) => void) | null

	update(delta: number, now: number, context: MonsterUpdateContext): void
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
	activityRadius: number
	modelScale: number
	hitStunMs: number
	strengthMultipliers?: Record<string, number>
	/** 리스폰 몬스터 스케일링: 경과 일차당 체력/공격력 증가율 */
	dayScalePerDay?: number
}

function seededRandom(seed: number) {
	let s = seed
	return () => {
		s = (s * 16807 + 0) % 2147483647
		return (s - 1) / 2147483646
	}
}

const modelNames = ['Demon', 'Giant', 'Goblin', 'Skeleton', 'Yeti', 'Zombie']

export function createMonsterResources(config: MonsterConfig): MonsterResource[] {
	const monsters: MonsterResource[] = []
	const maxRadius = config.radiusMeters * 0.8
	const rand = seededRandom(config.seed)

	for (let i = 0; i < config.count; i++) {
		const angle = rand() * Math.PI * 2
		const dist = Math.sqrt(rand()) * maxRadius
		const position: PlanePoint = [Math.cos(angle) * dist, Math.sin(angle) * dist]
		const modelIndex = Math.floor(rand() * config.modelUrls.length)
		const [minScale, maxScale] = config.scaleRange
		const scale = config.modelScale * (minScale + rand() * (maxScale - minScale))
		const modelName = modelNames[modelIndex] || modelNames[0]
		const strengthMultiplier = config.strengthMultipliers?.[modelName] ?? 1

		monsters.push({
			id: `monster-${i}`,
			modelName,
			modelIndex,
			position,
			rotation: rand() * Math.PI * 2,
			scale,
			homePosition: [...position],
			patrolRadius: config.patrolRadius * (0.7 + rand() * 0.6),
			speed: config.speed * (0.8 + rand() * 0.4),
			detectionRadius: config.detectionRadius,
			health: Math.round(config.health * strengthMultiplier),
			maxHealth: Math.round(config.health * strengthMultiplier),
			attackDamage: Math.round(config.attackDamage * strengthMultiplier),
			attackCooldownMs: config.attackCooldownMs,
			activityRadius: config.activityRadius * (0.85 + rand() * 0.3),
			hitStunMs: config.hitStunMs,
		})
	}

	return monsters
}

/**
 * 죽은 몬스터 자리에 리스폰되는 새 몬스터 리소스.
 * - 위치/회전/크기는 Math.random 기반 (createRandomTree와 같은 의도적 비결정론 예외 — 테스트에서 mock)
 * - 체력/공격력은 모델 강도 배율 × 일차 스케일(1 + (day-1) × dayScalePerDay)이 적용된다.
 */
export function createRespawnMonster(
	config: MonsterConfig,
	id: string,
	modelIndex: number,
	dayNumber: number,
): MonsterResource {
	const modelName = modelNames[modelIndex] ?? modelNames[0]
	const strengthMultiplier = config.strengthMultipliers?.[modelName] ?? 1
	const dayScale = 1 + (dayNumber - 1) * (config.dayScalePerDay ?? 0)
	const maxRadius = config.radiusMeters * 0.8
	const angle = Math.random() * Math.PI * 2
	const dist = Math.sqrt(Math.random()) * maxRadius
	const [minScale, maxScale] = config.scaleRange

	return {
		id,
		modelName,
		modelIndex,
		position: [Math.cos(angle) * dist, Math.sin(angle) * dist],
		rotation: Math.random() * Math.PI * 2,
		scale: config.modelScale * (minScale + Math.random() * (maxScale - minScale)),
		homePosition: [Math.cos(angle) * dist, Math.sin(angle) * dist],
		patrolRadius: config.patrolRadius * (0.7 + Math.random() * 0.6),
		speed: config.speed * (0.8 + Math.random() * 0.4),
		detectionRadius: config.detectionRadius,
		health: Math.round(config.health * strengthMultiplier * dayScale),
		maxHealth: Math.round(config.health * strengthMultiplier * dayScale),
		attackDamage: Math.round(config.attackDamage * strengthMultiplier * dayScale),
		attackCooldownMs: config.attackCooldownMs,
		activityRadius: config.activityRadius * (0.85 + Math.random() * 0.3),
		hitStunMs: config.hitStunMs,
	}
}

export function createMonsterAgent(
	resource: MonsterResource,
	plantCallback?: (position: PlanePoint) => void,
): MonsterAgent {
	return {
		resource,
		state: 'idle',
		position: [...resource.position],
		bearing: resource.rotation,
		target: [...resource.position],
		animation: 'idle',
		lastAttackTime: 0,
		stateTimer: 0,
		hitTimer: 0,
		tendTarget: null,
		tendTimer: 0,
		plantCallback: plantCallback ?? null,

		update(delta, now, context) {
			if (this.resource.health <= 0) {
				if (this.state !== 'death') {
					this.state = 'death'
					this.animation = 'death'
				}
				return
			}

			// 플레이어의 스윙 처리: 피해 적용 → 사망 또는 경직(hit)
			const incoming = context.incomingPlayerHit
			if (incoming && incoming.id === this.resource.id && incoming.damage > 0) {
				this.resource.health -= incoming.damage
				if (this.resource.health <= 0) {
					this.state = 'death'
					this.animation = 'death'
				} else {
					this.state = 'hit'
					this.animation = 'hit'
					this.hitTimer = 0
					this.target = [...context.playerPosition]
				}
				return
			}

			const distToPlayer = Math.hypot(
				context.playerPosition[0] - this.position[0],
				context.playerPosition[1] - this.position[1],
			)
			const playerDistanceFromHome = Math.hypot(
				context.playerPosition[0] - this.resource.homePosition[0],
				context.playerPosition[1] - this.resource.homePosition[1],
			)

			switch (this.state) {
				case 'idle':
					updateIdle(this, delta, distToPlayer, playerDistanceFromHome, context)
					break
				case 'patrol':
					updatePatrol(this, delta, distToPlayer, playerDistanceFromHome, context)
					break
				case 'tendPlants':
					updateTendPlants(this, delta, now)
					break
				case 'chase':
					updateChase(this, delta, now, distToPlayer, context)
					break
				case 'attack':
					updateAttack(this, delta, now, distToPlayer, context)
					break
				case 'hit':
					updateHit(this, delta, now, distToPlayer, playerDistanceFromHome, context)
					break
			}
		},
	}
}

// ===== idle：等待 3 秒后巡逻或种植 =====
function updateIdle(
	agent: MonsterAgent,
	delta: number,
	distToPlayer: number,
	playerDistanceFromHome: number,
	context: MonsterUpdateContext,
) {
	// 只有玩家在砍树且在警觉范围内才追击
	if (canChasePlayer(agent, distToPlayer, playerDistanceFromHome, context)) {
		agent.state = 'chase'
		agent.animation = 'run'
		return
	}

	agent.stateTimer += delta
	if (agent.stateTimer > 3) {
		agent.stateTimer = 0
		// 40% 概率去种植
		if (Math.random() < 0.4 && agent.plantCallback) {
			agent.state = 'tendPlants'
			agent.tendTarget = pickTendTarget(agent)
			agent.tendTimer = 0
			agent.animation = 'walk'
		} else {
			agent.state = 'patrol'
			agent.animation = 'walk'
			agent.target = pickPatrolTarget(agent)
		}
	}
}

// ===== patrol：巡逻，砍树时警觉 =====
function updatePatrol(
	agent: MonsterAgent,
	delta: number,
	distToPlayer: number,
	playerDistanceFromHome: number,
	context: MonsterUpdateContext,
) {
	// 只有玩家在砍树且在警觉范围内才追击
	if (canChasePlayer(agent, distToPlayer, playerDistanceFromHome, context)) {
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

// ===== tendPlants：种植植物 =====
function updateTendPlants(agent: MonsterAgent, delta: number, _now: number) {
	if (!agent.tendTarget) {
		agent.state = 'idle'
		agent.animation = 'idle'
		agent.stateTimer = 0
		return
	}

	// 还没到种植点，继续走
	const distToTarget = distanceTo(agent.position, agent.tendTarget)
	if (distToTarget > 3) {
		agent.target = [...agent.tendTarget]
		moveToward(agent, delta)
		agent.bearing = Math.atan2(
			agent.tendTarget[0] - agent.position[0],
			agent.tendTarget[1] - agent.position[1],
		)
		return
	}

	// 到达种植点，开始种植
	agent.animation = 'tend'
	agent.tendTimer += delta * 1000 // 转换为毫秒

	if (agent.tendTimer >= MONSTER_GUARDIAN_CONFIG.tendPlantDurationMs) {
		// 种植完成
		if (agent.plantCallback) {
			agent.plantCallback(agent.tendTarget)
		}
		agent.tendTarget = null
		agent.tendTimer = 0
		agent.state = 'idle'
		agent.animation = 'idle'
		agent.stateTimer = 0
	}
}

// ===== chase：追击砍树的玩家 =====
function updateChase(
	agent: MonsterAgent,
	delta: number,
	now: number,
	distToPlayer: number,
	context: MonsterUpdateContext,
) {
	// 玩家停止砍树且没有逃跑 → 失去兴趣
	if ((!context.playerIsChopping && !context.playerIsFleeing) || !context.playerAlive) {
		agent.state = 'idle'
		agent.animation = 'idle'
		agent.stateTimer = 0
		return
	}

	// 玩家超出警觉范围 → 放弃追击
	if (
		distToPlayer > effectiveDetectionRadius(context) * 1.5
		|| distanceTo(agent.position, agent.resource.homePosition) > agent.resource.activityRadius
		|| distanceTo(context.playerPosition, agent.resource.homePosition) > agent.resource.activityRadius
	) {
		agent.state = 'idle'
		agent.animation = 'idle'
		agent.stateTimer = 0
		agent.target = pickPatrolTarget(agent)
		return
	}

	agent.target = [...context.playerPosition]
	moveToward(agent, delta)
	agent.bearing = faceTarget(agent, context.playerPosition)

	if (distToPlayer < 20) {
		agent.state = 'attack'
		agent.animation = 'attack'
		agent.lastAttackTime = now
	}
}

// ===== attack：攻击玩家（偷走木头） =====
function updateAttack(
	agent: MonsterAgent,
	delta: number,
	now: number,
	distToPlayer: number,
	context: MonsterUpdateContext,
) {
	agent.bearing = faceTarget(agent, context.playerPosition)

	// 玩家停止砍树且没有逃跑 → 放弃攻击
	if ((!context.playerIsChopping && !context.playerIsFleeing) || !context.playerAlive) {
		agent.state = 'idle'
		agent.animation = 'idle'
		agent.stateTimer = 0
		return
	}

	// 玩家超出攻击范围 → 继续追击
	if (distToPlayer > 30) {
		if (
			distanceTo(agent.position, agent.resource.homePosition) > agent.resource.activityRadius
			|| distanceTo(context.playerPosition, agent.resource.homePosition) > agent.resource.activityRadius
		) {
			agent.state = 'idle'
			agent.animation = 'idle'
			agent.stateTimer = 0
			agent.target = pickPatrolTarget(agent)
			return
		}
		agent.state = 'chase'
		agent.animation = 'run'
		return
	}

	// 攻击冷却到期 → 命中
	if (now - agent.lastAttackTime >= agent.resource.attackCooldownMs) {
		context.onAttackPlayer()
		agent.lastAttackTime = now
	}
}

// ===== hit：被玩家击中后硬直，计时结束后重新进入战斗或休闲 =====
function updateHit(
	agent: MonsterAgent,
	delta: number,
	now: number,
	distToPlayer: number,
	playerDistanceFromHome: number,
	context: MonsterUpdateContext,
) {
	agent.hitTimer += delta * 1000
	agent.bearing = faceTarget(agent, context.playerPosition)
	agent.animation = 'hit'

	if (agent.hitTimer < agent.resource.hitStunMs) return

	agent.hitTimer = 0
	if (
		context.playerAlive
		&& (context.playerIsChopping || context.playerIsFleeing)
		&& distToPlayer < effectiveDetectionRadius(context)
		&& playerDistanceFromHome <= agent.resource.activityRadius
	) {
		agent.state = 'chase'
		agent.animation = 'run'
		agent.target = [...context.playerPosition]
	} else {
		agent.state = 'idle'
		agent.animation = 'idle'
		agent.stateTimer = 0
		agent.target = pickPatrolTarget(agent)
	}
}

// ===== 辅助函数 =====

/** 밤에는 경계 범위가 확대된 실효 탐지 반경 */
export function effectiveDetectionRadius(context: Pick<MonsterUpdateContext, 'isNight'>): number {
	const multiplier = context.isNight === true ? MONSTER_GUARDIAN_CONFIG.nightDetectionMultiplier : 1
	return MONSTER_GUARDIAN_CONFIG.guardianDetectionRadius * multiplier
}

function canChasePlayer(
	agent: MonsterAgent,
	distToPlayer: number,
	playerDistanceFromHome: number,
	context: MonsterUpdateContext,
): boolean {
	return context.playerAlive
		&& context.playerIsChopping
		&& distToPlayer < effectiveDetectionRadius(context)
		&& playerDistanceFromHome <= agent.resource.activityRadius
}

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

function pickTendTarget(agent: MonsterAgent): PlanePoint {
	const angle = Math.random() * Math.PI * 2
	const dist = Math.random() * MONSTER_GUARDIAN_CONFIG.tendPlantRadius
	return [
		agent.resource.homePosition[0] + Math.cos(angle) * dist,
		agent.resource.homePosition[1] + Math.sin(angle) * dist,
	]
}

function distanceTo(from: PlanePoint, to: PlanePoint): number {
	return Math.hypot(to[0] - from[0], to[1] - from[1])
}
