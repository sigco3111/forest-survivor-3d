<template>
	<div class="game-stage">
		<div ref="sceneContainer" class="scene-container"></div>
		<div class="resource-panel">
			<div class="resource-panel__day">第 {{ currentDay }} 天</div>
			<div class="resource-panel__label">木材</div>
			<div class="resource-panel__value">{{ woodCount }}</div>
			<div class="resource-panel__consumption">每日消耗 -{{ woodPerDay }} 木材</div>
			<div class="resource-panel__hint">{{ choppingHint }}</div>
			<div v-if="lowWoodWarning" class="resource-panel__warning">⚠ 木材不足！</div>
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
		<button class="minimap-toggle" @click="toggleCameraMode" :title="cameraMode === 'follow' ? '切换自由视角' : '切换跟随视角'">
			{{ cameraMode === 'follow' ? '🔒' : '🔓' }}
		</button>
		<div v-if="gameOver" class="game-over-overlay">
			<div class="game-over-content">
				<h2>游戏结束</h2>
				<p>你存活了 {{ currentDay - 1 }} 天</p>
				<p>木材耗尽，你在寒夜中倒下</p>
				<button class="game-over-btn" @click="restartGame">重新开始</button>
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

import {
	DEAD_TREE_CONFIG,
	DAY_CYCLE_CONFIG,
	ENVIRONMENT_CONFIG,
	MONSTER_CONFIG,
	MONSTER_GUARDIAN_CONFIG,
	PLAYER_CONFIG,
	TREE_RESOURCE_CONFIG,
} from '~/config'
import {
	createPlayerAnimationController,
	type PlayerAnimationController,
} from '~/game/player/animations'
import {
	createPlayerAgent,
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
const assetURL = (path: string) => `${appBaseURL}${path.replace(/^\/+/, '')}`

const sceneContainer = ref<HTMLDivElement | null>(null)
const minimapCanvas = ref<HTMLCanvasElement | null>(null)
const choppingProgress = ref(0)
const woodCount = ref(0)
const currentDay = ref(1)
const playerAlive = ref(true)
const gameOver = ref(false)
const lowWoodWarning = ref(false)
const woodPerDay = DAY_CYCLE_CONFIG.woodConsumedPerDay
const cameraMode = ref<'follow' | 'free'>('follow')
const choppingHint = computed(() => {
	if (gameOver.value) return '游戏结束'
	if (choppingProgress.value > 0) {
		return `伐木中 ${Math.round(choppingProgress.value * 100)}%`
	}

	return '靠近树木开始伐木'
})

let animationFrame = 0
let clock: Clock | null = null
let camera: PerspectiveCamera | null = null
let orbitControls: OrbitControls | null = null
let playerAgent: PlayerAgent | null = null
let playerAnimation: PlayerAnimationController | null = null
let playerModel: Object3D | null = null
let renderer: WebGLRenderer | null = null
let scene: Scene | null = null
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
			error => console.error(`树模型加载失败：${modelUrl}`, error),
		)
	})

	TREE_RESOURCE_CONFIG.deadModelUrls.forEach((modelUrl, modelIndex) => {
		new GLTFLoader().load(
			assetURL(modelUrl),
			gltf => {
				deadTreeTemplates.set(modelIndex, normalizeModel(gltf.scene))
			},
			undefined,
			error => console.error(`枯树模型加载失败：${modelUrl}`, error),
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
			error => console.error(`环境模型加载失败：${url}`, error),
		)
	})
}

function createMonsters(targetScene: Scene) {
	monsterResources = createMonsterResources(MONSTER_CONFIG)
	monsterAgents.length = 0
	monsterObjects.clear()
	monsterAnimations.clear()

	// 每个怪物单独加载 GLB（蒙皮骨骼不能 clone）
	monsterResources.forEach(m => {
		const modelUrl = MONSTER_CONFIG.modelUrls[m.modelIndex]
		new GLTFLoader().load(
			assetURL(modelUrl),
			gltf => {
				if (monsterObjects.has(m.id)) return

				const wrapper = new Group()
				const model = normalizeModel(gltf.scene, MONSTER_CONFIG.modelScale, false)
				model.rotation.y = m.rotation
				wrapper.add(model)
				wrapper.position.set(m.position[0], 0, m.position[1])
				targetScene.add(wrapper)
				monsterObjects.set(m.id, wrapper)

				// 创建动画控制器（修复之前的 bug：动画未注册）
				const animController = createMonsterAnimationController(model, gltf.animations)
				monsterAnimations.set(m.id, animController)

				// 创建怪物 AI，传入种植回调
				monsterAgents.push(createMonsterAgent(m, (position) => {
					plantTreeAtPosition(position)
				}))
			},
			undefined,
			error => console.error(`怪物模型加载失败：${modelUrl}`, error),
		)
	})
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
		worldRadius: WORLD_RADIUS,
		collisionCheck: pos => checkCollision(pos),
		treeResources: () => treeResources,
		threatSources: () => monsterAgents
			.filter(agent => agent.state === 'chase' || agent.state === 'attack')
			.map(agent => ({
				position: agent.position,
				homePosition: agent.resource.homePosition,
				activityRadius: agent.resource.activityRadius,
				speed: agent.resource.speed,
				attackRadius: MONSTER_CONFIG.attackRadius,
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
			console.error('玩家模型加载失败:', error)
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

	const delta = clock.getDelta()
	const now = performance.now()

	// 1. 更新昼夜循环
	const dayResult = dayCycle?.update(delta * 1000)
	if (dayResult?.isNewDay) {
		currentDay.value = dayResult.dayNumber
		// 每天扣减木头
		playerAgent.woodCollected -= DAY_CYCLE_CONFIG.woodConsumedPerDay
		if (playerAgent.woodCollected <= 0) {
			playerAgent.playerAlive = false
			playerAlive.value = false
			gameOver.value = true
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

	playerAgent.update(delta, now)
	syncPlayerVisuals()

	if (playerAgent.woodCollected !== prevWood) {
		woodCount.value = Math.max(0, playerAgent.woodCollected)
	}
	choppingProgress.value = playerAgent.choppingProgress
	if (playerAgent.lastCollectedTree) {
		replaceTreeWithDeadModel(playerAgent.lastCollectedTree)
		playerAgent.lastCollectedTree = null
	}
	if (playerAgent.animation !== prevAnim && playerAnimation) {
		playerAnimation.play(playerAgent.animation)
	}

	// 3. 更新怪物
	updateMonsters(delta, now)

	// 4. 现有系统
	updateFadingTrees()
	playerAnimation?.update(delta)
	updateCamera()
	renderer.render(scene, camera)
	drawMinimap()
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
		playerIsChopping: playerAgent.state === 'chopping',
		playerIsFleeing: playerAgent.state === 'fleeing',
		onAttackPlayer: () => {
			// 怪物攻击：偷走玩家的木头
			if (!playerAgent) return
			playerAgent.woodCollected -= MONSTER_CONFIG.attackDamage
			woodCount.value = Math.max(0, playerAgent.woodCollected)
			if (playerAgent.woodCollected <= 0) {
				playerAgent.playerAlive = false
				playerAlive.value = false
				gameOver.value = true
			}
		},
	}

	for (const agent of monsterAgents) {
		agent.update(delta, now, monsterContext)
		const obj = monsterObjects.get(agent.resource.id)
		const anim = monsterAnimations.get(agent.resource.id)
		if (!obj) continue
		obj.position.set(agent.position[0], 0, agent.position[1])
		obj.rotation.y = agent.bearing
		anim?.play(agent.animation as any)
		anim?.update(delta)
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

function replaceTreeWithDeadModel(tree: TreeResource) {
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
	fadingTrees.push({ object: deadObject, createdAt: performance.now() })
}

function updateFadingTrees() {
	const now = performance.now()
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
	lowWoodWarning.value = false

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

.scene-container {
	position: absolute;
	inset: 0;
}

.scene-container :deep(canvas) {
	display: block;
	width: 100%;
	height: 100%;
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
