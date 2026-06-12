<template>
	<div class="map-stage">
		<div ref="maptalksContainer" class="maptalks-container"></div>
		<div ref="mapboxContainer" class="mapbox-container"></div>
		<div class="game-time">
			<strong>{{ gameTimeLabel }}</strong>
		</div>
	</div>
</template>

<script lang="ts" setup>
import 'mapbox-gl/dist/mapbox-gl.css'
import 'maptalks/dist/maptalks.css'

import mapboxgl, {
	type CustomLayerInterface,
	type Map as MapboxMap,
	type ProjectionSpecification,
} from 'mapbox-gl'
import * as maptalks from 'maptalks'
import {
	AmbientLight,
	Box3,
	Clock,
	DirectionalLight,
	Matrix4,
	PerspectiveCamera,
	Scene,
	Vector3,
	WebGLRenderer,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { onMounted, onUnmounted, ref, watch } from 'vue'

import { AMAP_CONFIG, GAME_TIME_CONFIG, MAP_CONFIG, MAPBOX_CONFIG, PLAYER_CONFIG } from './config'
import { applyGameTimeEnvironment } from './game/environment'
import {
	createPlayerAnimationController,
	type PlayerAnimationController,
} from './game/player/animations'
import {
	createPlayerMovement,
	type PlayerMovementState,
} from './game/player/movement'
import { useGameTime } from './game/time'

defineOptions({
	name: 'App',
})

const maptalksContainer = ref<HTMLDivElement | null>(null)
const mapboxContainer = ref<HTMLDivElement | null>(null)

let maptalksMap: maptalks.Map | null = null
let mapboxMap: MapboxMap | null = null
let playerLayer: PlayerModelLayer | null = null
const gameTime = useGameTime(GAME_TIME_CONFIG)
const gameTimeLabel = gameTime.label

class PlayerModelLayer implements CustomLayerInterface {
	id = 'player-model'
	type = 'custom' as const
	renderingMode = '3d' as const

	private camera = new PerspectiveCamera()
	private clock = new Clock()
	private modelMatrix = new Matrix4()
	private movement: PlayerMovementState
	private playerAnimationController: PlayerAnimationController | null = null
	private renderer: WebGLRenderer | null = null
	private scene = new Scene()

	constructor(
		private readonly position: [number, number],
		private readonly modelUrl: string,
	) {
		this.movement = createPlayerMovement({
			origin: position,
			radiusMeters: PLAYER_CONFIG.walkRadiusMeters,
			speedMetersPerSecond: PLAYER_CONFIG.walkSpeedMetersPerSecond,
		})
	}

	onAdd(map: MapboxMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
		const ambientLight = new AmbientLight('#ffffff', 2)
		const keyLight = new DirectionalLight('#ffffff', 3.2)
		keyLight.position.set(4, 6, 7)
		const rimLight = new DirectionalLight('#5df4ff', 1.6)
		rimLight.position.set(-5, 4, -4)
		this.scene.add(ambientLight, keyLight, rimLight)

		this.renderer = new WebGLRenderer({
			canvas: map.getCanvas(),
			context: gl,
			antialias: true,
		})
		this.renderer.autoClear = false

		new GLTFLoader().load(this.modelUrl, gltf => {
			const model = gltf.scene
			const bounds = new Box3().setFromObject(model)
			const size = bounds.getSize(new Vector3())
			const center = bounds.getCenter(new Vector3())
			const maxSize = Math.max(size.x, size.y, size.z) || 1

			model.position.sub(center)
			model.rotation.y = (PLAYER_CONFIG.rotationY * Math.PI) / 180
			model.scale.setScalar(PLAYER_CONFIG.scale / maxSize)
			const scaledBottomY = (bounds.min.y - center.y) * (PLAYER_CONFIG.scale / maxSize)
			model.position.y = -scaledBottomY
			model.traverse(object => {
				object.frustumCulled = false
			})

			this.playerAnimationController = createPlayerAnimationController(model, gltf.animations)
			this.scene.add(model)
			map.triggerRepaint()
		})

		this.updateModelMatrix(0)
	}

	render(_gl: WebGLRenderingContext | WebGL2RenderingContext, matrix: number[]) {
		if (!this.renderer) return

		const delta = this.clock.getDelta()
		this.movement.update(delta)
		this.playerAnimationController?.update(delta)
		this.updateModelMatrix(this.movement.bearing)
		this.camera.projectionMatrix = new Matrix4().fromArray(matrix).multiply(this.modelMatrix)
		this.renderer.resetState()
		this.renderer.render(this.scene, this.camera)
		mapboxMap?.triggerRepaint()
	}

	private updateModelMatrix(bearing: number) {
		const terrainElevation = mapboxMap?.queryTerrainElevation(this.movement.position, {
			exaggerated: true,
		}) ?? 0
		const groundAltitude = terrainElevation + PLAYER_CONFIG.terrainOffset
		const mercator = mapboxgl.MercatorCoordinate.fromLngLat(this.movement.position, groundAltitude)
		const meterScale = mercator.meterInMercatorCoordinateUnits()

		const heading = bearing + PLAYER_CONFIG.headingOffset

		this.modelMatrix = new Matrix4()
			.makeTranslation(mercator.x, mercator.y, mercator.z)
			.scale({
				x: meterScale,
				y: -meterScale,
				z: meterScale,
			})
			.multiply(new Matrix4().makeRotationZ((-heading * Math.PI) / 180))
			.multiply(new Matrix4().makeRotationX(Math.PI / 2))
	}
}

function createMaptalksShell() {
	if (!maptalksContainer.value) return

	maptalksMap = new maptalks.Map(maptalksContainer.value, {
		center: MAP_CONFIG.center,
		zoom: MAP_CONFIG.zoom,
		pitch: MAP_CONFIG.pitch,
		bearing: MAP_CONFIG.bearing,
		attribution: false,
	})
}

function createMapboxScene() {
	if (!mapboxContainer.value) return

	mapboxgl.accessToken = MAPBOX_CONFIG.token

	mapboxMap = new mapboxgl.Map({
		container: mapboxContainer.value,
		style: MAPBOX_CONFIG.style,
		center: MAP_CONFIG.center,
		zoom: MAP_CONFIG.zoom,
		pitch: MAP_CONFIG.pitch,
		bearing: MAP_CONFIG.bearing,
		projection: MAPBOX_CONFIG.projection as ProjectionSpecification['name'],
		antialias: true,
		attributionControl: false,
	})

	mapboxMap.on('style.load', () => {
		if (!mapboxMap) return

		applyGameTimeEnvironment(mapboxMap, gameTime.hour.value, GAME_TIME_CONFIG)

		if (!mapboxMap.getSource(MAPBOX_CONFIG.terrainSource)) {
			mapboxMap.addSource(MAPBOX_CONFIG.terrainSource, {
				type: 'raster-dem',
				url: MAPBOX_CONFIG.terrainUrl,
				tileSize: 512,
				maxzoom: 14,
			})
		}

		mapboxMap.setTerrain({
			source: MAPBOX_CONFIG.terrainSource,
			exaggeration: MAPBOX_CONFIG.terrainExaggeration,
		})

		playerLayer = new PlayerModelLayer(MAP_CONFIG.center, PLAYER_CONFIG.url)
		mapboxMap.addLayer(playerLayer)
	})
}

onMounted(() => {
	window._AMapSecurityConfig = {
		securityJsCode: AMAP_CONFIG.securityJsCode,
	}

	createMaptalksShell()
	createMapboxScene()
	gameTime.start()
})

watch(gameTime.isDaytime, () => {
	if (mapboxMap) {
		applyGameTimeEnvironment(mapboxMap, gameTime.hour.value, GAME_TIME_CONFIG)
	}
})

onUnmounted(() => {
	gameTime.stop()

	if (playerLayer && mapboxMap?.getLayer(playerLayer.id)) {
		mapboxMap.removeLayer(playerLayer.id)
	}

	mapboxMap?.remove()
	maptalksMap?.remove()
	playerLayer = null
	mapboxMap = null
	maptalksMap = null
})
</script>

<style lang="scss" scoped>
.map-stage {
	position: relative;
	width: 100vw;
	height: 100vh;
	overflow: hidden;
	background: #d8eef7;
}

.maptalks-container,
.mapbox-container {
	position: absolute;
	inset: 0;
}

.maptalks-container {
	pointer-events: none;
	opacity: 0;
}

.mapbox-container {
	z-index: 1;
}

.game-time {
	position: absolute;
	z-index: 3;
	top: 20px;
	left: 20px;
	min-width: 104px;
	padding: 10px 14px;
	color: #d9fbff;
	background: rgb(3 16 28 / 72%);
	border: 1px solid rgb(74 224 255 / 44%);
	box-shadow: 0 0 24px rgb(34 220 255 / 18%), inset 0 0 18px rgb(34 220 255 / 10%);
	backdrop-filter: blur(10px);
}

.game-time strong {
	font-size: 28px;
	line-height: 1;
	font-variant-numeric: tabular-nums;
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

.mapboxgl-ctrl-logo,
.mapboxgl-ctrl-attrib,
.maptalks-attribution {
	display: none !important;
}
</style>
