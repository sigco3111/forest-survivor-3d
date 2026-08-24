import {
	collectTree,
	findNearbyTree,
	type PlanePoint,
	type TreeResource,
} from '../resources/trees'

export type PlayerAgentState = 'exploring' | 'approaching' | 'chopping' | 'fleeing' | 'attacking' | 'hunting'

export type PlayerThreatSource = {
	id?: string
	position: PlanePoint
	homePosition: PlanePoint
	activityRadius: number
	speed: number
	attackRadius: number
	attackDamage?: number
	/** 현재 체력. 정보가 없으면 항상 강한 적(전투력 ∞)으로 취급한다. */
	health?: number
	/** 플레이어를 추격/공격 중인지. false면 도망 판정 대상에서 제외되지만 사냥감은 될 수 있다. */
	hostile?: boolean
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
	attackRangeMeters: number     // 攻击怪物的距离（单位）
	attackDamageMs: number        // 攻击挥砍动画耗时（毫秒）
	attackCooldownMs: number      // 攻击之间的冷却（毫秒）
	playerAttackDamage: number    // 单次攻击伤害
	onAttackMonster?: (monsterId: string, damage: number) => void
	playerMaxHealth: number           // 플레이어 최대 체력
	killHealHealth: number            // 몬스터 처치 시 체력 회복량
	regenHealthAmount: number         // 비전투 중 체력 회복량 (틱당)
	regenIntervalMs: number           // 비전투 체력 회복 틱 간격
	criticalHealthRatio: number       // 위기 체력 비율 (이하 → 도주 우선)
	expBase: number                   // 2레벨까지 필요 경험치
	expGrowth: number                 // 레벨별 필요 경험치 증가율
	levelAttackBonus: number          // 레벨당 공격력 증가
	levelHealthBonus: number          // 레벨당 최대 체력 증가
	levelSpeedBonus: number           // 레벨당 이동속도 증가
	huntScanRangePerLevel: number     // 레벨당 선제공격 스캔 범위 추가치
	upgradeCostBase: number           // 무기 첫 강화 비용 (나무)
	upgradeCostGrowth: number         // 무기 강화 비용 증가율
	weaponAttackPerTier: number       // 무기 티어당 공격력 증가
	weaponPowerPerTier: number        // 무기 티어당 전투력 증가
	reserveWood: number               // 강화 후에도 유지할 비상 나무
	playerBasePower: number           // 플레이어 기본 전투력
	powerPerWood: number              // 나무 1개당 전투력 증가량
	monsterHealthPowerWeight: number  // 몬스터 체력 → 위협 전투력 가중치
	monsterAttackPowerWeight: number  // 몬스터 공격력 → 위협 전투력 가중치
	huntAggroRangeMultiplier: number  // 선제공격 스캔 범위 배율 (attackRangeMeters × 배율)
	huntGiveUpRangeMultiplier: number // 추격 포기 범위 배율 (attackRangeMeters × 배율)
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
	attackingProgress: number
	activeTree: TreeResource | null
	woodCollected: number
	health: number
	maxHealth: number
	exp: number
	level: number
	/** 실효 공격력 (레벨/무기 강화로 증가). 초기값은 config.playerAttackDamage. */
	attackDamage: number
	/** 무기 강화 티어 (0 = 기본 무기) */
	weaponTier: number
	/** 무기 강화가 전투력에 더하는 값 (tier × weaponPowerPerTier) */
	weaponPower: number
	animation: 'walk' | 'interact' | 'attack' | null
	lastCollectedTree: TreeResource | null
	attackTarget: PlayerThreatSource | null
	playerAlive: boolean
	/** 비전투 회복 타이머 (ms). 전투/추격/도망 진입 시 리셋. */
	regenTimer: number
	avoidedAreas: AvoidedArea[]
	failedAreaAttempt: FailedAreaAttempt | null

	update(delta: number, now: number): void
	/** 피해를 입힌다. 체력이 0이 되면 playerAlive = false (사망). */
	applyDamage(amount: number): void
	/** 몬스터 처치 보상으로 체력을 회복한다(최대치까지). */
	applyKillHeal(): void
	/** 처치 경험치를 누적한다. 기준치를 넘으면 레벨업(공격력/체력/속도 증가)이 연속 발동한다. */
	addExperience(amount: number): void
	/** 다음 무기 강화 비용 (나무). */
	nextUpgradeCost(): number
	/** 나무를 소비해 무기를 강화한다. 나무가 부족하면 false. */
	upgradeWeapon(): boolean
}

const AREA_FAILURE_LIMIT = 2
const AREA_FAILURE_MEMORY_MS = 22_000
const AREA_AVOID_DURATION_MS = 45_000
const AREA_AVOID_PADDING = 45

// 직진이 막혔을 때 시도할 우회 각도(라디안). 장애물(풀/나무)에 끼여 무한 정체되는 것을 막는 스티어링 팬.
const DETOUR_OFFSETS = [
	0,
	Math.PI / 6, -Math.PI / 6,
	Math.PI / 3, -Math.PI / 3,
	Math.PI / 2, -Math.PI / 2,
	(2 * Math.PI) / 3, -(2 * Math.PI) / 3,
	Math.PI,
]

let lastAttackSwing = 0

/** 해당 레벨에 도달하기 위해 필요한 누적 구간 경험치. */
export function expForLevel(level: number, config: Pick<PlayerAgentConfig, 'expBase' | 'expGrowth'>): number {
	return Math.round(config.expBase * Math.pow(config.expGrowth, level - 1))
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
		attackingProgress: 0,
		activeTree: null,
		woodCollected: 0,
		health: config.playerMaxHealth,
		maxHealth: config.playerMaxHealth,
		exp: 0,
		level: 1,
		attackDamage: config.playerAttackDamage,
		weaponTier: 0,
		weaponPower: 0,
		animation: 'walk',
		lastCollectedTree: null,
		attackTarget: null,
		playerAlive: true,
		regenTimer: 0,
		avoidedAreas: [],
		failedAreaAttempt: null,

		applyDamage(amount: number) {
			this.health = Math.max(0, this.health - amount)
			if (this.health <= 0) this.playerAlive = false
		},

		applyKillHeal() {
			this.health = Math.min(this.maxHealth, this.health + config.killHealHealth)
		},

		addExperience(amount: number) {
			this.exp += amount
			let threshold = expForLevel(this.level, config)
			while (this.exp >= threshold) {
				this.exp -= threshold
				this.level += 1
				this.maxHealth += config.levelHealthBonus
				this.health = Math.min(this.maxHealth, this.health + config.levelHealthBonus)
				this.attackDamage += config.levelAttackBonus
				config.speed += config.levelSpeedBonus
				threshold = expForLevel(this.level, config)
			}
		},

		nextUpgradeCost() {
			return Math.round(config.upgradeCostBase * Math.pow(config.upgradeCostGrowth, this.weaponTier))
		},

		upgradeWeapon() {
			const cost = this.nextUpgradeCost()
			// 비상 나무 비축(reserveWood)을 남기고 강화한다 — 자동 강화가 생존 자원을 갈취하지 않도록
			if (this.woodCollected - cost < config.reserveWood) return false
			this.woodCollected -= cost
			this.weaponTier += 1
			this.attackDamage += config.weaponAttackPerTier
			this.weaponPower += config.weaponPowerPerTier
			return true
		},

		update(delta, now) {
			if (!this.playerAlive) return
			pruneAvoidedAreas(this, now)
			// 나무가 충분하면 즉시 무기를 강화한다 (나무 = 휘발성 자원 → 영구 전투력 전환)
			while (this.upgradeWeapon()) { /* 여러 단계 연속 강화 */ }

			// 비전투 중(탐색/이동/벌목)에는 일정 간격으로 체력 회복. 전투/추격/도망 중에는 정지.
			if (this.state === 'exploring' || this.state === 'approaching' || this.state === 'chopping') {
				this.regenTimer += delta * 1000
				if (this.regenTimer >= config.regenIntervalMs) {
					this.regenTimer -= config.regenIntervalMs
					this.health = Math.min(this.maxHealth, this.health + config.regenHealthAmount)
				}
			} else {
				this.regenTimer = 0
			}

			// 위기 체력(기준 이하)이면 교전을 접고 도주한다
			if (
				(this.state === 'attacking' || this.state === 'hunting')
				&& isPlayerCritical(this, config)
				&& this.attackTarget
			) {
				startFleeing(this, this.attackTarget, config, now)
			}

			// 공격 중이 아니면 매 프레임 전투 의사를 다시 판단한다:
			// 1) 이길 수 없는 적이 쫓아오면 도망 (또는 이미 붙었으면 맞서싸움)
			// 2) 그 외에는 나보다 약한 적을 발견하는 즉시 먼저 추격/공격한다 (선제공격)
			if (this.state !== 'attacking') {
				resolveCombatIntent(this, now, config)
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
				case 'hunting':
					updateHunting(this, delta, now, config)
					break
				case 'attacking':
					updateAttacking(this, now, config)
					break
			}
		},
	}
}

// ===== 전투 의사 결정: 강한 적 회피 → 약한 적 선제공격 =====
function resolveCombatIntent(agent: PlayerAgent, now: number, config: PlayerAgentConfig) {
	const critical = isPlayerCritical(agent, config)
	const hostiles = config.threatSources().filter(isHostileThreat)

	// 위기 체력에서는 "이길 수 없는 적"뿐 아니라 모든 적대적 위협이 도망 대상이다
	const threat = critical
		? findActiveThreat(agent.position, config)
		: findNearestStrongThreat(agent, hostiles, config)

	if (threat) {
		if (agent.state !== 'fleeing') {
			if (critical) {
				// 위기 체력: 근접 반격 없이 무조건 도주
				registerFailedAreaAttempt(agent, threat, now)
				startFleeing(agent, threat, config, now)
				return
			}
			if (shouldFleeThreat(agent, now, threat, config)) {
				registerFailedAreaAttempt(agent, threat, now)
				startFleeing(agent, threat, config, now)
				return
			}

			// 이길 수 없는 적이 바로 옆까지 붙었다면 도망 대신 맞서싸운다
			if (distanceTo(agent.position, threat.position) <= Math.max(config.attackRangeMeters, threat.attackRadius)) {
				engageTarget(agent, threat, now, config)
				return
			}
		}
		// 멀리 있는 강한 적에게서 도망 중이라면 도망을 지속한다 (updateFleeing 담당)
	}

	// 위기 체력에서는 새 전투를 시작하지 않는다 — 이탈 후 비전투 회복으로 재개한다
	if (critical) return

	// 도망할 이유가 없으면 가장 가까운 "약한 적"을 먼저 찾아 들어간다
	const prey = findPreyTarget(agent, config)
	if (prey) {
		engageTarget(agent, prey, now, config)
	}
}

function engageTarget(
	agent: PlayerAgent,
	threat: PlayerThreatSource,
	now: number,
	config: PlayerAgentConfig,
) {
	const distance = distanceTo(agent.position, threat.position)
	if (distance <= config.attackRangeMeters) {
		startAttacking(agent, threat, now, config)
	} else {
		startHunting(agent, threat, config)
	}
}

// ===== 探索：随机走，扫描范围内有树就靠近 =====
let lastTreeScan = 0

function updateExploring(agent: PlayerAgent, delta: number, config: PlayerAgentConfig) {
	// 사냥 본능: 잡을 만한(나보다 약한) 적이 존재하면 무작위 배회 대신 그쪽으로 이동한다.
	// 위기 체력에서는 사냥 자체를 쉰다 (회복 우선).
	// 나무가 근처(탐색 반경)에 있으면 아래 스캔이 벌목을 우선시한다 — 이동 중 opportunistic 벌목 유지.
	const seek = isPlayerCritical(agent, config) ? null : findSeekTarget(agent, config)
	if (seek) {
		agent.target = [...seek.position]
	} else if (distanceTo(agent.position, agent.target) < 2) {
		agent.target = pickExplorationTarget(agent.position, config, agent.avoidedAreas)
	}

	moveToward(agent, delta, config)

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
	const moved = moveToward(agent, delta, config)
	agent.bearing = faceTarget(agent, agent.target)

	// 완전히 갇혀 진행 불가면 그 나무를 포기한다 (무한 "나무로 이동" 정체 방지)
	if (!moved) {
		agent.activeTree = null
		agent.state = 'exploring'
		agent.animation = 'walk'
		return
	}

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

// ===== 攻击：对怪物挥砍，按 cooldown 节奏 =====
function updateAttacking(agent: PlayerAgent, now: number, config: PlayerAgentConfig) {
	// 대상 유효성 확인: 같은 id(또는 동일 객체)의 위협이 살아있는가
	const liveTarget = findLiveTarget(agent, config)
	if (!liveTarget || isDeadThreat(liveTarget)) {
		exitCombat(agent, config)
		return
	}

	const distance = distanceTo(agent.position, liveTarget.position)

	if (distance > config.attackRangeMeters) {
		// 사거리에서 이탈: 아직 약하고 포기 반경 안이면 추격(hunting)으로 갈아타고, 아니면 전투 종료
		const giveUpRange = config.attackRangeMeters * config.huntGiveUpRangeMultiplier
		if (distance <= giveUpRange && isThreatWeakerThanPlayer(agent, liveTarget, config)) {
			startHunting(agent, liveTarget, config)
		} else {
			exitCombat(agent, config)
		}
		return
	}

	// 面向怪物
	agent.bearing = faceTarget(agent, liveTarget.position)

	// 进度（挥砍动画）
	const swingWindow = config.attackDamageMs + config.attackCooldownMs
	agent.attackingProgress = Math.min(1, (now - lastAttackSwing) / swingWindow)

	// 挥砍动画结束后真正造成伤害
	if (now - lastAttackSwing >= swingWindow) {
		if (liveTarget.id !== undefined) {
			config.onAttackMonster?.(liveTarget.id, agent.attackDamage)
		}
		lastAttackSwing = now
		agent.attackingProgress = 0
	}

	agent.animation = 'attack'
}

// ===== 사냥：표적을 향해 이동하고 사거리에 들어오면 공격으로 전환 =====
function updateHunting(
	agent: PlayerAgent,
	delta: number,
	now: number,
	config: PlayerAgentConfig,
) {
	const liveTarget = findLiveTarget(agent, config)
	if (!liveTarget || isDeadThreat(liveTarget)) {
		exitCombat(agent, config)
		return
	}

	const distance = distanceTo(agent.position, liveTarget.position)
	const giveUpRange = config.attackRangeMeters * config.huntGiveUpRangeMultiplier

	if (distance > giveUpRange) {
		exitCombat(agent, config)
		return
	}

	if (distance <= config.attackRangeMeters) {
		startAttacking(agent, liveTarget, now, config)
		return
	}

	agent.target = [...liveTarget.position]
	const moved = moveToward(agent, delta, config)
	agent.bearing = faceTarget(agent, agent.target)
	agent.animation = 'walk'

	// 완전히 갇혀 표적으로 접근 불가면 추격을 포기한다
	if (!moved) exitCombat(agent, config)
}

function findLiveTarget(agent: PlayerAgent, config: PlayerAgentConfig): PlayerThreatSource | null {
	const target = agent.attackTarget
	if (!target) return null

	return config.threatSources().find(threat =>
		threat.id !== undefined ? threat.id === target.id : threat === target
	) ?? null
}

function isDeadThreat(threat: PlayerThreatSource): boolean {
	return threat.health !== undefined && threat.health <= 0
}

function startHunting(agent: PlayerAgent, threat: PlayerThreatSource, config: PlayerAgentConfig) {
	agent.state = 'hunting'
	agent.activeTree = null
	agent.choppingProgress = 0
	agent.attackTarget = threat
	agent.attackingProgress = 0
	agent.animation = 'walk'
	agent.target = [...threat.position]
	agent.bearing = faceTarget(agent, agent.target)
}

function startAttacking(agent: PlayerAgent, threat: PlayerThreatSource, now: number, config: PlayerAgentConfig) {
	agent.state = 'attacking'
	agent.activeTree = null
	agent.choppingProgress = 0
	agent.attackTarget = threat
	agent.attackingProgress = 0
	agent.animation = 'attack'
	lastAttackSwing = now
	agent.target = [...threat.position]
}

function exitCombat(agent: PlayerAgent, config: PlayerAgentConfig) {
	agent.state = 'exploring'
	agent.attackTarget = null
	agent.attackingProgress = 0
	agent.animation = 'walk'
	agent.target = pickExplorationTarget(agent.position, config, agent.avoidedAreas)
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
// 직진이 막히면 좌/우로 각도를 벌려 우회를 시도하고, 그마저 전부 막히면 탐색 목표를 다시 고른다.
// 반환값: 실제로 이동했거나 도착 상태면 true, 완전히 갇혀 진행 불가면 false.
function moveToward(agent: PlayerAgent, delta: number, config: PlayerAgentConfig): boolean {
	const dx = agent.target[0] - agent.position[0]
	const dz = agent.target[1] - agent.position[1]
	const distance = Math.hypot(dx, dz)

	if (distance < 1) return true

	const travelDistance = Math.min(distance, config.speed * delta)
	const baseAngle = Math.atan2(dx, dz)

	for (const offset of DETOUR_OFFSETS) {
		const angle = baseAngle + offset
		// 직진(offset 0)은 기존과 동일한 정규화 벡터를 써서 부동소수점 오차를 피한다
		const dirX = offset === 0 ? dx / distance : Math.sin(angle)
		const dirZ = offset === 0 ? dz / distance : Math.cos(angle)
		const candidate: PlanePoint = [
			agent.position[0] + dirX * travelDistance,
			agent.position[1] + dirZ * travelDistance,
		]
		if (!config.collisionCheck(candidate)) {
			agent.position = candidate
			return true
		}
	}

	// 모든 방향이 막힘: 탐색 목표를 다시 정한다
	agent.target = pickExplorationTarget(agent.position, config, agent.avoidedAreas)
	return false
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

export function shouldFleeThreat(
	agent: PlayerAgent,
	now: number,
	threat: PlayerThreatSource,
	config: PlayerAgentConfig,
): boolean {
	if (agent.state === 'fleeing') return false
	if (agent.state === 'attacking') return false
	// 怪物已经到了它的攻击范围内：准备近战而不是逃跑
	return computeFleeDecision(agent, now, threat, config, distanceTo(agent.position, threat.position))
}

function computeFleeDecision(
	agent: PlayerAgent,
	now: number,
	threat: PlayerThreatSource,
	config: PlayerAgentConfig,
	distanceToThreat: number,
): boolean {
	// 이미 근접전 거리면 버티고 싸운다
	if (isThreatAtMeleeRange(distanceToThreat, threat.attackRadius)) return false
	// 플레이어 공격 사거리 안이면 맞서싸움 (도망 아님)
	if (distanceToThreat <= config.attackRangeMeters) return false
	// 벌목 중에는 이길 수 없는 적에 한해 "벌목을 끝내고 도망칠 시간이 되는지" 실시간 비교한다
	if (agent.state === 'chopping' && !isThreatWeakerThanPlayer(agent, threat, config)) {
		const remainingChopMs = Math.max(0, config.chopDurationMs - (now - lastTreeScan))
		const distanceBeforeHit = Math.max(0, distanceToThreat - threat.attackRadius)
		const timeUntilHitMs = (distanceBeforeHit / Math.max(threat.speed, 1)) * 1000
		const fleeTarget = pickFleeTarget(agent.position, threat, config)
		const timeToEscapeMs = (distanceTo(agent.position, fleeTarget) / Math.max(config.speed, 1)) * 1000

		return remainingChopMs + timeToEscapeMs > timeUntilHitMs
	}
	// 사거리 밖의 강한 적은 즉시 도망. 약한 적은 여기서 도망하지 않는다(선제공격은 의사결정 단계 담당)
	return !isThreatWeakerThanPlayer(agent, threat, config)
}

export function isThreatAtMeleeRange(distanceToThreat: number, threatAttackRadius: number): boolean {
	if (distanceToThreat <= threatAttackRadius) return true
	return false
}

export function isWithinPlayerAttackRange(distanceToThreat: number, playerAttackRangeMeters: number): boolean {
	return distanceToThreat <= playerAttackRangeMeters
}

export function isOutsidePlayerAttackRange(distanceToThreat: number, playerAttackRangeMeters: number): boolean {
	if (distanceToThreat > playerAttackRangeMeters) return true
	return false
}

// ===== 전투력 비교: 나보다 약한 적인가? =====
export function computePlayerPower(agent: PlayerAgent, config: PlayerAgentConfig): number {
	return config.playerBasePower
		+ agent.woodCollected * config.powerPerWood
		+ agent.weaponPower
}

export function computeThreatStrength(threat: PlayerThreatSource, config: PlayerAgentConfig): number {
	const health = threat.health
	// 체력 정보가 없으면 알 수 없는 위협 → 항상 강한 것으로 취급
	if (health === undefined) return Number.POSITIVE_INFINITY
	return health * config.monsterHealthPowerWeight + (threat.attackDamage ?? 0) * config.monsterAttackPowerWeight
}

export function isThreatWeakerThanPlayer(
	agent: PlayerAgent,
	threat: PlayerThreatSource,
	config: PlayerAgentConfig,
): boolean {
	return computeThreatStrength(threat, config) < computePlayerPower(agent, config)
}

export function canWinAgainstThreat(
	agent: PlayerAgent,
	threat: PlayerThreatSource,
	config: PlayerAgentConfig,
): boolean {
	return isThreatWeakerThanPlayer(agent, threat, config)
}

export function mustFlee(
	agent: PlayerAgent,
	threat: PlayerThreatSource,
	config: PlayerAgentConfig,
): boolean {
	return !canWinAgainstThreat(agent, threat, config)
}

/** 위기 체력: maxHealth × criticalHealthRatio 이하면 true. 도주 우선 모드. */
export function isPlayerCritical(
	agent: PlayerAgent,
	config: Pick<PlayerAgentConfig, 'criticalHealthRatio'>,
): boolean {
	return agent.health <= agent.maxHealth * config.criticalHealthRatio
}

// ===== 사냥감 탐색: 활동 반경 안에서 "나보다 약한" 가장 가까운 적 =====
export function findPreyTarget(agent: PlayerAgent, config: PlayerAgentConfig): PlayerThreatSource | null {
	// 스캔 범위는 레벨과 함께 넓어진다 (성장할수록 더 멀리서 전투를 시작)
	const scanRange = config.attackRangeMeters * config.huntAggroRangeMultiplier
		+ (agent.level - 1) * config.huntScanRangePerLevel
	let nearest: PlayerThreatSource | null = null
	let nearestDistance = Number.POSITIVE_INFINITY
	for (const threat of config.threatSources()) {
		if (isDeadThreat(threat)) continue
		if (!isThreatWeakerThanPlayer(agent, threat, config)) continue
		const distanceFromHome = distanceTo(agent.position, threat.homePosition)
		if (distanceFromHome > threat.activityRadius) continue
		const distanceFromThreat = distanceTo(agent.position, threat.position)
		if (distanceFromThreat > scanRange) continue
		if (isCloserThreat(distanceFromThreat, nearestDistance)) {
			nearest = threat
			nearestDistance = distanceFromThreat
		}
	}
	return nearest
}

function isCloserThreat(distanceFromThreat: number, nearestDistance: number): boolean {
	if (distanceFromThreat < nearestDistance) return true
	return false
}

/** 추격/공격 중인(플레이어에게 적대적인) 위협인지. 기본값은 true. */
export function isHostileThreat(threat: PlayerThreatSource): boolean {
	return threat.hostile !== false
}

// ===== 사냥 본능: 활동 반경/스캔 범위 제한 없이 세계에서 가장 가까운 "약한" 적 =====
// 탐색 중일 때 이 대상을 향해 걸어가므로, 성장할수록(약한 적 판정이 넓어질수록) 전투가 빈번해진다.
export function findSeekTarget(agent: PlayerAgent, config: PlayerAgentConfig): PlayerThreatSource | null {
	let nearest: PlayerThreatSource | null = null
	let nearestDistance = Number.POSITIVE_INFINITY
	for (const threat of config.threatSources()) {
		if (isDeadThreat(threat)) continue
		if (!isThreatWeakerThanPlayer(agent, threat, config)) continue
		const distance = distanceTo(agent.position, threat.position)
		if (isCloserThreat(distance, nearestDistance)) {
			nearest = threat
			nearestDistance = distance
		}
	}
	return nearest
}

function findNearestStrongThreat(
	agent: PlayerAgent,
	hostiles: PlayerThreatSource[],
	config: PlayerAgentConfig,
): PlayerThreatSource | null {
	let nearest: PlayerThreatSource | null = null
	let nearestDistance = Number.POSITIVE_INFINITY
	for (const threat of hostiles) {
		const distanceFromHome = distanceTo(agent.position, threat.homePosition)
		if (distanceFromHome > threat.activityRadius) continue
		if (isThreatWeakerThanPlayer(agent, threat, config)) continue
		const distanceFromThreat = distanceTo(agent.position, threat.position)
		if (isCloserThreat(distanceFromThreat, nearestDistance)) {
			nearest = threat
			nearestDistance = distanceFromThreat
		}
	}
	return nearest
}

function findActiveThreat(position: PlanePoint, config: PlayerAgentConfig): PlayerThreatSource | null {
	let nearestThreat: PlayerThreatSource | null = null
	let nearestDistance = Number.POSITIVE_INFINITY

	for (const threat of config.threatSources()) {
		if (!isHostileThreat(threat)) continue
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
