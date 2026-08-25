<template>
	<div class="game-stage">
		<div ref="sceneContainer" class="scene-container"></div>
		<div class="monster-overlay" aria-hidden="true">
			<div
				v-for="bar in monsterBars"
				:key="bar.id"
				class="monster-hpbar"
				:style="bar.style"
			>
				<div class="monster-hpbar__fill" :style="{ width: `${bar.percent}%` }"></div>
			</div>
			<div
				v-for="popup in damagePopups"
				:key="popup.id"
				class="damage-popup"
				:class="`damage-popup--${popup.kind}`"
				:style="popup.style"
			>{{ popup.text }}</div>
		</div>
		<div class="language-switcher" role="group" :aria-label="t('language.label')">
			<button type="button" :class="{ active: locale === 'en' }" @click="changeLocale('en')">{{ t('language.english') }}</button>
			<button type="button" :class="{ active: locale === 'zh-CN' }" @click="changeLocale('zh-CN')">{{ t('language.chinese') }}</button>
			<button type="button" :class="{ active: locale === 'ko' }" @click="changeLocale('ko')">{{ t('language.korean') }}</button>
		</div>
		<div class="reward-toast-stack" aria-live="polite">
			<div v-for="toast in rewardToasts" :key="toast.id" class="reward-toast">
				{{ toast.text }}
			</div>
		</div>
		<div class="resource-panel">
			<div class="resource-panel__day">{{ t('hud.day', { day: currentDay }) }}</div>
			<div class="resource-panel__label">{{ t('hud.wood') }}</div>
			<div class="resource-panel__value">{{ woodCount }}</div>
			<div class="resource-panel__consumption">{{ t('hud.dailyUse', { count: woodPerDay }) }}</div>
			<div class="resource-panel__hint">{{ choppingHint }}</div>
			<div v-if="lowWoodWarning" class="resource-panel__warning">{{ t('hud.lowWood') }}</div>
			<div :key="killsPulseKey" class="resource-panel__kills" :class="{ 'resource-panel__kills--pulse': killsPulsing }">
				<span class="resource-panel__kills-label">{{ t('hud.combat.kills', { count: monsterKills }) }}</span>
				<span v-if="isInCombat" class="resource-panel__combat-dot" :title="t('hud.combat.attacking', { progress: Math.round(attackingProgress * 100) })"></span>
			</div>
			<div v-if="choppingProgress > 0" class="resource-panel__progress">
				<div
					class="resource-panel__progress-bar"
					:style="{ width: `${Math.round(choppingProgress * 100)}%` }"
				></div>
			</div>
		</div>
		<div class="minimap-wrapper">
			<canvas ref="minimapCanvas" class="minimap-canvas" />
		</div>
		<button class="minimap-toggle" @click="toggleCameraMode" :title="t(cameraMode === 'follow' ? 'camera.free' : 'camera.follow')">
			{{ cameraMode === 'follow' ? '🔒' : '🔓' }}
		</button>
		<div class="player-status" aria-live="polite">
			<div class="player-status__title">{{ t('hud.status.title') }}</div>
			<div class="player-status__row">
				<span class="player-status__label">{{ t('hud.status.state') }}</span>
				<span class="player-status__value" :class="`player-status__value--${status.state}`">{{ stateLabel }}</span>
			</div>
			<div class="player-status__row">
				<span class="player-status__label">{{ t('hud.status.life') }}</span>
				<span class="player-status__value" :class="{ 'player-status__value--low': lifeRatio < 0.2 }">
					{{ status.life }} / {{ status.lifeMax }}
				</span>
			</div>
			<div class="player-status__bar">
				<div
					class="player-status__bar-fill"
					:class="{ 'player-status__bar-fill--low': lifeRatio < 0.2 }"
					:style="{ width: `${Math.round(lifeRatio * 100)}%` }"
				></div>
			</div>
			<div class="player-status__row">
				<span class="player-status__label">{{ t('hud.status.wood') }}</span>
				<span class="player-status__value">{{ status.wood }}</span>
			</div>
			<div class="player-status__row">
				<span class="player-status__label">{{ t('hud.status.attack') }}</span>
				<span class="player-status__value">{{ status.attack }}</span>
			</div>
			<div class="player-status__row">
				<span class="player-status__label">{{ t('hud.status.weapon') }}</span>
				<span class="player-status__value">Lv. {{ status.weaponTier }}</span>
			</div>
			<div class="player-status__row player-status__row--hint">
				<span>{{ t('hud.status.nextUpgrade', { count: status.upgradeCost }) }}</span>
			</div>
			<div class="player-status__row">
				<span class="player-status__label">{{ t('hud.status.power') }}</span>
				<span class="player-status__value">{{ status.power }}</span>
			</div>
			<div class="player-status__row">
				<span class="player-status__label">{{ t('hud.status.level') }}</span>
				<span class="player-status__value">{{ status.level }}</span>
			</div>
			<div class="player-status__row">
				<span class="player-status__label">{{ t('hud.status.exp') }}</span>
				<span class="player-status__value">{{ status.exp }} / {{ status.expNext }}</span>
			</div>
			<div class="player-status__row">
				<span class="player-status__label">{{ t('hud.status.target') }}</span>
				<span class="player-status__value">
					<template v-if="status.target">{{ status.target }} · {{ t(status.targetStrong ? 'hud.status.strong' : 'hud.status.weak') }}</template>
					<template v-else>{{ t('hud.status.targetNone') }}</template>
				</span>
			</div>
			<div class="player-status__row player-status__row--hint">
				<span>{{ t('hud.status.nearby') }}: {{ t('hud.status.hostile') }} {{ status.hostileCount }} · {{ t('hud.status.preyShort') }} {{ status.preyCount }}</span>
			</div>
			<div class="player-status__line player-status__line--threat">{{ status.threatLine || t('hud.status.none') }}</div>
			<div class="player-status__line player-status__line--prey">{{ status.preyLine || t('hud.status.none') }}</div>
		</div>
		<div v-if="bossBar" class="boss-bar">
			<div class="boss-bar__name">{{ bossBar.name }} · {{ bossBar.distance }}m</div>
			<div class="boss-bar__track">
				<div class="boss-bar__fill" :style="{ width: `${bossBar.percent}%` }"></div>
			</div>
			<div class="boss-bar__hp">{{ bossBar.health }} / {{ bossBar.maxHealth }}</div>
		</div>
		<div v-if="daySummary.visible" class="day-summary">
			<div class="day-summary__title">{{ t('hud.summary.title', { day: daySummary.day }) }}</div>
			<div class="day-summary__text">{{ t('hud.summary.text', { wood: daySummary.wood, kills: daySummary.kills, damage: daySummary.damage }) }}</div>
		</div>
		<div class="combat-log" aria-live="polite">
			<div
				v-for="entry in combatLog"
				:key="entry.id"
				class="combat-log__entry"
				:class="`combat-log__entry--${entry.kind}`"
			>{{ entry.text }}</div>
		</div>
		<div class="game-controls" role="group" :aria-label="'game speed'">
			<button type="button" class="game-controls__btn" @click="paused = !paused">{{ paused ? '▶' : '⏸' }}</button>
			<button
				v-for="speed in [1, 2, 4]"
				:key="speed"
				type="button"
				class="game-controls__btn"
				:class="{ 'game-controls__btn--active': gameSpeed === speed }"
				@click="gameSpeed = speed"
			>×{{ speed }}</button>
		</div>
		<div v-if="gameOver" class="game-over-overlay">
			<div class="game-over-content">
				<h2>{{ t('gameOver.title') }}</h2>
				<p>{{ t('gameOver.survived', { days: currentDay - 1 }) }}</p>
				<p>{{ t(deathCause === 'slain' ? 'gameOver.slain' : 'gameOver.exhausted') }}</p>
				<p v-if="bestRecord" class="game-over-best">{{ t('gameOver.best', { days: bestRecord.days, kills: bestRecord.kills }) }}</p>
				<button class="game-over-btn" @click="restartGame">{{ t('gameOver.restart') }}</button>
			</div>
		</div>
	</div>
</template>

<script lang="ts" setup>
import {
	AmbientLight,
	Box3,
	Clock,
	DirectionalLight,
	Group,
	HemisphereLight,
	Material,
	MathUtils,
	Mesh,
	MeshStandardMaterial,
	Object3D,
	PCFSoftShadowMap,
	PerspectiveCamera,
	PlaneGeometry,
	Scene,
	Texture,
	TextureLoader,
	Vector3,
	WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { readStoredLocale, storeLocale, type AppLocale } from '~/i18n/language'

import { loadBestRecord, saveBestRecord } from '~/game/records'

import {
	COMBAT_AGGRESSION_CONFIG,
	DEAD_TREE_CONFIG,
	DAY_CYCLE_CONFIG,
	ENVIRONMENT_CONFIG,
	MONSTER_CONFIG,
	MONSTER_GUARDIAN_CONFIG,
	PLAYER_CONFIG,
	PROGRESSION_CONFIG,
	SKILL_CONFIG,
	TREE_RESOURCE_CONFIG,
	WEAPON_CONFIG,
} from '~/config'
import {
	createPlayerAnimationController,
	type PlayerAnimationController,
} from '~/game/player/animations'
import {
	createPlayerAgent,
	expForLevel,
	type PlayerAgent,
} from '~/game/player/agent'
import {
	createEnvironmentObjects,
	type EnvironmentObject,
} from '~/game/resources/environment'
import {
	createNoiseTrees,
	createRandomTree,
	type PlanePoint,
	type TreeResource,
} from '~/game/resources/trees'
import {
	createMonsterAnimationController,
	type MonsterAnimationController,
} from '~/game/player/monster-animations'
import {
	createMonsterAgent,
	createMonsterResources,
	createBossMonster,
	createRespawnMonster,
	type MonsterAgent,
	type MonsterResource,
	type MonsterUpdateContext,
} from '~/game/resources/monsters'
import {
	createDayCycle,
	type DayCycleState,
} from '~/game/time/day-cycle'
import {
	createLightingController,
	type LightingController,
} from '~/game/time/lighting'

defineOptions({
	name: 'GameScene',
})

const appBaseURL = useRuntimeConfig().app.baseURL
const { locale, setLocale, t } = useI18n()
const assetURL = (path: string) => `${appBaseURL}${path.replace(/^\/+/, '')}`

async function changeLocale(nextLocale: AppLocale): Promise<void> {
	await setLocale(nextLocale)
	document.documentElement.lang = nextLocale
	storeLocale(localStorage, nextLocale)
}

onMounted(() => {
	void changeLocale(readStoredLocale(localStorage))
})

const sceneContainer = ref<HTMLDivElement | null>(null)
const minimapCanvas = ref<HTMLCanvasElement | null>(null)
const choppingProgress = ref(0)
const woodCount = ref(0)
const monsterKills = ref(0)
const currentDay = ref(1)
const playerAlive = ref(true)
const gameOver = ref(false)
const deathCause = ref<'starvation' | 'slain'>('starvation')
const lowWoodWarning = ref(false)
const woodPerDay = DAY_CYCLE_CONFIG.woodConsumedPerDay
const PLAYER_ATTACK_DAMAGE = 17
const cameraMode = ref<'follow' | 'free'>('follow')
const choppingHint = computed(() => {
	if (gameOver.value) return t('hud.gameOver')
	if (choppingProgress.value > 0) {
		return t('hud.chopping', { progress: Math.round(choppingProgress.value * 100) })
	}

	return t('hud.approachTree')
})

const attackingProgress = ref(0)
const isInCombat = computed(() => attackingProgress.value > 0)

// ===== 몬스터 HP바 + 데미지 팝업 오버레이 =====
type MonsterBarView = { id: string; style: Record<string, string>; percent: number }
type DamagePopupView = { id: number; kind: 'damage' | 'hurt'; text: string; createdAt: number; style: Record<string, string> }

const monsterBars = ref<MonsterBarView[]>([])
const damagePopups = ref<DamagePopupView[]>([])
let popupSeq = 0
const POPUP_LIFETIME_MS = 900
const MONSTER_BAR_HEIGHT = 8 // 몬스터 머리 위 오프셋 (모델 높이 ≈ 6)

// 월드 좌표 → 화면 픽셀 좌표. 카메라 뒤쪽이면 visible=false
function projectWorldToScreen(x: number, y: number, z: number): { left: number; top: number; visible: boolean } {
	if (!camera || !sceneContainer.value) return { left: 0, top: 0, visible: false }
	const vector = new Vector3(x, y, z).project(camera)
	if (vector.z > 1) return { left: 0, top: 0, visible: false }
	return {
		left: (vector.x * 0.5 + 0.5) * sceneContainer.value.clientWidth,
		top: (-vector.y * 0.5 + 0.5) * sceneContainer.value.clientHeight,
		visible: true,
	}
}

function spawnDamagePopup(x: number, y: number, z: number, text: string, kind: 'damage' | 'hurt') {
	const point = projectWorldToScreen(x, y, z)
	if (!point.visible) return
	damagePopups.value = [...damagePopups.value, {
		id: ++popupSeq,
		kind,
		text,
		createdAt: gameNow,
		style: { left: `${point.left}px`, top: `${point.top}px` },
	}]
}

function updateMonsterOverlay() {
	damagePopups.value = damagePopups.value.filter(popup => gameNow - popup.createdAt < POPUP_LIFETIME_MS)

	if (!camera) {
		monsterBars.value = []
		return
	}

	const bars: MonsterBarView[] = []
	for (const agent of monsterAgents) {
		const resource = agent.resource
		if (resource.health <= 0) continue
		// 피해를 입었거나 전투 중인 몬스터만 표시
		const hostile = agent.state === 'chase' || agent.state === 'attack' || agent.state === 'hit'
		if (resource.health >= resource.maxHealth && !hostile) continue

		const point = projectWorldToScreen(agent.position[0], MONSTER_BAR_HEIGHT, agent.position[1])
		if (!point.visible) continue

		bars.push({
			id: resource.id,
			style: { left: `${point.left}px`, top: `${point.top}px` },
			percent: Math.max(0, Math.round((resource.health / resource.maxHealth) * 100)),
		})
	}
	monsterBars.value = bars
}

// ===== 플레이어 상태 창: FSM 상태/체력/전투력/레벨/타겟/주변 위협을 매 프레임 노출 =====
const STATUS_STATE_KEYS: Record<string, string> = {
	exploring: 'hud.status.states.exploring',
	approaching: 'hud.status.states.approaching',
	chopping: 'hud.status.states.chopping',
	fleeing: 'hud.status.states.fleeing',
	hunting: 'hud.status.states.hunting',
	attacking: 'hud.status.states.attacking',
}

type PlayerStatusSnapshot = {
	state: string
	life: number
	lifeMax: number
	wood: number
	attack: number
	weaponTier: number
	upgradeCost: number
	power: number
	level: number
	exp: number
	expNext: number
	target: string
	targetStrong: boolean
	hostileCount: number
	preyCount: number
	threatLine: string
	preyLine: string
}

const status = ref<PlayerStatusSnapshot>({
	state: 'exploring',
	life: PLAYER_CONFIG.maxHealth,
	lifeMax: PLAYER_CONFIG.maxHealth,
	wood: 0,
	attack: PLAYER_ATTACK_DAMAGE,
	weaponTier: 0,
	upgradeCost: WEAPON_CONFIG.upgradeCostBase,
	power: COMBAT_AGGRESSION_CONFIG.playerBasePower,
	level: 1,
	exp: 0,
	expNext: PROGRESSION_CONFIG.expBase,
	target: '',
	targetStrong: false,
	hostileCount: 0,
	preyCount: 0,
	threatLine: '',
	preyLine: '',
})

// 생명력 비율: 실제 HP / 최대 체력
const lifeRatio = computed(() => Math.min(1, status.value.life / status.value.lifeMax))

const stateLabel = computed(() => t(STATUS_STATE_KEYS[status.value.state] ?? 'hud.status.states.exploring'))

// 에이전트 내부 판정과 동일한 전투력 공식 (진단용 미러링)
function monsterStrengthOf(resource: MonsterResource): number {
	return resource.health * COMBAT_AGGRESSION_CONFIG.monsterHealthPowerWeight
		+ resource.attackDamage * COMBAT_AGGRESSION_CONFIG.monsterAttackPowerWeight
}

function updatePlayerStatus() {
	if (!playerAgent) return
	const agent = playerAgent
	const power = COMBAT_AGGRESSION_CONFIG.playerBasePower
		+ agent.woodCollected * COMBAT_AGGRESSION_CONFIG.powerPerWood

	const [px, pz] = agent.position
	const live = monsterAgents.filter(candidate => candidate.resource.health > 0)
	const infos = live.map(candidate => ({
		resource: candidate.resource,
		strength: Math.round(monsterStrengthOf(candidate.resource)),
		weaker: monsterStrengthOf(candidate.resource) < power,
		hostile: candidate.state === 'chase' || candidate.state === 'attack' || candidate.state === 'hit',
		distance: Math.round(Math.hypot(candidate.position[0] - px, candidate.position[1] - pz)),
		contained: Math.hypot(candidate.resource.homePosition[0] - px, candidate.resource.homePosition[1] - pz)
			<= candidate.resource.activityRadius,
	}))

	const hostiles = infos.filter(info => info.hostile)
	const prey = infos.filter(info =>
		info.weaker
		&& info.contained
		&& info.distance <= PLAYER_CONFIG.attackRangeMeters * COMBAT_AGGRESSION_CONFIG.huntAggroRangeMultiplier
	)
	const strongest = hostiles
		.filter(info => !info.weaker && info.contained)
		.sort((a, b) => a.distance - b.distance)[0] ?? null
	const nearestPrey = [...prey].sort((a, b) => a.distance - b.distance)[0] ?? null

	const targetResource = agent.attackTarget
		? live.find(candidate => candidate.resource.id === agent.attackTarget?.id)?.resource ?? null
		: null

	status.value = {
		state: agent.state,
		life: Math.max(0, agent.health),
		lifeMax: agent.maxHealth,
		wood: Math.max(0, agent.woodCollected),
		attack: agent.attackDamage,
		weaponTier: agent.weaponTier,
		upgradeCost: agent.nextUpgradeCost(),
		power: Math.round(power),
		level: agent.level,
		exp: Math.floor(agent.exp),
		expNext: expForLevel(agent.level, PROGRESSION_CONFIG),
		target: targetResource
			? `${targetResource.modelName} (${targetResource.health}/${targetResource.maxHealth})`
			: '',
		targetStrong: targetResource ? monsterStrengthOf(targetResource) >= power : false,
		hostileCount: hostiles.length,
		preyCount: prey.length,
		threatLine: strongest
			? t('hud.status.threatLine', { model: strongest.resource.modelName, power: strongest.strength, distance: strongest.distance })
			: '',
		preyLine: nearestPrey
			? t('hud.status.preyLine', { model: nearestPrey.resource.modelName, power: nearestPrey.strength, distance: nearestPrey.distance })
			: '',
	}
}

let animationFrame = 0
let clock: Clock | null = null
let camera: PerspectiveCamera | null = null
let orbitControls: OrbitControls | null = null
let playerAgent: PlayerAgent | null = null
let playerAnimation: PlayerAnimationController | null = null
let playerModel: Object3D | null = null
let renderer: WebGLRenderer | null = null
let scene: Scene | null = null

// 게임 시계: 배속/일시정지를 지원하기 위해 실시간과 분리된 누적 시간 (ms)
let gameNow = 0
const gameSpeed = ref(1)
const paused = ref(false)
let treeGroup: Group | null = null
let treeResources: TreeResource[] = []
const deadTreeTemplates = new Map<number, Object3D>()
const liveTreeTemplates = new Map<number, Object3D>()
const treeObjects = new Map<string, Object3D>()
const fadingTrees: { object: Object3D; createdAt: number }[] = []
let environmentObjects: EnvironmentObject[] = []
const envTemplates = new Map<string, Object3D>()
let monsterResources: MonsterResource[] = []
const monsterAgents: MonsterAgent[] = []
const monsterObjects = new Map<string, Object3D>()
const monsterAnimations = new Map<string, MonsterAnimationController>()

// 昼夜循环和光照
let dayCycle: ReturnType<typeof createDayCycle> | null = null
let lightingController: LightingController | null = null
let hemisphereLight: HemisphereLight | null = null
let ambientLight: AmbientLight | null = null
let keyLight: DirectionalLight | null = null
let rimLight: DirectionalLight | null = null

const WORLD_RADIUS = TREE_RESOURCE_CONFIG.radiusMeters
const PLAYER_START: PlanePoint = [0, 0]
const CAMERA_OFFSET = new Vector3(0, 180, 240)
const MINIMAP_SIZE = 180

onMounted(() => {
	createScene()
	bestRecord.value = loadBestRecord(localStorage)
})

onUnmounted(() => {
	disposeScene()
})

function createScene() {
	if (!sceneContainer.value) return

	clock = new Clock()
	scene = new Scene()

	camera = new PerspectiveCamera(
		52,
		sceneContainer.value.clientWidth / sceneContainer.value.clientHeight,
		1,
		5000,
	)

	renderer = new WebGLRenderer({ antialias: true })
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
	renderer.setSize(sceneContainer.value.clientWidth, sceneContainer.value.clientHeight)
	renderer.shadowMap.enabled = true
	renderer.shadowMap.type = PCFSoftShadowMap
	sceneContainer.value.appendChild(renderer.domElement)

	orbitControls = new OrbitControls(camera, renderer.domElement)
	orbitControls.enableDamping = true
	orbitControls.dampingFactor = 0.08
	orbitControls.maxPolarAngle = Math.PI / 2.1
	orbitControls.minDistance = 50
	orbitControls.maxDistance = 1500
	orbitControls.enabled = false

	// 初始化小地图 canvas 分辨率
	if (minimapCanvas.value) {
		const dpr = Math.min(window.devicePixelRatio, 2)
		minimapCanvas.value.width = MINIMAP_SIZE * dpr
		minimapCanvas.value.height = MINIMAP_SIZE * dpr
	}

	// 初始化昼夜循环
	dayCycle = createDayCycle(DAY_CYCLE_CONFIG)

	addEnvironment(scene)
	createTrees(scene)
	createEnvObjects(scene)
	createMonsters(scene)
	createPlayer(scene)
	window.addEventListener('resize', handleResize)
	animationFrame = window.requestAnimationFrame(renderFrame)
}

function addEnvironment(targetScene: Scene) {
	new TextureLoader().load(assetURL('/sky/sky.jpg'), texture => {
		targetScene.background = texture
	})

	hemisphereLight = new HemisphereLight('#c9fbff', '#193023', 1.9)
	ambientLight = new AmbientLight('#ffffff', 0.55)
	keyLight = new DirectionalLight('#fff4dc', 4.6)
	keyLight.position.set(-280, 520, 260)
	keyLight.castShadow = true
	keyLight.shadow.mapSize.set(2048, 2048)
	keyLight.shadow.camera.near = 20
	keyLight.shadow.camera.far = 1400
	keyLight.shadow.camera.left = -900
	keyLight.shadow.camera.right = 900
	keyLight.shadow.camera.top = 900
	keyLight.shadow.camera.bottom = -900
	rimLight = new DirectionalLight('#35f4ff', 1.1)
	rimLight.position.set(320, 280, -420)

	targetScene.add(hemisphereLight, ambientLight, keyLight, keyLight.target, rimLight)

	// 创建光照控制器
	lightingController = createLightingController({
		hemisphere: hemisphereLight,
		ambient: ambientLight,
		key: keyLight,
		rim: rimLight,
	})

	const ground = new Mesh(
		new PlaneGeometry(WORLD_RADIUS * 2.6, WORLD_RADIUS * 2.6, 1, 1),
		new MeshStandardMaterial({
			color: '#0c281f',
			roughness: 0.95,
			metalness: 0.02,
		}),
	)
	ground.rotation.x = -Math.PI / 2
	ground.receiveShadow = true
	targetScene.add(ground)
}

function createTrees(targetScene: Scene) {
	treeGroup = new Group()
	targetScene.add(treeGroup)
	treeResources = createNoiseTrees(TREE_RESOURCE_CONFIG)
	woodCount.value = 0
	choppingProgress.value = 0
	treeObjects.clear()

	TREE_RESOURCE_CONFIG.modelUrls.forEach((modelUrl, modelIndex) => {
		new GLTFLoader().load(
			assetURL(modelUrl),
			gltf => {
				const template = normalizeModel(gltf.scene)
				liveTreeTemplates.set(modelIndex, template)
				spawnTreeInstances(template, modelIndex)
			},
			undefined,
			error => console.error(`나무 모델 로드 실패: ${modelUrl}`, error),
		)
	})

	TREE_RESOURCE_CONFIG.deadModelUrls.forEach((modelUrl, modelIndex) => {
		new GLTFLoader().load(
			assetURL(modelUrl),
			gltf => {
				deadTreeTemplates.set(modelIndex, normalizeModel(gltf.scene))
			},
			undefined,
			error => console.error(`마른나무 모델 로드 실패: ${modelUrl}`, error),
		)
	})
}

function spawnTreeInstances(template: Object3D, modelIndex: number) {
	treeResources
		.filter(tree => tree.modelIndex === modelIndex && !tree.collected)
		.forEach(tree => {
			if (treeObjects.has(tree.id)) return
			const object = new Group()
			const model = template.clone(true)
			model.rotation.y = tree.rotation
			model.scale.multiplyScalar(tree.scale)
			object.add(model)
			object.position.set(tree.position[0], 0, tree.position[1])
			treeObjects.set(tree.id, object)
			treeGroup?.add(object)
		})
}

function createEnvObjects(targetScene: Scene) {
	const envGroup = new Group()
	targetScene.add(envGroup)
	environmentObjects = createEnvironmentObjects(ENVIRONMENT_CONFIG)

	const allUrls = new Map<string, { category: string; index: number }>()
	for (const [category, urls] of Object.entries(ENVIRONMENT_CONFIG.modelUrls)) {
		urls.forEach((url, index) => {
			allUrls.set(url, { category, index })
		})
	}

	allUrls.forEach(({ category, index }, url) => {
		new GLTFLoader().load(
			assetURL(url),
			gltf => {
				const template = normalizeModel(gltf.scene)
				envTemplates.set(`${category}-${index}`, template)

				environmentObjects
					.filter(obj => obj.modelCategory === category && obj.modelIndex === index)
					.forEach(obj => {
						const wrapper = new Group()
						const model = template.clone(true)
						model.rotation.y = obj.rotation
						model.scale.multiplyScalar(obj.scale)
						wrapper.add(model)
						wrapper.position.set(obj.position[0], 0, obj.position[1])
						envGroup.add(wrapper)
					})
			},
			undefined,
			error => console.error(`환경 모델 로드 실패: ${url}`, error),
		)
	})
}

// 리스폰 대기열: 처치된 몬스터의 모델 인덱스와 부활 예정일
const pendingRespawns: { dueDay: number; modelIndex: number }[] = []
let respawnSeq = 0
// 플레이어 스윙/광역 스킬 → 다음 updateMonsters에서 FSM이 처리할 피해 패킷 목록
let pendingPlayerHits: { id: string; damage: number }[] = []
// 처치 보상 중복 지급 방지 + 사망 연출 중인 시체 (id → 연출 시작 시각)
const settledKills = new Set<string>()
const dyingMonsters = new Map<string, number>()

function createMonsters(targetScene: Scene) {
	monsterResources = createMonsterResources(MONSTER_CONFIG)
	monsterAgents.length = 0
	monsterObjects.clear()
	monsterAnimations.clear()
	pendingRespawns.length = 0
	settledKills.clear()
	dyingMonsters.clear()
	pendingPlayerHits = []

	// 每个怪物单独加载 GLB（蒙皮骨骼不能 clone）
	monsterResources.forEach(resource => {
		spawnMonsterVisual(resource, targetScene)
	})
}

// 몬스터 1마리를 씬에 추가: GLB 개별 로드 → 래퍼/애니메이션/AI 에이전트 생성
function spawnMonsterVisual(resource: MonsterResource, targetScene: Scene) {
	const modelUrl = MONSTER_CONFIG.modelUrls[resource.modelIndex]
	new GLTFLoader().load(
		assetURL(modelUrl),
		gltf => {
			if (monsterObjects.has(resource.id)) return

			const wrapper = new Group()
			const model = normalizeModel(gltf.scene, MONSTER_CONFIG.modelScale, false)
			model.rotation.y = resource.rotation
			wrapper.add(model)
			wrapper.position.set(resource.position[0], 0, resource.position[1])
			targetScene.add(wrapper)
			monsterObjects.set(resource.id, wrapper)

			// 创建动画控制器（修复之前的 bug：动画未注册）
			const animController = createMonsterAnimationController(model, gltf.animations)
			monsterAnimations.set(resource.id, animController)

			// 创建怪物 AI，传入种植回调
			monsterAgents.push(createMonsterAgent(resource, (position) => {
				plantTreeAtPosition(position)
			}))
		},
		undefined,
		error => console.error(`몬스터 모델 로드 실패: ${modelUrl}`, error),
	)
}

// 새 날이 밝으면 기한이 된 리스폰을 처리한다. 총 몬스터 수는 설정치를 넘지 않는다 (보스 제외).
function processRespawns() {
	if (!scene) return
	while (pendingRespawns.length > 0
		&& monsterAgents.filter(agent => !agent.resource.isBoss).length < MONSTER_CONFIG.count
	) {
		const task = pendingRespawns[0]
		if (task.dueDay > currentDay.value) break
		pendingRespawns.shift()
		const resource = createRespawnMonster(
			MONSTER_CONFIG,
			`monster-respawn-${respawnSeq++}`,
			task.modelIndex,
			currentDay.value,
		)
		spawnMonsterVisual(resource, scene)
	}
}

// ===== 보스: bossIntervalDays마다 스폰, 상시 추격, 전용 HP바 =====
const activeBossId = ref<string | null>(null)
const bossBar = ref<{ name: string; distance: number; health: number; maxHealth: number; percent: number } | null>(null)

function spawnBoss(dayNumber: number) {
	if (!scene) return
	const resource = createBossMonster(MONSTER_CONFIG, `boss-${dayNumber}`, dayNumber)
	spawnMonsterVisual(resource, scene)
	activeBossId.value = resource.id
	const message = t('hud.log.bossSpawn')
	showToast(message)
	logEvent(message, 'boss')
}

function updateBossBar() {
	const id = activeBossId.value
	if (!id || !playerAgent) {
		bossBar.value = null
		return
	}
	const agent = monsterAgents.find(candidate => candidate.resource.id === id)
	if (!agent || agent.resource.health <= 0) {
		bossBar.value = null
		return
	}
	const distance = Math.round(Math.hypot(
		agent.position[0] - playerAgent.position[0],
		agent.position[1] - playerAgent.position[1],
	))
	bossBar.value = {
		name: agent.resource.modelName,
		distance,
		health: Math.max(0, agent.resource.health),
		maxHealth: agent.resource.maxHealth,
		percent: Math.max(0, Math.round((agent.resource.health / agent.resource.maxHealth) * 100)),
	}
}

// 怪物种植回调：在指定位置创建新树
function plantTreeAtPosition(position: PlanePoint) {
	const newTree = createRandomTree(
		treeResources,
		TREE_RESOURCE_CONFIG.modelUrls.length,
		{
			radiusMeters: TREE_RESOURCE_CONFIG.radiusMeters,
			modelScale: TREE_RESOURCE_CONFIG.modelScale,
			woodPerTree: TREE_RESOURCE_CONFIG.woodPerTree,
			respawnMinSpacing: MONSTER_GUARDIAN_CONFIG.plantTreeRadius,
		},
		position,
	)
	if (!newTree) return

	treeResources.push(newTree)
	spawnTreeVisual(newTree)
}

// 玩家攻击怪物回调：스윙 시점 기록 → 다음 updateMonsters에서 FSM이 피해/사망을 처리한다
function handlePlayerAttack(monsterId: string, damage: number) {
	const agent = monsterAgents.find(candidate => candidate.resource.id === monsterId)
	if (!agent || agent.resource.health <= 0) return
	spawnDamagePopup(agent.position[0], 8, agent.position[1], `-${damage}`, 'damage')
	pendingPlayerHits.push({ id: monsterId, damage })
	// 생명 흡수 스킬: 해준 피해의 일부 회복
	playerAgent?.applyLifeLeech(damage)
}

// 처치 정산: 나무 보상/체력 회복/경험치/리스폰 예약 (몬스터당 정확히 1회)
function settleKill(agent: MonsterAgent) {
	if (settledKills.has(agent.resource.id)) return
	settledKills.add(agent.resource.id)
	monsterKills.value += 1
	dayKills += 1
	// 보스는 고정 보상 (maxHealth 비례 보상은 일반 몬스터 전용 — 보스 체력이 커서 경제가 깨진다)
	const reward = agent.resource.isBoss
		? MONSTER_CONFIG.bossRewardWood
		: Math.max(1, Math.round(agent.resource.maxHealth * 0.3))
	awardWood(reward)
	if (agent.resource.isBoss) {
		logEvent(t('hud.log.bossKill', { count: reward }), 'boss')
		showToast(t('hud.log.bossKill', { count: reward }))
		activeBossId.value = null
	} else {
		logEvent(t('hud.log.kill', { model: agent.resource.modelName, count: reward }), 'kill')
	}
	// 처치 보상으로 체력 회복 + 경험치 (레벨업 시 공격력/체력/속도 증가)
	playerAgent?.applyKillHeal()
	playerAgent?.addExperience(agent.resource.maxHealth)
	// 하루 뒤 같은 티어의 몬스터가 리스폰된다 (보스는 스케줄 스폰 — 리스폰 예약 제외)
	if (!agent.resource.isBoss) {
		pendingRespawns.push({ dueDay: currentDay.value + 1, modelIndex: agent.resource.modelIndex })
	}
}

// 结算 wood 报酬并刷新 HUD + 토스트 알림
function awardWood(amount: number) {
	if (!playerAgent) return
	playerAgent.woodCollected += amount
	woodCount.value = Math.max(0, playerAgent.woodCollected)
	showRewardToast(amount)
	triggerKillPulse()
}

const rewardToasts = ref<{ id: number; text: string }[]>([])
let toastSeq = 0
function showToast(text: string) {
	const id = ++toastSeq
	rewardToasts.value = [...rewardToasts.value, { id, text }]
	setTimeout(() => {
		rewardToasts.value = rewardToasts.value.filter(toast => toast.id !== id)
	}, 1500)
}

function showRewardToast(amount: number) {
	showToast(t('hud.combat.reward', { count: amount }))
}

const killsPulseKey = ref(0)
const killsPulsing = ref(false)
let killsPulseTimer: ReturnType<typeof setTimeout> | null = null
function triggerKillPulse() {
	killsPulseKey.value += 1
	// 펄스는 일시적으로만: 상시 scale(1.18)이면 행이 좌우로 부풀어 다른 줄과 어긋난다
	killsPulsing.value = true
	if (killsPulseTimer) clearTimeout(killsPulseTimer)
	killsPulseTimer = setTimeout(() => {
		killsPulsing.value = false
	}, 700)
}

// ===== 전투 로그 피드: 최근 이벤트를 좌측 하단에 스트리밍 =====
type LogEntry = { id: number; text: string; kind: 'kill' | 'hurt' | 'level' | 'day' | 'boss' | 'skill'; createdAt: number }
const combatLog = ref<LogEntry[]>([])
let logSeq = 0
const LOG_TTL_MS = 7_000
const LOG_MAX_ENTRIES = 6

function logEvent(text: string, kind: LogEntry['kind']) {
	combatLog.value = [...combatLog.value, { id: ++logSeq, text, kind, createdAt: gameNow }]
	if (combatLog.value.length > LOG_MAX_ENTRIES) {
		combatLog.value = combatLog.value.slice(-LOG_MAX_ENTRIES)
	}
}

function pruneCombatLog() {
	if (!combatLog.value.length) return
	combatLog.value = combatLog.value.filter(entry => gameNow - entry.createdAt < LOG_TTL_MS)
}

// ===== 일차 요약: 하루 동안의 성과를 새 날 시작 때 카드로 표시 =====
const daySummary = ref({ visible: false, day: 0, wood: 0, kills: 0, damage: 0 })
let dayWoodGained = 0
let dayKills = 0
let dayDamageTaken = 0
let summaryTimer: ReturnType<typeof setTimeout> | null = null

function showDaySummary() {
	daySummary.value = {
		visible: true,
		day: Math.max(1, currentDay.value - 1),
		wood: dayWoodGained,
		kills: dayKills,
		damage: dayDamageTaken,
	}
	dayWoodGained = 0
	dayKills = 0
	dayDamageTaken = 0
	if (summaryTimer) clearTimeout(summaryTimer)
	summaryTimer = setTimeout(() => {
		daySummary.value = { ...daySummary.value, visible: false }
	}, 4_000)
}

// ===== 최고 기록 =====
const bestRecord = ref<{ days: number; kills: number } | null>(null)
function recordRun() {
	bestRecord.value = saveBestRecord(localStorage, {
		days: Math.max(0, currentDay.value - 1),
		kills: monsterKills.value,
	})
}

// 从场景、动画控制器、Agent 列表中移除死亡怪物并释放资源
function disposeMonster(monsterId: string) {
	const obj = monsterObjects.get(monsterId)
	if (obj) {
		obj.removeFromParent()
		obj.traverse(child => {
			if (child instanceof Mesh) {
				child.geometry?.dispose()
				const materials = Array.isArray(child.material) ? child.material : [child.material]
				materials.forEach(material => {
					for (const value of Object.values(material)) {
						if (value instanceof Texture) value.dispose()
					}
					material.dispose()
				})
			}
		})
		monsterObjects.delete(monsterId)
	}
	monsterAnimations.delete(monsterId)
	const idx = monsterAgents.findIndex(agent => agent.resource.id === monsterId)
	if (idx >= 0) monsterAgents.splice(idx, 1)
}

// 生成树的视觉对象（从 spawnTreeInstances 和 spawnNewTree 中抽取的公共逻辑）
function spawnTreeVisual(tree: TreeResource) {
	const template = liveTreeTemplates.get(tree.modelIndex)
	if (!template || treeObjects.has(tree.id)) return

	const object = new Group()
	const model = template.clone(true)
	model.rotation.y = tree.rotation
	model.scale.multiplyScalar(tree.scale)
	object.add(model)
	object.position.set(tree.position[0], 0, tree.position[1])
	treeObjects.set(tree.id, object)
	treeGroup?.add(object)
}

function createPlayer(targetScene: Scene) {
	const playerRoot = new Group()
	playerRoot.position.set(PLAYER_START[0], 0, PLAYER_START[1])
	targetScene.add(playerRoot)
	playerModel = playerRoot

	playerAgent = createPlayerAgent(PLAYER_START, {
		exploreDistance: PLAYER_CONFIG.walkStepDistanceMeters,
		speed: PLAYER_CONFIG.walkSpeedMetersPerSecond,
		collectRadius: PLAYER_CONFIG.collectTreeRadiusMeters,
		chopDurationMs: PLAYER_CONFIG.chopTreeDurationMs,
		attackRangeMeters: PLAYER_CONFIG.attackRangeMeters,
		attackDamageMs: PLAYER_CONFIG.attackDamageMs,
		attackCooldownMs: PLAYER_CONFIG.attackCooldownMs,
		playerAttackDamage: PLAYER_ATTACK_DAMAGE,
		onAttackMonster: (monsterId, damage) => handlePlayerAttack(monsterId, damage),
		playerMaxHealth: PLAYER_CONFIG.maxHealth,
		killHealHealth: PLAYER_CONFIG.killHealHealth,
		regenHealthAmount: PLAYER_CONFIG.regenHealthAmount,
		regenIntervalMs: PLAYER_CONFIG.regenIntervalMs,
		criticalHealthRatio: PLAYER_CONFIG.criticalHealthRatio,
		playerBasePower: COMBAT_AGGRESSION_CONFIG.playerBasePower,
		powerPerWood: COMBAT_AGGRESSION_CONFIG.powerPerWood,
		monsterHealthPowerWeight: COMBAT_AGGRESSION_CONFIG.monsterHealthPowerWeight,
		monsterAttackPowerWeight: COMBAT_AGGRESSION_CONFIG.monsterAttackPowerWeight,
		huntAggroRangeMultiplier: COMBAT_AGGRESSION_CONFIG.huntAggroRangeMultiplier,
		huntGiveUpRangeMultiplier: COMBAT_AGGRESSION_CONFIG.huntGiveUpRangeMultiplier,
		huntScanRangePerLevel: PROGRESSION_CONFIG.huntScanRangePerLevel,
		slamUnlockLevel: SKILL_CONFIG.slamUnlockLevel,
		slamCooldownMs: SKILL_CONFIG.slamCooldownMs,
		slamRadius: SKILL_CONFIG.slamRadius,
		slamDamageMultiplier: SKILL_CONFIG.slamDamageMultiplier,
		furyUnlockLevel: SKILL_CONFIG.furyUnlockLevel,
		furyCooldownMs: SKILL_CONFIG.furyCooldownMs,
		furyDurationMs: SKILL_CONFIG.furyDurationMs,
		furySwingMultiplier: SKILL_CONFIG.furySwingMultiplier,
		leechUnlockLevel: SKILL_CONFIG.leechUnlockLevel,
		leechRatio: SKILL_CONFIG.leechRatio,
		upgradeCostBase: WEAPON_CONFIG.upgradeCostBase,
		upgradeCostGrowth: WEAPON_CONFIG.upgradeCostGrowth,
		weaponAttackPerTier: WEAPON_CONFIG.attackPerTier,
		weaponPowerPerTier: WEAPON_CONFIG.powerPerTier,
		reserveWood: WEAPON_CONFIG.reserveWood,
		worldRadius: WORLD_RADIUS,
		collisionCheck: pos => checkCollision(pos),
		treeResources: () => treeResources,
		// 살아있는 모든 몬스터를 후보로 노출한다:
		// - hostile=true(chase/attack/hit)인 몬스터만 도망 판정 대상
		// - 나머지(idle/patrol/tendPlants)는 "나보다 약하면" 선제공격 사냥감이 된다
		threatSources: () => monsterAgents
			.filter(agent => agent.resource.health > 0)
			.map(agent => ({
				id: agent.resource.id,
				position: agent.position,
				homePosition: agent.resource.homePosition,
				activityRadius: agent.resource.activityRadius,
				speed: agent.resource.speed,
				attackRadius: MONSTER_CONFIG.attackRadius,
				attackDamage: agent.resource.attackDamage,
				health: agent.resource.health,
				hostile: agent.state === 'chase' || agent.state === 'attack' || agent.state === 'hit',
			})),
	})

	new GLTFLoader().load(
		assetURL(PLAYER_CONFIG.url),
		gltf => {
			if (!playerModel) return

			const model = normalizeModel(gltf.scene, PLAYER_CONFIG.scale, false)
			playerRoot.add(model)
			playerAnimation = createPlayerAnimationController(model, gltf.animations)
		},
		undefined,
		error => {
			console.error('플레이어 모델 로드 실패:', error);
		},
	)
}

function renderFrame() {
	animationFrame = window.requestAnimationFrame(renderFrame)
	if (!clock || !renderer || !scene || !camera || !playerAgent || !playerModel) return

	// Game Over 时冻结游戏但继续渲染
	if (gameOver.value) {
		renderer.render(scene, camera)
		return
	}

	// 배속/일시정지가 적용된 게임 시간 (일시정지 중에도 getDelta는 호출해 누적을 방지한다)
	const rawDelta = clock.getDelta()
	const delta = paused.value ? 0 : rawDelta * gameSpeed.value
	gameNow += delta * 1000
	const now = gameNow

	// 1. 更新昼夜循环
	const dayResult = dayCycle?.update(delta * 1000)
	if (dayResult?.isNewDay) {
		currentDay.value = dayResult.dayNumber
		showDaySummary()
		logEvent(t('hud.log.day', { day: dayResult.dayNumber }), 'day')
		// 주기 보스 스폰
		if (dayResult.dayNumber % MONSTER_CONFIG.bossIntervalDays === 0) {
			spawnBoss(dayResult.dayNumber)
		}
		// 每天扣减木头
		playerAgent.woodCollected -= DAY_CYCLE_CONFIG.woodConsumedPerDay
		if (playerAgent.woodCollected <= 0) {
			playerAgent.playerAlive = false
			playerAlive.value = false
			deathCause.value = 'starvation'
			gameOver.value = true
			recordRun()
		}
	}

	// 更新光照
	if (dayCycle && lightingController) {
		lightingController.update(dayCycle.state.dayProgress, dayCycle.state.timeOfDay)
	}

	// 低木头警告
	lowWoodWarning.value = playerAgent.playerAlive && playerAgent.woodCollected > 0 && playerAgent.woodCollected <= DAY_CYCLE_CONFIG.woodConsumedPerDay * 2

	// 2. 更新玩家
	const prevWood = playerAgent.woodCollected
	const prevAnim = playerAgent.animation
	const prevLevel = playerAgent.level
	const prevWeaponTier = playerAgent.weaponTier
	const prevUpgradeCost = playerAgent.nextUpgradeCost()
	const prevSlamAt = playerAgent.lastSlamAt
	const prevFuryUntil = playerAgent.furyActiveUntil

	playerAgent.update(delta, now)
	syncPlayerVisuals()

	if (playerAgent.woodCollected !== prevWood) {
		woodCount.value = Math.max(0, playerAgent.woodCollected)
		// 일일 성과 집계: 증가분만 가산 (소모/강화는 집계에서 제외)
		if (playerAgent.woodCollected > prevWood) dayWoodGained += playerAgent.woodCollected - prevWood
	}
	// 자동 무기 강화가 일어나면 토스트로 알린다 (나무가 말없이 사라지는 것처럼 보이지 않게)
	if (playerAgent.weaponTier > prevWeaponTier) {
		showToast(t('hud.combat.upgrade', { tier: playerAgent.weaponTier, count: prevUpgradeCost }))
	}
	// 레벨업 로그
	if (playerAgent.level > prevLevel) {
		logEvent(t('hud.log.levelup', { level: playerAgent.level }), 'level')
	}
	// 스킬 시전 로그
	if (playerAgent.lastSlamAt > prevSlamAt) {
		logEvent(t('hud.log.slam'), 'skill')
	}
	if (playerAgent.furyActiveUntil > prevFuryUntil) {
		logEvent(t('hud.log.fury'), 'skill')
	}
	choppingProgress.value = playerAgent.choppingProgress
	attackingProgress.value = playerAgent.attackingProgress
	updatePlayerStatus()
	updateMonsterOverlay()
	updateBossBar()
	pruneCombatLog()
	if (playerAgent.lastCollectedTree) {
		replaceTreeWithDeadModel(playerAgent.lastCollectedTree, now)
		playerAgent.lastCollectedTree = null
	}
	if (playerAgent.animation !== prevAnim && playerAnimation) {
		playerAnimation.play(playerAgent.animation)
	}

	// 3. 更新怪物
	updateMonsters(delta, now)

	// 4. 现有系统
	updateFadingTrees(now)
	playerAnimation?.update(delta)
	updateCamera()
	renderer.render(scene, camera)
	drawMinimap()
	processRespawns()
}

function syncPlayerVisuals() {
	if (!playerAgent || !playerModel) return
	playerModel.position.set(playerAgent.position[0], 0, playerAgent.position[1])
	playerModel.rotation.y = playerAgent.bearing + MathUtils.degToRad(PLAYER_CONFIG.rotationY)
}

function updateMonsters(delta: number, now: number) {
	if (!playerAgent) return

	const monsterContext: MonsterUpdateContext = {
		playerPosition: playerAgent.position,
		playerAlive: playerAgent.playerAlive,
		// 사냥(hunting)/공격(attacking) 중에도 "벌목 중"처럼 취급해 몬스터가 반격한다:
		// 선제공격을 당한 몬스터가 도망치지 않고 되받아치므로 전투가 성립한다.
		playerIsChopping: playerAgent.state === 'chopping'
			|| playerAgent.state === 'attacking'
			|| playerAgent.state === 'hunting',
		playerIsFleeing: playerAgent.state === 'fleeing',
		isNight: dayCycle?.state.isNight ?? false,
		incomingPlayerHits: pendingPlayerHits,
		onAttackPlayer: () => {
			// 몬스터 공격: 나무 대신 체력을 깎는다 (HP 0 = 사망)
			if (!playerAgent) return
			playerAgent.applyDamage(MONSTER_CONFIG.attackDamage)
			dayDamageTaken += MONSTER_CONFIG.attackDamage
			spawnDamagePopup(playerAgent.position[0], 8, playerAgent.position[1], `-${MONSTER_CONFIG.attackDamage}`, 'hurt')
			logEvent(t('hud.log.hurt', { count: MONSTER_CONFIG.attackDamage }), 'hurt')
			if (!playerAgent.playerAlive) {
				deathCause.value = 'slain'
				playerAlive.value = false
				gameOver.value = true
				recordRun()
			}
		},
	}

	// 팩 응집: 피격당한 몬스터와 같은 종족이 근처 있으면 함께 자극받아 추격한다
	for (const hit of pendingPlayerHits) {
		const target = monsterAgents.find(candidate => candidate.resource.id === hit.id)
		if (!target) continue
		for (const ally of monsterAgents) {
			if (ally.resource.modelName !== target.resource.modelName) continue
			const dist = Math.hypot(
				ally.position[0] - target.position[0],
				ally.position[1] - target.position[1],
			)
			if (dist <= MONSTER_CONFIG.packAggroRadius) {
				ally.provokedUntil = now + MONSTER_CONFIG.packAggroDurationMs
			}
		}
	}

	for (const agent of monsterAgents) {
		agent.update(delta, now, monsterContext)
		// FSM 경로의 사망(스윙 피해)도 씬 정산/청소 대상에 포함한다
		if (agent.resource.health <= 0 && !dyingMonsters.has(agent.resource.id)) {
			settleKill(agent)
			dyingMonsters.set(agent.resource.id, now)
		}
		const obj = monsterObjects.get(agent.resource.id)
		const anim = monsterAnimations.get(agent.resource.id)
		if (!obj) continue
		obj.position.set(agent.position[0], 0, agent.position[1])
		obj.rotation.y = agent.bearing
		anim?.play(agent.animation as any)
		anim?.update(delta)
	}
	pendingPlayerHits = []

	// 사망 연출 종료 → 시체 정리 (죽는 애니메이션이 영구 반복되는 문제 방지)
	for (const [monsterId, startedAt] of [...dyingMonsters]) {
		if (now - startedAt >= MONSTER_CONFIG.deathAnimMs) {
			dyingMonsters.delete(monsterId)
			disposeMonster(monsterId)
		}
	}
}

function checkCollision(position: PlanePoint): boolean {
	const treeRadius = 14
	for (const tree of treeResources) {
		if (tree.collected) continue
		if (Math.hypot(position[0] - tree.position[0], position[1] - tree.position[1]) < treeRadius) {
			return true
		}
	}
	for (const obj of environmentObjects) {
		if (Math.hypot(position[0] - obj.position[0], position[1] - obj.position[1]) < ENVIRONMENT_CONFIG.collisionRadius) {
			return true
		}
	}
	return false
}

function replaceTreeWithDeadModel(tree: TreeResource, now: number) {
	const liveObject = treeObjects.get(tree.id)
	const templateIndex = tree.modelIndex % TREE_RESOURCE_CONFIG.deadModelUrls.length
	const deadTemplate = deadTreeTemplates.get(templateIndex)

	liveObject?.removeFromParent()
	treeObjects.delete(tree.id)

	if (!deadTemplate) return

	const deadObject = new Group()
	const model = deadTemplate.clone(true)
	model.rotation.y = tree.rotation
	model.scale.multiplyScalar(tree.scale)
	model.traverse(child => {
		if (child instanceof Mesh) {
			child.material = (child.material as Material).clone()
			child.material.transparent = true
		}
	})
	deadObject.add(model)
	deadObject.position.set(tree.position[0], 0, tree.position[1])
	treeGroup?.add(deadObject)
	fadingTrees.push({ object: deadObject, createdAt: now })
}

function updateFadingTrees(now: number) {
	const { lingerMs, fadeMs } = DEAD_TREE_CONFIG
	const toRemove: number[] = []

	for (let i = 0; i < fadingTrees.length; i++) {
		const elapsed = now - fadingTrees[i].createdAt
		if (elapsed < lingerMs) continue

		if (elapsed < lingerMs + fadeMs) {
			const progress = (elapsed - lingerMs) / fadeMs
			fadingTrees[i].object.traverse(child => {
				if (child instanceof Mesh) {
					child.material.opacity = 1 - progress
				}
			})
			continue
		}

		fadingTrees[i].object.removeFromParent()
		fadingTrees[i].object.traverse(child => {
			if (child instanceof Mesh) {
				child.geometry?.dispose()
				const mats = Array.isArray(child.material) ? child.material : [child.material]
				mats.forEach(m => {
					for (const v of Object.values(m)) {
						if (v instanceof Texture) v.dispose()
					}
					m.dispose()
				})
			}
		})
		toRemove.push(i)
		spawnNewTree()
	}

	for (let i = toRemove.length - 1; i >= 0; i--) {
		fadingTrees.splice(toRemove[i], 1)
	}
}

function spawnNewTree() {
	const newTree = createRandomTree(treeResources, TREE_RESOURCE_CONFIG.modelUrls.length, {
		radiusMeters: TREE_RESOURCE_CONFIG.radiusMeters,
		modelScale: TREE_RESOURCE_CONFIG.modelScale,
		woodPerTree: TREE_RESOURCE_CONFIG.woodPerTree,
		respawnMinSpacing: DEAD_TREE_CONFIG.respawnMinSpacing,
	})
	if (!newTree) return

	treeResources.push(newTree)
	spawnTreeVisual(newTree)
}

function updateCamera() {
	if (!camera || !playerModel || !orbitControls) return

	if (cameraMode.value === 'follow') {
		orbitControls.enabled = false
		const target = playerModel.position
		camera.position.lerp(
			new Vector3(target.x + CAMERA_OFFSET.x, target.y + CAMERA_OFFSET.y, target.z + CAMERA_OFFSET.z),
			0.08,
		)
		camera.lookAt(target.x, target.y + 45, target.z)
	} else {
		orbitControls.enabled = true
		orbitControls.update()
	}
}

function toggleCameraMode() {
	if (!orbitControls || !camera || !playerModel) return

	if (cameraMode.value === 'follow') {
		cameraMode.value = 'free'
		orbitControls.target.set(
			playerModel.position.x,
			0,
			playerModel.position.z,
		)
		orbitControls.enabled = true
	} else {
		cameraMode.value = 'follow'
		orbitControls.enabled = false
	}
}

function drawMinimap() {
	const canvas = minimapCanvas.value
	if (!canvas || !playerAgent) return
	const ctx = canvas.getContext('2d')
	if (!ctx) return

	const size = canvas.width
	const scale = size / (WORLD_RADIUS * 2.4)
	const cx = size / 2
	const cy = size / 2

	// 坐标映射：世界 (x, z) → canvas
	const toX = (wx: number) => cx + wx * scale
	const toY = (wz: number) => cy + wz * scale

	ctx.clearRect(0, 0, size, size)

	// 世界背景（夜晚变暗）
	const bgAlpha = dayCycle?.state.isNight ? 0.92 : 0.85
	ctx.beginPath()
	ctx.arc(cx, cy, WORLD_RADIUS * scale, 0, Math.PI * 2)
	ctx.fillStyle = `rgba(12, 40, 31, ${bgAlpha})`
	ctx.fill()

	// 世界边界
	ctx.beginPath()
	ctx.arc(cx, cy, WORLD_RADIUS * scale, 0, Math.PI * 2)
	ctx.strokeStyle = 'rgba(53, 244, 255, 0.2)'
	ctx.lineWidth = 2
	ctx.stroke()

	// 环境物（淡色小点）
	ctx.fillStyle = 'rgba(60, 140, 80, 0.35)'
	for (const obj of environmentObjects) {
		ctx.beginPath()
		ctx.arc(toX(obj.position[0]), toY(obj.position[1]), 1.5, 0, Math.PI * 2)
		ctx.fill()
	}

	// 树木
	for (const tree of treeResources) {
		if (tree.collected) continue
		ctx.fillStyle = '#2ecc71'
		ctx.beginPath()
		ctx.arc(toX(tree.position[0]), toY(tree.position[1]), 3, 0, Math.PI * 2)
		ctx.fill()
	}

	// 怪物：看管者模式，用橙色显示
	for (const agent of monsterAgents) {
		if (agent.resource.health <= 0) continue
		// 보스는 핑크 마커로 위치를 항상 추적 가능하게
		if (agent.resource.isBoss) {
			ctx.fillStyle = '#ff6bd6'
			ctx.beginPath()
			ctx.arc(toX(agent.position[0]), toY(agent.position[1]), 5, 0, Math.PI * 2)
			ctx.fill()
			ctx.strokeStyle = '#ffffff'
			ctx.lineWidth = 1.5
			ctx.stroke()
			continue
		}
		// 种植中的怪物用绿色，其他用橙色
		ctx.fillStyle = agent.state === 'tendPlants' ? '#2ecc71' : '#ff8c00'
		ctx.beginPath()
		ctx.arc(toX(agent.position[0]), toY(agent.position[1]), 3, 0, Math.PI * 2)
		ctx.fill()
	}

	// 玩家位置 + 朝向
	const px = toX(playerAgent.position[0])
	const py = toY(playerAgent.position[1])
	const arrowLen = 10
	const angle = -playerAgent.bearing + Math.PI / 2 // 调整朝向角度映射

	ctx.fillStyle = '#35f4ff'
	ctx.beginPath()
	ctx.arc(px, py, 5, 0, Math.PI * 2)
	ctx.fill()

	ctx.strokeStyle = '#35f4ff'
	ctx.lineWidth = 2
	ctx.beginPath()
	ctx.moveTo(px, py)
	ctx.lineTo(px + Math.cos(angle) * arrowLen, py + Math.sin(angle) * arrowLen)
	ctx.stroke()

	// 自由模式下显示摄像头方向
	if (cameraMode.value === 'free' && camera) {
		const camDir = new Vector3()
		camera.getWorldDirection(camDir)
		const camX = toX(camera.position.x)
		const camY = toY(camera.position.z)
		ctx.strokeStyle = 'rgba(255, 200, 87, 0.7)'
		ctx.lineWidth = 2
		ctx.beginPath()
		ctx.moveTo(camX, camY)
		ctx.lineTo(camX + camDir.x * 20, camY + camDir.z * 20)
		ctx.stroke()
	}
}

function normalizeModel(model: Object3D, targetScale: number = 1, shouldClone: boolean = true) {
	const normalizedModel = shouldClone ? cloneSkinned(model) : model
	const bounds = new Box3().setFromObject(normalizedModel)
	const size = bounds.getSize(new Vector3())
	const center = bounds.getCenter(new Vector3())
	const maxSize = Math.max(size.x, size.y, size.z) || 1

	normalizedModel.position.sub(center)
	normalizedModel.scale.setScalar(targetScale / maxSize)
	normalizedModel.traverse(object => {
		object.frustumCulled = false
		if (object instanceof Mesh) {
			object.castShadow = true
			object.receiveShadow = true
		}
	})

	const normalizedBounds = new Box3().setFromObject(normalizedModel)
	normalizedModel.position.y -= normalizedBounds.min.y
	return normalizedModel
}

function handleResize() {
	if (!sceneContainer.value || !camera || !renderer) return

	const { clientWidth, clientHeight } = sceneContainer.value
	camera.aspect = clientWidth / clientHeight
	camera.updateProjectionMatrix()
	renderer.setSize(clientWidth, clientHeight)
}

function restartGame() {
	disposeScene()

	// 重置游戏状态
	currentDay.value = 1
	playerAlive.value = true
	gameOver.value = false
	deathCause.value = 'starvation'
	lowWoodWarning.value = false
	bestRecord.value = loadBestRecord(localStorage)

	createScene()
}

function disposeScene() {
	if (animationFrame) {
		window.cancelAnimationFrame(animationFrame)
	}
	window.removeEventListener('resize', handleResize)

	orbitControls?.dispose()
	orbitControls = null

	if (scene) {
		scene.traverse(object => {
			if (object instanceof Mesh) {
				object.geometry?.dispose()
				const materials = Array.isArray(object.material)
					? object.material
					: [object.material]
				materials.forEach(material => {
					for (const value of Object.values(material)) {
						if (value instanceof Texture) value.dispose()
					}
					material.dispose()
				})
			}
		})
		scene.clear()
	}

	playerAgent = null
	playerAnimation = null
	playerModel = null
	renderer?.dispose()
	renderer?.domElement.remove()
	animationFrame = 0
	camera = null
	clock = null
	renderer = null
	scene = null
	treeGroup = null
	treeResources = []
	environmentObjects = []
	monsterResources = []
	monsterAgents.length = 0
	monsterObjects.clear()
	monsterAnimations.clear()
	pendingRespawns.length = 0
	settledKills.clear()
	dyingMonsters.clear()
	pendingPlayerHits = []
	monsterBars.value = []
	damagePopups.value = []
	fadingTrees.length = 0
	deadTreeTemplates.clear()
	liveTreeTemplates.clear()
	treeObjects.clear()
	envTemplates.clear()
	dayCycle = null
	lightingController = null
	hemisphereLight = null
	ambientLight = null
	keyLight = null
	rimLight = null
}
</script>

<style lang="scss" scoped>
.game-stage {
	position: relative;
	width: 100vw;
	height: 100vh;
	overflow: hidden;
	background: #87c6ef;
}

// 몬스터 HP바 + 데미지 팝업 오버레이 (월드 → 화면 투영)
.monster-overlay {
	position: absolute;
	inset: 0;
	z-index: 5;
	overflow: hidden;
	pointer-events: none;
}

.monster-hpbar {
	position: absolute;
	width: 44px;
	height: 5px;
	margin-left: -22px;
	margin-top: -12px;
	border-radius: 999px;
	background: rgba(3, 12, 24, 0.75);
	box-shadow: 0 0 6px rgba(0, 0, 0, 0.5);
}

.monster-hpbar__fill {
	height: 100%;
	border-radius: inherit;
	background: linear-gradient(90deg, #ff4444, #ff8c00);
}

.damage-popup {
	position: absolute;
	margin-left: -14px;
	color: #ffd166;
	font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	font-size: 14px;
	font-weight: 800;
	text-shadow: 0 0 8px rgba(0, 0, 0, 0.8), 0 2px 4px rgba(0, 0, 0, 0.6);
	animation: damage-popup-rise 0.9s ease-out forwards;
}

.damage-popup--hurt {
	color: #ff6b6b;
}

@keyframes damage-popup-rise {
	0% {
		opacity: 0;
		transform: translateY(0) scale(0.85);
	}
	15% {
		opacity: 1;
		transform: translateY(-6px) scale(1.05);
	}
	100% {
		opacity: 0;
		transform: translateY(-34px) scale(1);
	}
}

.scene-container {
	position: absolute;
	inset: 0;
}

.scene-container :deep(canvas) {
	display: block;
	width: 100%;
	height: 100%;
}

.language-switcher {
	position: absolute;
	top: 20px;
	left: 50%;
	z-index: 12;
	display: flex;
	padding: 3px;
	border: 1px solid rgba(53, 244, 255, 0.32);
	border-radius: 6px;
	background: rgba(3, 12, 24, 0.78);
	transform: translateX(-50%);
	backdrop-filter: blur(12px);

	button {
		min-height: 30px;
		padding: 0 10px;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: rgba(223, 252, 255, 0.72);
		cursor: pointer;
		font: 600 12px/1 ui-sans-serif, system-ui, sans-serif;

		&.active {
			background: #35f4ff;
			color: #031018;
		}
	}
}

.resource-panel {
	position: absolute;
	top: 20px;
	right: 20px;
	z-index: 2;
	min-width: 132px;
	padding: 14px 16px;
	border: 1px solid rgba(53, 244, 255, 0.38);
	border-radius: 16px;
	background: rgba(3, 12, 24, 0.72);
	box-shadow: 0 12px 30px rgba(0, 0, 0, 0.32), inset 0 0 24px rgba(53, 244, 255, 0.08);
	color: #dffcff;
	font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	backdrop-filter: blur(12px);
}

.resource-panel__day {
	font-size: 16px;
	font-weight: 700;
	color: #ffc857;
	margin-bottom: 8px;
	text-shadow: 0 0 12px rgba(255, 200, 87, 0.4);
}

.resource-panel__label,
.resource-panel__hint {
	font-size: 12px;
	letter-spacing: 0.08em;
	opacity: 0.72;
}

.resource-panel__value {
	margin-top: 4px;
	font-size: 32px;
	font-weight: 800;
	line-height: 1;
	color: #35f4ff;
	text-shadow: 0 0 18px rgba(53, 244, 255, 0.45);
}

.resource-panel__consumption {
	font-size: 11px;
	opacity: 0.55;
	margin-top: 4px;
	letter-spacing: 0.02em;
}

.resource-panel__hint {
	margin-top: 8px;
	letter-spacing: 0.02em;
}

.resource-panel__warning {
	margin-top: 6px;
	font-size: 12px;
	font-weight: 700;
	color: #ff4444;
	animation: warning-pulse 1s ease-in-out infinite;
}

.resource-panel__kills {
	margin-top: 8px;
	font-size: 12px;
	letter-spacing: 0.08em;
	opacity: 0.72;
	color: #ff8c00;
	display: flex;
	align-items: center;
	gap: 6px;
	transition: color 0.18s ease-out, text-shadow 0.18s ease-out;
}

.resource-panel__kills--pulse {
	transform-origin: left center;
	animation: kills-pulse 0.7s ease-out;
}

@keyframes kills-pulse {
	0% {
		transform: scale(1);
		color: #ff8c00;
		text-shadow: none;
	}
	35% {
		transform: scale(1.18);
		color: #ffd166;
		text-shadow: 0 0 12px rgba(255, 209, 102, 0.75);
	}
	100% {
		transform: scale(1);
		color: #ff8c00;
		text-shadow: none;
	}
}

.resource-panel__kills-label {
	display: inline-block;
}

.resource-panel__combat-dot {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: #ff4d4d;
	box-shadow: 0 0 8px rgba(255, 77, 77, 0.85);
	animation: combat-dot-pulse 0.8s ease-in-out infinite;
}

.reward-toast-stack {
	position: absolute;
	top: 90px;
	left: 50%;
	z-index: 6;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 6px;
	pointer-events: none;
	transform: translateX(-50%);
}

.reward-toast {
	padding: 8px 16px;
	border-radius: 999px;
	background: rgba(255, 209, 102, 0.95);
	color: #1a1a1a;
	font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	font-size: 14px;
	font-weight: 700;
	letter-spacing: 0.02em;
	box-shadow: 0 8px 22px rgba(0, 0, 0, 0.35);
	animation: reward-toast-rise 1.5s ease-out forwards;
}

@keyframes reward-toast-rise {
	0% {
		opacity: 0;
		transform: translateY(12px) scale(0.92);
	}
	15% {
		opacity: 1;
		transform: translateY(0) scale(1.05);
	}
	35% {
		opacity: 1;
		transform: translateY(0) scale(1);
	}
	100% {
		opacity: 0;
		transform: translateY(-18px) scale(1);
	}
}

@keyframes combat-dot-pulse {
	0%, 100% {
		transform: scale(1);
		opacity: 1;
	}
	50% {
		transform: scale(1.4);
		opacity: 0.55;
	}
}

.resource-panel__progress {
	width: 100%;
	height: 6px;
	margin-top: 10px;
	overflow: hidden;
	border-radius: 999px;
	background: rgba(255, 255, 255, 0.14);
}

.resource-panel__progress-bar {
	height: 100%;
	border-radius: inherit;
	background: linear-gradient(90deg, #ffc857, #35f4ff);
	box-shadow: 0 0 12px rgba(53, 244, 255, 0.5);
	transition: width 0.12s linear;
}

.minimap-wrapper {
	position: absolute;
	top: 20px;
	left: 20px;
	z-index: 2;
	width: 180px;
	height: 180px;
	border-radius: 50%;
	overflow: hidden;
	border: 2px solid rgba(53, 244, 255, 0.38);
	box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4), inset 0 0 16px rgba(53, 244, 255, 0.08);
	background: rgba(3, 12, 24, 0.72);
	backdrop-filter: blur(12px);
}

.minimap-canvas {
	display: block;
	width: 100%;
	height: 100%;
}

.player-status {
	position: absolute;
	/* 미니맵(20px + 180px = 200px) 아래 32px 간격 */
	top: 232px;
	left: 20px;
	z-index: 2;
	width: 180px;
	padding: 10px 12px;
	border: 1px solid rgba(53, 244, 255, 0.38);
	border-radius: 12px;
	background: rgba(3, 12, 24, 0.72);
	box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4), inset 0 0 16px rgba(53, 244, 255, 0.08);
	color: #dffcff;
	font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	backdrop-filter: blur(12px);
}

.player-status__title {
	margin-bottom: 6px;
	font-size: 12px;
	font-weight: 700;
	letter-spacing: 0.06em;
	color: #ffc857;
	text-shadow: 0 0 12px rgba(255, 200, 87, 0.4);
}

.player-status__row {
	display: flex;
	gap: 8px;
	align-items: baseline;
	justify-content: space-between;
	font-size: 11px;
	line-height: 1.55;
}

.player-status__label {
	white-space: nowrap;
	letter-spacing: 0.04em;
	opacity: 0.6;
}

.player-status__value {
	font-weight: 600;
	text-align: right;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.player-status__value--fleeing {
	color: #ff6b6b;
}

.player-status__value--low {
	color: #ff6b6b;
}

.player-status__bar {
	height: 6px;
	margin-top: 4px;
	overflow: hidden;
	border-radius: 999px;
	background: rgba(255, 255, 255, 0.14);
}

.player-status__bar-fill {
	height: 100%;
	border-radius: inherit;
	background: linear-gradient(90deg, #ff8c00, #ffd166);
	box-shadow: 0 0 12px rgba(255, 200, 87, 0.5);
	transition: width 0.15s linear;
}

.player-status__bar-fill--low {
	background: linear-gradient(90deg, #ff4444, #ff6b6b);
	box-shadow: 0 0 12px rgba(255, 68, 68, 0.6);
	animation: warning-pulse 1s ease-in-out infinite;
}

.player-status__value--hunting,
.player-status__value--attacking {
	color: #ffd166;
}

.player-status__row--hint {
	justify-content: flex-start;
	font-size: 10px;
	opacity: 0.55;
}

.player-status__line {
	font-size: 10px;
	line-height: 1.5;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	opacity: 0.85;
}

.player-status__line--threat {
	color: #ff8c87;
}

.player-status__line--prey {
	color: #7dffa8;
}

.minimap-toggle {
	position: absolute;
	top: 166px;
	left: 166px;
	z-index: 10;
	width: 28px;
	height: 28px;
	padding: 0;
	border: 1px solid rgba(53, 244, 255, 0.3);
	border-radius: 50%;
	background: rgba(3, 12, 24, 0.8);
	color: #35f4ff;
	cursor: pointer;
	font-size: 14px;
	line-height: 28px;
	text-align: center;
	transition: background 0.2s;

	&:hover {
		background: rgba(53, 244, 255, 0.15);
	}
}

.game-over-overlay {
	position: absolute;
	inset: 0;
	z-index: 100;
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(0, 0, 0, 0.75);
	backdrop-filter: blur(8px);
	animation: fade-in 0.8s ease-out;
}

.game-over-content {
	text-align: center;
	color: #dffcff;
	font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;

	h2 {
		font-size: 48px;
		font-weight: 800;
		margin: 0 0 16px;
		color: #ff4444;
		text-shadow: 0 0 30px rgba(255, 68, 68, 0.5);
	}

	p {
		font-size: 18px;
		margin: 8px 0;
		opacity: 0.8;
	}
}

.game-over-btn {
	margin-top: 24px;
	padding: 12px 32px;
	border: 1px solid rgba(53, 244, 255, 0.5);
	border-radius: 12px;
	background: rgba(53, 244, 255, 0.15);
	color: #35f4ff;
	font-size: 18px;
	font-weight: 600;
	cursor: pointer;
	transition: all 0.2s;
	font-family: inherit;

	&:hover {
		background: rgba(53, 244, 255, 0.3);
		box-shadow: 0 0 20px rgba(53, 244, 255, 0.3);
	}
}

// 보스 상단 HP바
.boss-bar {
	position: absolute;
	top: 64px;
	left: 50%;
	z-index: 8;
	width: min(420px, 60vw);
	transform: translateX(-50%);
	text-align: center;
	pointer-events: none;
}

.boss-bar__name {
	margin-bottom: 4px;
	color: #ff6bd6;
	font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	font-size: 13px;
	font-weight: 800;
	letter-spacing: 0.2em;
	text-shadow: 0 0 12px rgba(255, 107, 214, 0.6);
}

.boss-bar__track {
	height: 10px;
	overflow: hidden;
	border: 1px solid rgba(255, 107, 214, 0.55);
	border-radius: 999px;
	background: rgba(3, 12, 24, 0.8);
}

.boss-bar__fill {
	height: 100%;
	border-radius: inherit;
	background: linear-gradient(90deg, #ff4444, #ff6bd6);
	box-shadow: 0 0 14px rgba(255, 107, 214, 0.6);
	transition: width 0.15s linear;
}

.boss-bar__hp {
	margin-top: 3px;
	font-size: 11px;
	font-weight: 700;
	color: #ffdff5;
	opacity: 0.9;
	text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
}

.game-controls {
	position: absolute;
	right: 20px;
	bottom: 20px;
	z-index: 10;
	display: flex;
	gap: 6px;
}

.game-controls__btn {
	min-width: 40px;
	padding: 6px 10px;
	border: 1px solid rgba(53, 244, 255, 0.38);
	border-radius: 8px;
	background: rgba(3, 12, 24, 0.72);
	color: #dffcff;
	cursor: pointer;
	font: 700 12px/1.4 ui-sans-serif, system-ui, sans-serif;
	backdrop-filter: blur(12px);

	&--active {
		background: #35f4ff;
		color: #031018;
	}

	&:hover {
		background: rgba(53, 244, 255, 0.15);
	}

	&--active:hover {
		background: #35f4ff;
	}
}

.combat-log {
	position: absolute;
	left: 20px;
	bottom: 20px;
	z-index: 5;
	display: flex;
	flex-direction: column;
	gap: 3px;
	max-width: 320px;
	pointer-events: none;
}

.combat-log__entry {
	padding: 3px 10px;
	border-radius: 6px;
	background: rgba(3, 12, 24, 0.6);
	color: #dffcff;
	font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	font-size: 11px;
	line-height: 1.5;
	animation: log-entry-in 0.2s ease-out;
}

.combat-log__entry--kill {
	color: #ffd166;
}

.combat-log__entry--hurt {
	color: #ff8c87;
}

.combat-log__entry--level {
	color: #7dffa8;
	font-weight: 700;
}

.combat-log__entry--skill {
	color: #6bb8ff;
	font-weight: 700;
}

.combat-log__entry--boss {
	color: #ff6bd6;
	font-weight: 700;
}

@keyframes log-entry-in {
	from {
		opacity: 0;
		transform: translateX(-8px);
	}
	to {
		opacity: 1;
		transform: translateX(0);
	}
}

.day-summary {
	position: absolute;
	top: 64px;
	left: 50%;
	z-index: 8;
	padding: 12px 24px;
	border: 1px solid rgba(255, 200, 87, 0.5);
	border-radius: 12px;
	background: rgba(3, 12, 24, 0.82);
	text-align: center;
	transform: translateX(-50%);
	backdrop-filter: blur(12px);
	animation: summary-in 0.3s ease-out;
}

.day-summary__title {
	font-size: 14px;
	font-weight: 800;
	letter-spacing: 0.08em;
	color: #ffc857;
}

.day-summary__text {
	margin-top: 4px;
	font-size: 12px;
	color: #dffcff;
	opacity: 0.85;
}

@keyframes summary-in {
	from {
		opacity: 0;
		transform: translateX(-50%) translateY(-8px);
	}
	to {
		opacity: 1;
		transform: translateX(-50%) translateY(0);
	}
}

.game-over-best {
	color: #ffc857 !important;
	font-weight: 700;
}

@media (max-width: 600px) {
	.language-switcher {
		top: auto;
		bottom: calc(env(safe-area-inset-bottom, 0px) + 16px);
	}
}

@keyframes warning-pulse {
	0%, 100% { opacity: 1; }
	50% { opacity: 0.4; }
}

@keyframes fade-in {
	from { opacity: 0; }
	to { opacity: 1; }
}
</style>

<style lang="scss">
html,
body,
#app {
	width: 100%;
	height: 100%;
	margin: 0;
}

body {
	overflow: hidden;
}
</style>
