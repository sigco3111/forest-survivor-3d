import { MONSTER_CONFIG, MONSTER_GUARDIAN_CONFIG } from '../../config'
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
	/** 보스: 벌목과 무관하게 상시 추격하고 전용 보상을 준다 */
	isBoss: boolean
	/** 원거리 종족: 이 사거리에서 멈춰 투사체를 날린다 (미지정 = 근접 전용) */
	rangedRange?: number
	/** 도주 종족: 체력 비율이 이 값 이하로 내려가면 도주한다 (겁 많은 종족) */
	fleeHealthRatio?: number
}

/** 종족별 행동 특화 배율 + 특수 능력 (기본 배율 1, 특수 능력 없음) */
export type SpeciesBehavior = {
	speedMultiplier?: number
	attackDamageMultiplier?: number
	attackCooldownMultiplier?: number
	detectionMultiplier?: number
	/** 체력이 이 비율 이하로 깎이면 도주한다 (겁 많은 종족) */
	fleeHealthRatio?: number
	/** 원거리 공격: 이 사거리에서 멈춰 투사체를 날린다 */
	ranged?: { range: number; projectileSpeed: number }
}

export type MonsterAgentState = 'idle' | 'patrol' | 'tendPlants' | 'chase' | 'attack' | 'hit' | 'flee' | 'death'

export type MonsterUpdateContext = {
	playerPosition: PlanePoint
	playerAlive: boolean
	playerIsChopping: boolean
	playerIsFleeing: boolean
	/** 밤 여부. 밤에는 경계(탐지) 범위가 nightDetectionMultiplier배로 확대된다. */
	isNight?: boolean
	/** 모닥불 등으로 감쇠된 실효 탐지 배율 (미지정 = 1). 실탐지 반경에 곱해진다. */
	detectionMultiplier?: number
	/**
	 * 플레이어의 스윙(및 광역 스킬)이 이 프레임에 겨냥한 몬스터 목록. 유일한 플레이어 공격 경로다.
	 * 스윙 쿨다운(플레이어 에이전트)이 공격 빈도를 제한하므로 몬스터 쿨다운과 경쟁하지 않는다.
	 */
	incomingPlayerHits?: { id: string; damage: number }[]
	onAttackPlayer: () => void
	/** 울타리 같은 장애물 판정. 제공되면 이동 시 우회를 시도하고 완전히 막히면 제자리에 머문다. */
	obstacleCheck?: (position: PlanePoint) => boolean
	/** 원거리 종족의 투사체 발사 (근접 사거리 밖에서 쿨다운마다 호출) */
	onRangedAttack?: (from: PlanePoint, targetPosition: PlanePoint, damage: number) => void
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
	/** 팩 응집: 이 시각까지 플레이어를 추격한다 (동족 피격 등으로 자극받음) */
	provokedUntil: number
	/** 겁먹은 상태: 도주 종료 후 이 시각까지 재추격하지 않는다 */
	coweredUntil: number
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
	/** 티어 스케일링: 티어당 체력/공격력 배율 (기하급수 — 미설정 또는 1 이하면 성장 없음) */
	tierScalePerTier?: number
	/** 보스 스탯 배율 (체력/공격력) */
	bossHealthMultiplier?: number
	bossDamageMultiplier?: number
	/** 종족별 행동 특화 배율 */
	speciesBehavior?: Record<string, SpeciesBehavior>
	/** 팩 응집: 피격당한 몬스터 주변 같은 종족을 자극하는 반경/지속시간 */
	packAggroRadius?: number
	packAggroDurationMs?: number
}

function seededRandom(seed: number) {
	let s = seed
	return () => {
		s = (s * 16807 + 0) % 2147483647
		return (s - 1) / 2147483646
	}
}

const modelNames = ['Demon', 'Giant', 'Goblin', 'Skeleton', 'Yeti', 'Zombie']

/** 종족별 행동 배율 조회 (미등록 종족은 모두 1) */
function speciesOf(config: MonsterConfig, modelName: string): SpeciesBehavior {
	return config.speciesBehavior?.[modelName] ?? {}
}

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
		const behavior = speciesOf(config, modelName)

		monsters.push({
			id: `monster-${i}`,
			modelName,
			modelIndex,
			position,
			rotation: rand() * Math.PI * 2,
			scale,
			homePosition: [...position],
			patrolRadius: config.patrolRadius * (0.7 + rand() * 0.6),
			speed: config.speed * (0.8 + rand() * 0.4) * (behavior.speedMultiplier ?? 1),
			detectionRadius: Math.round(config.detectionRadius * (behavior.detectionMultiplier ?? 1)),
			health: Math.round(config.health * strengthMultiplier),
			maxHealth: Math.round(config.health * strengthMultiplier),
		attackDamage: Math.round(config.attackDamage * strengthMultiplier * (behavior.attackDamageMultiplier ?? 1)),
		attackCooldownMs: Math.round(config.attackCooldownMs * (behavior.attackCooldownMultiplier ?? 1)),
		activityRadius: config.activityRadius * (0.85 + rand() * 0.3),
		hitStunMs: config.hitStunMs,
		isBoss: false,
		rangedRange: behavior.ranged?.range,
		fleeHealthRatio: behavior.fleeHealthRatio,
	})
}

	return monsters
}

/**
 * 티어 스케일 배율: 티어 1 = 1, 티어 N = scalePerTier^(N-1) 기하급수.
 * 방치형 설계의 핵심 — 몬스터는 지수, 플레이어는 선형 성장이라 후반에 벽이 생긴다.
 * scalePerTier가 미설정이거나 1 이하면 성장하지 않는다(배율 1 고정).
 */
export function tierStatScale(tierNumber: number, scalePerTier?: number): number {
	if (!scalePerTier || scalePerTier <= 1) return 1
	return Math.pow(scalePerTier, Math.max(0, tierNumber - 1))
}

/**
 * 주기 보스(=티어 전환 게이트): Giant 모델 고정, 일반 몬스터 대비 대폭 강화된 스탯.
 * 위치는 Math.random 기반 (리스폰과 같은 의도적 비결정론 예외).
 * 현재 티어 스케일(tierStatScale)이 적용된다 — 토벌 후 다음 보스는 자동으로 더 강하다.
 */
export function createBossMonster(config: MonsterConfig, id: string, tierNumber: number): MonsterResource {
	const modelName = 'Giant'
	const modelIndex = config.modelUrls.length > 1 ? 1 : 0
	const base = config.strengthMultipliers?.[modelName] ?? 1
	const tierScale = tierStatScale(tierNumber, config.tierScalePerTier)
	const healthMultiplier = base * (config.bossHealthMultiplier ?? 2)
	const damageMultiplier = base * (config.bossDamageMultiplier ?? 0.8)
	const maxRadius = config.radiusMeters * 0.8
	const angle = Math.random() * Math.PI * 2
	const dist = Math.sqrt(Math.random()) * maxRadius

	return {
		id,
		modelName,
		modelIndex,
		position: [Math.cos(angle) * dist, Math.sin(angle) * dist],
		rotation: Math.random() * Math.PI * 2,
		scale: config.modelScale * 1.6,
		homePosition: [Math.cos(angle) * dist, Math.sin(angle) * dist],
		patrolRadius: config.patrolRadius,
		speed: config.speed,
		detectionRadius: config.detectionRadius,
		health: Math.round(config.health * healthMultiplier * tierScale),
		maxHealth: Math.round(config.health * healthMultiplier * tierScale),
		attackDamage: Math.round(config.attackDamage * damageMultiplier * tierScale),
		attackCooldownMs: config.attackCooldownMs,
		activityRadius: config.activityRadius,
		hitStunMs: config.hitStunMs,
		isBoss: true,
	}
}

/**
 * 죽은 몬스터 자리에 리스폰되는 새 몬스터 리소스.
 * - 위치/회전/크기는 Math.random 기반 (createRandomTree와 같은 의도적 비결정론 예외 — 테스트에서 mock)
 * - 체력/공격력은 모델 강도 배율 × 티어 스케일(scalePerTier^(tier-1))이 적용된다.
 */
export function createRespawnMonster(
	config: MonsterConfig,
	id: string,
	modelIndex: number,
	tierNumber: number,
): MonsterResource {
	const modelName = modelNames[modelIndex] ?? modelNames[0]
	const strengthMultiplier = config.strengthMultipliers?.[modelName] ?? 1
	const behavior = speciesOf(config, modelName)
	const tierScale = tierStatScale(tierNumber, config.tierScalePerTier)
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
		speed: config.speed * (0.8 + Math.random() * 0.4) * (behavior.speedMultiplier ?? 1),
		detectionRadius: Math.round(config.detectionRadius * (behavior.detectionMultiplier ?? 1)),
		health: Math.round(config.health * strengthMultiplier * tierScale),
		maxHealth: Math.round(config.health * strengthMultiplier * tierScale),
		attackDamage: Math.round(config.attackDamage * strengthMultiplier * tierScale * (behavior.attackDamageMultiplier ?? 1)),
		attackCooldownMs: Math.round(config.attackCooldownMs * (behavior.attackCooldownMultiplier ?? 1)),
		activityRadius: config.activityRadius * (0.85 + Math.random() * 0.3),
		hitStunMs: config.hitStunMs,
		isBoss: false,
		rangedRange: behavior.ranged?.range,
		fleeHealthRatio: behavior.fleeHealthRatio,
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
		provokedUntil: 0,
		coweredUntil: 0,
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

			// 플레이어의 스윙 처리: 피해 적용 → 사망 / 겁에 질린 도주 / 경직(hit)
			const incoming = context.incomingPlayerHits?.find(hit => hit.id === this.resource.id)
			if (incoming && incoming.damage > 0) {
				this.resource.health -= incoming.damage
				if (this.resource.health <= 0) {
					this.state = 'death'
					this.animation = 'death'
				} else if (
					this.resource.fleeHealthRatio !== undefined
					&& this.resource.health <= this.resource.maxHealth * this.resource.fleeHealthRatio
				) {
					// 도주 종족: 체력이 임계 비율 아래로 떨어지면 경직 대신 도주한다
					startFleeingFromPlayer(this, context)
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
					updateIdle(this, delta, distToPlayer, playerDistanceFromHome, context, now)
					break
				case 'patrol':
					updatePatrol(this, delta, distToPlayer, playerDistanceFromHome, context, now)
					break
				case 'tendPlants':
					updateTendPlants(this, delta, now, context)
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
				case 'flee':
					updateFlee(this, delta, now, distToPlayer, context)
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
	now: number,
) {
	// 벌목 중이거나 팩 응집으로 자극받았거나 보스면 추격
	if (canChasePlayer(agent, distToPlayer, playerDistanceFromHome, context, now)) {
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
	now: number,
) {
	if (canChasePlayer(agent, distToPlayer, playerDistanceFromHome, context, now)) {
		agent.state = 'chase'
		agent.animation = 'run'
		return
	}

	moveToward(agent, delta, context.obstacleCheck)

	if (distanceTo(agent.position, agent.target) < 3) {
		agent.state = 'idle'
		agent.animation = 'idle'
		agent.stateTimer = 0
	}
}

// ===== tendPlants：种植植物 =====
function updateTendPlants(agent: MonsterAgent, delta: number, _now: number, context: MonsterUpdateContext) {
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
		moveToward(agent, delta, context.obstacleCheck)
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
	// 추격 유지 조건: 벌목 중/도망 중/팩 자극 만료 전/보스 — 어느 것도 아니면 흥미 상실
	const engaged = context.playerIsChopping
		|| context.playerIsFleeing
		|| now < agent.provokedUntil
		|| agent.resource.isBoss
	if (!engaged || !context.playerAlive) {
		agent.state = 'idle'
		agent.animation = 'idle'
		agent.stateTimer = 0
		return
	}

	// 玩家超出警觉范围 → 放弃追击 (보스는 예외 — 세계 끝까지 추격)
	if (
		!agent.resource.isBoss
		&& (
			distToPlayer > effectiveDetectionRadius(context) * 1.5
			|| distanceTo(agent.position, agent.resource.homePosition) > agent.resource.activityRadius
			|| distanceTo(context.playerPosition, agent.resource.homePosition) > agent.resource.activityRadius
		)
	) {
		agent.state = 'idle'
		agent.animation = 'idle'
		agent.stateTimer = 0
		agent.target = pickPatrolTarget(agent)
		return
	}

	agent.target = [...context.playerPosition]
	moveToward(agent, delta, context.obstacleCheck)
	agent.bearing = faceTarget(agent, context.playerPosition)

	// 원거리 종족은 사거리에 들어오면 멈춰서 공격한다 (근접 종족는 기존대로 근접 거리)
	const engageRange = agent.resource.rangedRange ?? MELEE_ENGAGE_RANGE
	if (distToPlayer < engageRange) {
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

	// 攻击持续 조건 (보스는 예외 — 상시 추격)
	const engaged = context.playerIsChopping
		|| context.playerIsFleeing
		|| now < agent.provokedUntil
		|| agent.resource.isBoss
	if (!engaged || !context.playerAlive) {
		agent.state = 'idle'
		agent.animation = 'idle'
		agent.stateTimer = 0
		return
	}

	// 원거리 종족은 자기 사거리를 유지하고, 근접 종족는 기존대로 30까지 버틴다
	const maxEngageDistance = agent.resource.rangedRange ?? MELEE_GIVE_UP_RANGE

	// 玩家超出攻击范围 → 继续追击 (보스는 예외 — 활동 반경 밖에서도 계속 쫓는다)
	if (distToPlayer > maxEngageDistance) {
		if (
			!agent.resource.isBoss
			&& (
				distanceTo(agent.position, agent.resource.homePosition) > agent.resource.activityRadius
				|| distanceTo(context.playerPosition, agent.resource.homePosition) > agent.resource.activityRadius
			)
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

	// 攻击冷却到期 → 命中. 근접 사거리면 밀격, 그 밖이고 원거리 종족면 투사체를 날린다.
	if (now - agent.lastAttackTime >= agent.resource.attackCooldownMs) {
		if (agent.resource.rangedRange !== undefined && distToPlayer > MELEE_ENGAGE_RANGE) {
			context.onRangedAttack?.([...agent.position], [...context.playerPosition], agent.resource.attackDamage)
		} else {
			context.onAttackPlayer()
		}
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
		&& (
			context.playerIsChopping
			|| context.playerIsFleeing
			|| now < agent.provokedUntil
			|| agent.resource.isBoss
		)
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

// ===== flee：겁에 질려 플레이어에게서 도망친다 (도주 종족 전용 상태) =====
function startFleeingFromPlayer(agent: MonsterAgent, context: MonsterUpdateContext) {
	agent.state = 'flee'
	agent.animation = 'run'
	agent.target = awayTargetFromPlayer(agent, context.playerPosition)
}

/** 플레이어 반대편으로 patrolRadius만큼 떨어진 도주 지점 */
function awayTargetFromPlayer(agent: MonsterAgent, from: PlanePoint): PlanePoint {
	const dx = agent.position[0] - from[0]
	const dz = agent.position[1] - from[1]
	const distance = Math.max(Math.hypot(dx, dz), 1)
	const step = agent.resource.patrolRadius
	return [
		agent.position[0] + (dx / distance) * step,
		agent.position[1] + (dz / distance) * step,
	]
}

function updateFlee(
	agent: MonsterAgent,
	delta: number,
	now: number,
	distToPlayer: number,
	context: MonsterUpdateContext,
) {
	// 매 프레임 도주 방향을 갱신한다 (플레이어가 쫓아와도 계속 멀어진다)
	agent.target = awayTargetFromPlayer(agent, context.playerPosition)
	moveToward(agent, delta, context.obstacleCheck)

	// 안전 거리를 확보하면 도주를 끝내고 잠시 숨을 고른다 (coweredUntil 동안 자극받아도 재추격 불가)
	if (distToPlayer >= agent.resource.detectionRadius * MONSTER_CONFIG.fleeSafeDistanceMultiplier) {
		agent.state = 'idle'
		agent.animation = 'idle'
		agent.stateTimer = 0
		agent.coweredUntil = now + MONSTER_CONFIG.cowerDurationMs
	}
}

// ===== 辅助函数 =====

/** 근접 종족의 교전 진입/이탈 거리 (기존 하드코딩 20/30을 상수로 추출) */
const MELEE_ENGAGE_RANGE = 20
const MELEE_GIVE_UP_RANGE = 30

/** 밤에는 경계 범위가 확대되고, 모닥불 등 탐지 감쇠 배율이 곱해진 실효 탐지 반경 */
export function effectiveDetectionRadius(context: Pick<MonsterUpdateContext, 'isNight' | 'detectionMultiplier'>): number {
	const nightMultiplier = context.isNight === true ? MONSTER_GUARDIAN_CONFIG.nightDetectionMultiplier : 1
	const dampening = context.detectionMultiplier ?? 1
	return MONSTER_GUARDIAN_CONFIG.guardianDetectionRadius * nightMultiplier * dampening
}

function canChasePlayer(
	agent: MonsterAgent,
	distToPlayer: number,
	playerDistanceFromHome: number,
	context: MonsterUpdateContext,
	now: number,
): boolean {
	if (!context.playerAlive) return false
	// 보스는 언제 어디서든 플레이어를 추격한다 (탐지 반경/활동 반경 무시)
	if (agent.resource.isBoss) return true
	// 겁먹은 상태에서는 자극받아도 재추격하지 않는다 (도주 종족 전용 게이트)
	if (now < agent.coweredUntil) return false
	const engaged = context.playerIsChopping || now < agent.provokedUntil
	return engaged
		&& distToPlayer < effectiveDetectionRadius(context)
		&& playerDistanceFromHome <= agent.resource.activityRadius
}

/** 이동 스텝 계산에 쓰는 우회 각도 팬. 울타리 같은 장애물에 막힌 좁은 길을 빠져나온다. */
const MONSTER_DETOUR_OFFSETS = [
	0,
	Math.PI / 6, -Math.PI / 6,
	Math.PI / 3, -Math.PI / 3,
	Math.PI / 2, -Math.PI / 2,
]

/**
 * 목표를 향해 이동한다. obstacleCheck가 주어지면 직진이 막힐 때 각도를 벌려 우회를 시도하고,
 * 그마저 전부 막히면 제자리에 머문다(장애물 = 몬스터를 되돌리지 않고 지연시킨다).
 */
function moveToward(agent: MonsterAgent, delta: number, obstacleCheck?: (position: PlanePoint) => boolean) {
	const dx = agent.target[0] - agent.position[0]
	const dz = agent.target[1] - agent.position[1]
	const distance = Math.hypot(dx, dz)
	if (distance < 1) return

	const speed = agent.resource.speed * delta
	const travelDistance = Math.min(distance, speed)
	const baseAngle = Math.atan2(dx, dz)

	for (const offset of MONSTER_DETOUR_OFFSETS) {
		const angle = baseAngle + offset
		// 직진(offset 0)은 기존과 동일한 정규화 벡터를 써서 부동소수점 오차를 피한다
		const dirX = offset === 0 ? dx / distance : Math.sin(angle)
		const dirZ = offset === 0 ? dz / distance : Math.cos(angle)
		const candidate: PlanePoint = [
			agent.position[0] + dirX * travelDistance,
			agent.position[1] + dirZ * travelDistance,
		]
		if (!obstacleCheck || !obstacleCheck(candidate)) {
			agent.position = candidate
			if (agent.state !== 'chase') {
				agent.bearing = Math.atan2(dx, dz)
			}
			return
		}
	}
	// 모든 방향이 막힘: 제자리에서 다음 프레임을 기다린다
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
