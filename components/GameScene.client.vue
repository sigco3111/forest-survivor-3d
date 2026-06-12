<template>
	<div class="game-stage">
		<div ref="sceneContainer" class="scene-container"></div>
		<div class="resource-panel">
			<div class="resource-panel__label">木材</div>
			<div class="resource-panel__value">{{ woodCount }}</div>
			<div class="resource-panel__hint">{{ choppingHint }}</div>
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
	ENVIRONMENT_CONFIG,
	MONSTER_CONFIG,
	PLAYER_CONFIG,
	TREE_RESOURCE_CONFIG,
} from '../src/config'
import {
	createPlayerAnimationController,
	type PlayerAnimationController,
} from '../src/game/player/animations'
import {
	createPlayerAgent,
	type PlayerAgent,
} from '../src/game/player/agent'
import {
	createEnvironmentObjects,
	type EnvironmentObject,
} from '../src/game/resources/environment'
import {
	createNoiseTrees,
	createRandomTree,
	type PlanePoint,
	type TreeResource,
} from '../src/game/resources/trees'
import {
	createMonsterAgent,
	createMonsterResources,
	type MonsterAgent,
	type MonsterResource,
} from '../src/game/resources/monsters'

defineOptions({
	name: 'GameScene',
})

const sceneContainer = ref<HTMLDivElement | null>(null)
const minimapCanvas = ref<HTMLCanvasElement | null>(null)
const choppingProgress = ref(0)
const woodCount = ref(0)
const cameraMode = ref<'follow' | 'free'>('follow')
const choppingHint = computed(() => {
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

	addEnvironment(scene)
	createTrees(scene)
	createEnvObjects(scene)
	createMonsters(scene)
	createPlayer(scene)
	window.addEventListener('resize', handleResize)
	animationFrame = window.requestAnimationFrame(renderFrame)
}

function addEnvironment(targetScene: Scene) {
	new TextureLoader().load('/sky/sky.jpg', texture => {
		targetScene.background = texture
	})

	const hemisphereLight = new HemisphereLight('#c9fbff', '#193023', 1.9)
	const ambientLight = new AmbientLight('#ffffff', 0.55)
	const keyLight = new DirectionalLight('#fff4dc', 4.6)
	keyLight.position.set(-280, 520, 260)
	keyLight.castShadow = true
	keyLight.shadow.mapSize.set(2048, 2048)
	keyLight.shadow.camera.near = 20
	keyLight.shadow.camera.far = 1400
	keyLight.shadow.camera.left = -900
	keyLight.shadow.camera.right = 900
	keyLight.shadow.camera.top = 900
	keyLight.shadow.camera.bottom = -900
	const rimLight = new DirectionalLight('#35f4ff', 1.1)
	rimLight.position.set(320, 280, -420)

	targetScene.add(hemisphereLight, ambientLight, keyLight, keyLight.target, rimLight)

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
			modelUrl,
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
			modelUrl,
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
			url,
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

	// 每个怪物单独加载 GLB（蒙皮骨骼不能 clone）
	monsterResources.forEach(m => {
		const modelUrl = MONSTER_CONFIG.modelUrls[m.modelIndex]
		new GLTFLoader().load(
			modelUrl,
			gltf => {
				if (monsterObjects.has(m.id)) return

				const wrapper = new Group()
				const model = normalizeModel(gltf.scene, MONSTER_CONFIG.modelScale, false)
				model.rotation.y = m.rotation
				wrapper.add(model)
				wrapper.position.set(m.position[0], 0, m.position[1])
				targetScene.add(wrapper)
				monsterObjects.set(m.id, wrapper)
				monsterAgents.push(createMonsterAgent(m))
			},
			undefined,
			error => console.error(`怪物模型加载失败：${modelUrl}`, error),
		)
	})
}
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
	})

	new GLTFLoader().load(
		PLAYER_CONFIG.url,
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

	const delta = clock.getDelta()
	const now = performance.now()
	const prevWood = playerAgent.woodCollected
	const prevAnim = playerAgent.animation

	playerAgent.update(delta, now)
	syncPlayerVisuals()

	if (playerAgent.woodCollected !== prevWood) {
		woodCount.value = playerAgent.woodCollected
	}
	choppingProgress.value = playerAgent.choppingProgress
		if (playerAgent.lastCollectedTree) {
			replaceTreeWithDeadModel(playerAgent.lastCollectedTree)
			playerAgent.lastCollectedTree = null
		}
	if (playerAgent.animation !== prevAnim && playerAnimation) {
		playerAnimation.play(playerAgent.animation)
	}

	

	updateFadingTrees()
	updateMonsters(delta, now)
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
	for (const agent of monsterAgents) {
		agent.update(delta, now, playerAgent.position, true)
		const obj = monsterObjects.get(agent.resource.id)
		if (!obj) continue
		obj.position.set(agent.position[0], 0, agent.position[1])
		obj.rotation.y = agent.bearing
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

	const template = liveTreeTemplates.get(newTree.modelIndex)
	if (!template) return

	const object = new Group()
	const model = template.clone(true)
	model.rotation.y = newTree.rotation
	model.scale.multiplyScalar(newTree.scale)
	object.add(model)
	object.position.set(newTree.position[0], 0, newTree.position[1])
	treeObjects.set(newTree.id, object)
	treeGroup?.add(object)
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

	// 世界背景
	ctx.beginPath()
	ctx.arc(cx, cy, WORLD_RADIUS * scale, 0, Math.PI * 2)
	ctx.fillStyle = 'rgba(12, 40, 31, 0.85)'
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

	// 怪物（红色点）
	ctx.fillStyle = '#ff4444'
	for (const agent of monsterAgents) {
		if (agent.resource.health <= 0) continue
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
	fadingTrees.length = 0
	deadTreeTemplates.clear()
	liveTreeTemplates.clear()
	treeObjects.clear()
	envTemplates.clear()
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

.resource-panel__hint {
	margin-top: 8px;
	letter-spacing: 0.02em;
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
