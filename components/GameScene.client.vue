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
	</div>
</template>

<script lang="ts" setup>
import {
	AmbientLight,
	Box3,
	Clock,
	DirectionalLight,
	DoubleSide,
	Group,
	HemisphereLight,
	MathUtils,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	Object3D,
	PCFSoftShadowMap,
	PerspectiveCamera,
	PlaneGeometry,
	RingGeometry,
	Scene,
	TextureLoader,
	Vector3,
	WebGLRenderer,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { PLAYER_CONFIG, TREE_RESOURCE_CONFIG } from '../src/config'
import {
	createPlayerAnimationController,
	type PlayerAnimationController,
} from '../src/game/player/animations'
import {
	collectTree,
	createNoiseTrees,
	findNearbyTree,
	type PlanePoint,
	type TreeResource,
} from '../src/game/resources/trees'

defineOptions({
	name: 'App',
})

const sceneContainer = ref<HTMLDivElement | null>(null)
const choppingProgress = ref(0)
const woodCount = ref(0)
const choppingHint = computed(() => {
	if (choppingProgress.value > 0) {
		return `伐木中 ${Math.round(choppingProgress.value * 100)}%`
	}

	return '靠近树木开始伐木'
})

type PlayerState = {
	animation: PlayerAnimationController | null
	bearing: number
	model: Object3D | null
	position: PlanePoint
	target: PlanePoint
}

let activeTree: TreeResource | null = null
let animationFrame = 0
let choppingStartedAt = 0
let clock: Clock | null = null
let camera: PerspectiveCamera | null = null
let playerState: PlayerState | null = null
let renderer: WebGLRenderer | null = null
let scene: Scene | null = null
let treeGroup: Group | null = null
let treeResources: TreeResource[] = []
const deadTreeTemplates = new Map<number, Object3D>()
const treeObjects = new Map<string, Object3D>()

const WORLD_RADIUS = TREE_RESOURCE_CONFIG.radiusMeters
const PLAYER_START: PlanePoint = [0, 0]
const CAMERA_OFFSET = new Vector3(0, 260, 360)

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

	addEnvironment(scene)
	createTrees(scene)
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
	activeTree = null
	choppingProgress.value = 0
	choppingStartedAt = 0
	treeObjects.clear()

	TREE_RESOURCE_CONFIG.modelUrls.forEach((modelUrl, modelIndex) => {
		new GLTFLoader().load(
			modelUrl,
			gltf => {
				const template = normalizeModel(gltf.scene)
				treeResources
					.filter(tree => tree.modelIndex === modelIndex && !tree.collected)
					.forEach(tree => {
						const object = new Group()
						const model = template.clone(true)
						model.rotation.y = tree.rotation
						model.scale.multiplyScalar(tree.scale)
						object.add(model)
						object.position.set(tree.position[0], 0, tree.position[1])
						treeObjects.set(tree.id, object)
						treeGroup?.add(object)
					})
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

function createPlayer(targetScene: Scene) {
	const playerRoot = new Group()
	const playerMarker = new Mesh(
		new RingGeometry(22, 27, 48),
		new MeshBasicMaterial({
			color: '#35f4ff',
			opacity: 0.72,
			side: DoubleSide,
			transparent: true,
		}),
	)
	playerMarker.rotation.x = -Math.PI / 2
	playerMarker.position.y = 0.8
	playerRoot.add(playerMarker)
	playerRoot.position.set(PLAYER_START[0], 0, PLAYER_START[1])
	targetScene.add(playerRoot)

	playerState = {
		animation: null,
		bearing: 0,
		model: playerRoot,
		position: [...PLAYER_START],
		target: createNextPlayerTarget(PLAYER_START),
	}

	new GLTFLoader().load(
		PLAYER_CONFIG.url,
		gltf => {
			if (!playerState) return

			const model = normalizeModel(gltf.scene)
			model.rotation.y = MathUtils.degToRad(PLAYER_CONFIG.rotationY)
			model.scale.multiplyScalar(PLAYER_CONFIG.scale)
			playerRoot.add(model)
			playerState.animation = createPlayerAnimationController(model, gltf.animations)
			console.info(`玩家模型已加载：${PLAYER_CONFIG.url}`)
		},
		undefined,
		error => {
			console.error(`玩家模型加载失败：${PLAYER_CONFIG.url}`, error)
		},
	)
}

function renderFrame() {
	animationFrame = window.requestAnimationFrame(renderFrame)
	if (!clock || !renderer || !scene || !camera || !playerState) return

	const delta = clock.getDelta()
	updatePlayer(delta)
	updateChopping()
	playerState.animation?.update(delta)
	updateCamera()
	renderer.render(scene, camera)
}

function updatePlayer(delta: number) {
	if (!playerState?.model || activeTree) return

	const dx = playerState.target[0] - playerState.position[0]
	const dz = playerState.target[1] - playerState.position[1]
	const distance = Math.hypot(dx, dz)

	if (distance < 2) {
		playerState.target = createNextPlayerTarget(playerState.position)
		return
	}

	const travelDistance = Math.min(distance, PLAYER_CONFIG.walkSpeedMetersPerSecond * delta * 5)
	const directionX = dx / distance
	const directionZ = dz / distance
	playerState.position = [
		playerState.position[0] + directionX * travelDistance,
		playerState.position[1] + directionZ * travelDistance,
	]
	playerState.bearing = Math.atan2(directionX, directionZ)
	playerState.model.position.set(playerState.position[0], 0, playerState.position[1])
	playerState.model.rotation.y = playerState.bearing + MathUtils.degToRad(PLAYER_CONFIG.rotationY)
}

function updateChopping() {
	if (!playerState) return

	const nearbyTree = findNearbyTree(
		treeResources,
		playerState.position,
		PLAYER_CONFIG.collectTreeRadiusMeters,
	)
	const now = performance.now()

	if (!nearbyTree) {
		resetChopping()
		return
	}

	if (activeTree?.id !== nearbyTree.id) {
		activeTree = nearbyTree
		choppingStartedAt = now
		choppingProgress.value = 0.01
		playerState.animation?.play('interact')
		faceTree(nearbyTree)
		return
	}

	choppingProgress.value = Math.min(1, (now - choppingStartedAt) / PLAYER_CONFIG.chopTreeDurationMs)
	faceTree(nearbyTree)

	if (choppingProgress.value < 1) return

	const tree = collectTree(nearbyTree)
	woodCount.value += tree.wood
	replaceTreeWithDeadModel(tree)
	resetChopping()
	playerState.animation?.play('walk')
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
	deadObject.add(model)
	deadObject.position.set(tree.position[0], 0, tree.position[1])
	treeGroup?.add(deadObject)
}

function faceTree(tree: TreeResource) {
	if (!playerState?.model) return

	const dx = tree.position[0] - playerState.position[0]
	const dz = tree.position[1] - playerState.position[1]
	playerState.bearing = Math.atan2(dx, dz)
	playerState.model.rotation.y = playerState.bearing + MathUtils.degToRad(PLAYER_CONFIG.rotationY)
}

function resetChopping() {
	if (activeTree && playerState?.animation) {
		playerState.animation.play('walk')
	}
	activeTree = null
	choppingStartedAt = 0
	choppingProgress.value = 0
}

function updateCamera() {
	if (!camera || !playerState?.model) return

	const target = playerState.model.position
	camera.position.lerp(
		new Vector3(target.x + CAMERA_OFFSET.x, target.y + CAMERA_OFFSET.y, target.z + CAMERA_OFFSET.z),
		0.08,
	)
	camera.lookAt(target.x, target.y + 45, target.z)
}

function createNextPlayerTarget(position: PlanePoint): PlanePoint {
	const minDistance = PLAYER_CONFIG.walkStepDistanceMeters * 0.55
	const distance = minDistance + Math.random() * (PLAYER_CONFIG.walkStepDistanceMeters - minDistance)
	const angle = Math.random() * Math.PI * 2
	const next: PlanePoint = [
		position[0] + Math.sin(angle) * distance,
		position[1] + Math.cos(angle) * distance,
	]
	const distanceFromCenter = Math.hypot(next[0], next[1])

	if (distanceFromCenter > WORLD_RADIUS * 0.84) {
		return [next[0] * (WORLD_RADIUS * 0.72 / distanceFromCenter), next[1] * (WORLD_RADIUS * 0.72 / distanceFromCenter)]
	}

	return next
}

function normalizeModel(model: Object3D) {
	const normalizedModel = model.clone(true)
	const bounds = new Box3().setFromObject(normalizedModel)
	const size = bounds.getSize(new Vector3())
	const center = bounds.getCenter(new Vector3())
	const maxSize = Math.max(size.x, size.y, size.z) || 1

	normalizedModel.position.sub(center)
	normalizedModel.scale.setScalar(1 / maxSize)
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
	renderer?.dispose()
	renderer?.domElement.remove()
	activeTree = null
	animationFrame = 0
	camera = null
	clock = null
	playerState = null
	renderer = null
	scene = null
	treeGroup = null
	treeResources = []
	deadTreeTemplates.clear()
	treeObjects.clear()
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
