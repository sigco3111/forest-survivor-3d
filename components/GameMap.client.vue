<template>
	<div class="map-stage">
		<div ref="maptalksContainer" class="maptalks-container"></div>
		<div ref="mapboxContainer" class="mapbox-container"></div>
		<div class="game-time">
			<span>{{ gameDateLabel }}</span>
			<strong>{{ gameTimeLabel }}</strong>
			<small>行走 {{ playerTraveledMetersLabel }} 米</small>
			<small>当前 {{ latestFootprintLabel }}</small>
		</div>
		<div class="footprint-panel">
			<div class="footprint-panel__header">
				<strong>足迹归档</strong>
				<span>{{ footprintStatusLabel }}</span>
			</div>
			<ul v-if="footprints.length">
				<li v-for="footprint in footprints.slice(0, 5)" :key="footprint.id">
					<span>{{ footprint.gameTime }}</span>
					<strong>{{ footprint.areaLabel }}</strong>
				</li>
			</ul>
			<p v-else>等待玩家移动采样</p>
			<div v-if="visitedAreas.length" class="visited-areas">
				<span v-for="area in visitedAreas.slice(0, 4)" :key="area.id">
					{{ area.label }} x{{ area.count }}
				</span>
			</div>
		</div>
	</div>
</template>

<script lang="ts" setup>
import 'mapbox-gl/dist/mapbox-gl.css'
import 'maptalks/dist/maptalks.css'

import mapboxgl, {
	type CustomLayerInterface,
	type GeoJSONSource,
	type Map as MapboxMap,
	type ProjectionSpecification,
} from 'mapbox-gl'
import * as maptalks from 'maptalks'
import {
	AmbientLight,
	Box3,
	Clock,
	DirectionalLight,
	DoubleSide,
	Matrix4,
	Mesh,
	PCFSoftShadowMap,
	PlaneGeometry,
	PerspectiveCamera,
	Scene,
	ShadowMaterial,
	Vector3,
	WebGLRenderer,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { AMAP_CONFIG, GAME_TIME_CONFIG, MAP_CONFIG, MAPBOX_CONFIG, PLAYER_CONFIG } from '../src/config'
import { applyGameTimeEnvironment } from '../src/game/environment'
import { useExploredAreas, type ExploredArea } from '../src/game/exploration/areas'
import { useFootprintArchive, type FootprintRecord } from '../src/game/location/footprints'
import {
	createPlayerAnimationController,
	type PlayerAnimationController,
} from '../src/game/player/animations'
import {
	createPlayerMovement,
	type PlayerMovementState,
} from '../src/game/player/movement'
import { useGameTime } from '../src/game/time'

defineOptions({
	name: 'App',
})

const maptalksContainer = ref<HTMLDivElement | null>(null)
const mapboxContainer = ref<HTMLDivElement | null>(null)

let maptalksMap: maptalks.Map | null = null
let mapboxMap: MapboxMap | null = null
let playerLayer: PlayerModelLayer | null = null
let explorePulseFrame = 0
let playerMovement: PlayerMovementState | null = null
let initialPlayerPosition: [number, number] = MAP_CONFIG.center
let initialPlayerTraveledMeters = 0
const gameTime = useGameTime(GAME_TIME_CONFIG)
const gameDateLabel = gameTime.dateLabel
const gameTimeLabel = gameTime.timeLabel
const playerTraveledMeters = ref(0)
const playerTraveledMetersLabel = computed(() =>
	Math.floor(playerTraveledMeters.value).toLocaleString('zh-CN'),
)
const footprintArchive = useFootprintArchive({
	intervalSeconds: PLAYER_CONFIG.footprintRecordIntervalSeconds,
	maxItems: PLAYER_CONFIG.footprintArchiveMaxItems,
})
const footprints = footprintArchive.footprints
const visitedAreas = footprintArchive.visitedAreas
const exploredAreaArchive = useExploredAreas({
	closeDistanceMeters: PLAYER_CONFIG.exploredAreaCloseDistanceMeters,
	minSquareMeters: PLAYER_CONFIG.exploredAreaMinSquareMeters,
})
const exploredAreas = exploredAreaArchive.areas
const latestFootprintLabel = computed(() => footprintArchive.latestFootprint.value?.areaLabel || '定位中')
const footprintStatusLabel = computed(() => {
	if (footprintArchive.error.value) return footprintArchive.error.value
	const exploredAreaCount = exploredAreas.value.length
	const suffix = exploredAreaCount ? ` / ${exploredAreaCount} 区域` : ''
	return footprintArchive.isResolving.value ? '计算中' : `${footprints.value.length} 条${suffix}`
})

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
			getAvoidAreas: () => exploredAreas.value.map(area => area.coordinates),
			initialTraveledMeters: initialPlayerTraveledMeters,
			origin: position,
			stepDistanceMeters: PLAYER_CONFIG.walkStepDistanceMeters,
			speedMetersPerSecond: PLAYER_CONFIG.walkSpeedMetersPerSecond,
		})
		playerMovement = this.movement
	}

	onAdd(map: MapboxMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
		const ambientLight = new AmbientLight('#ffffff', 0.65)
		const keyLight = new DirectionalLight('#fff4dc', 4.8)
		keyLight.position.set(-8, 14, 10)
		keyLight.castShadow = true
		keyLight.shadow.mapSize.set(2048, 2048)
		keyLight.shadow.camera.near = 1
		keyLight.shadow.camera.far = 260
		keyLight.shadow.camera.left = -110
		keyLight.shadow.camera.right = 110
		keyLight.shadow.camera.top = 110
		keyLight.shadow.camera.bottom = -110
		const rimLight = new DirectionalLight('#5df4ff', 0.8)
		rimLight.position.set(5, 5, -6)
		this.scene.add(ambientLight, keyLight, keyLight.target, rimLight)

		this.renderer = new WebGLRenderer({
			canvas: map.getCanvas(),
			context: gl,
			antialias: true,
		})
		this.renderer.autoClear = false
		this.renderer.shadowMap.enabled = true
		this.renderer.shadowMap.type = PCFSoftShadowMap

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
			const groundY = -scaledBottomY
			model.position.y = groundY
			model.traverse(object => {
				object.frustumCulled = false
				if (object instanceof Mesh) {
					object.castShadow = true
					object.receiveShadow = false
				}
			})

			this.playerAnimationController = createPlayerAnimationController(model, gltf.animations)
			this.scene.add(createPlayerShadowPlane(groundY))
			this.scene.add(model)
			map.triggerRepaint()
		})

		this.updateModelMatrix(0)
	}

	render(_gl: WebGLRenderingContext | WebGL2RenderingContext, matrix: number[]) {
		if (!this.renderer) return

		const delta = this.clock.getDelta()
		this.movement.update(delta)
		playerTraveledMeters.value = this.movement.traveledMeters
		footprintArchive.record(
			this.movement.position,
			this.movement.traveledMeters,
			gameDateLabel.value,
			gameTimeLabel.value,
		)
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

function createPlayerShadowPlane(groundY: number) {
	const material = new ShadowMaterial({
		color: '#000000',
		opacity: PLAYER_CONFIG.shadowOpacity,
		side: DoubleSide,
		transparent: true,
	})
	const plane = new Mesh(
		new PlaneGeometry(PLAYER_CONFIG.shadowRadius, PLAYER_CONFIG.shadowRadius),
		material,
	)
	plane.rotation.x = -Math.PI / 2
	plane.position.y = groundY + 0.02
	plane.receiveShadow = true
	return plane
}

function createMaptalksShell() {
	if (!maptalksContainer.value) return

	maptalksMap = new maptalks.Map(maptalksContainer.value, {
		center: initialPlayerPosition,
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
		center: initialPlayerPosition,
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

		playerLayer = new PlayerModelLayer(initialPlayerPosition, PLAYER_CONFIG.url)
		createFootprintTrail(mapboxMap)
		createExploredAreaLayers(mapboxMap)
		mapboxMap.addLayer(playerLayer)
		createExplorePulse(mapboxMap)
	})
}

function createExploredAreaLayers(map: MapboxMap) {
	const sourceId = 'player-explored-areas'
	const fillLayerId = 'player-explored-area-fill'
	const lineLayerId = 'player-explored-area-line'

	if (!map.getSource(sourceId)) {
		map.addSource(sourceId, {
			type: 'geojson',
			data: createExploredAreaFeatureCollection(exploredAreas.value),
		})
	}

	if (!map.getLayer(fillLayerId)) {
		map.addLayer({
			id: fillLayerId,
			type: 'fill',
			source: sourceId,
			paint: {
				'fill-color': PLAYER_CONFIG.exploredAreaColor,
				'fill-opacity': 0.12,
			},
		})
	}

	if (!map.getLayer(lineLayerId)) {
		map.addLayer({
			id: lineLayerId,
			type: 'line',
			source: sourceId,
			paint: {
				'line-color': PLAYER_CONFIG.exploredAreaColor,
				'line-opacity': 0.42,
				'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 16, 2.5],
				'line-dasharray': [1.6, 1.2],
			},
		})
	}

	updateExploredAreaLayers()
}

function updateExploredAreaLayers() {
	const source = mapboxMap?.getSource('player-explored-areas') as GeoJSONSource | undefined
	source?.setData(createExploredAreaFeatureCollection(exploredAreas.value))
}

function createExploredAreaFeatureCollection(areas: ExploredArea[]) {
	return {
		type: 'FeatureCollection' as const,
		features: areas.map((area, index) => ({
			type: 'Feature' as const,
			properties: {
				id: area.id,
				order: index + 1,
				areaSquareMeters: Math.round(area.areaSquareMeters),
			},
			geometry: {
				type: 'Polygon' as const,
				coordinates: [area.coordinates],
			},
		})),
	}
}

function createFootprintTrail(map: MapboxMap) {
	const sourceId = 'player-footprints'
	const lineLayerId = 'player-footprint-line'
	const pointHaloLayerId = 'player-footprint-point-halo'
	const pointLayerId = 'player-footprint-point'
	const labelLayerId = 'player-footprint-label'

	if (!map.getSource(sourceId)) {
		map.addSource(sourceId, {
			type: 'geojson',
			data: createFootprintFeatureCollection(footprints.value),
		})
	}

	if (!map.getLayer(lineLayerId)) {
		map.addLayer({
			id: lineLayerId,
			type: 'line',
			source: sourceId,
			filter: ['==', ['geometry-type'], 'LineString'],
			layout: {
				'line-cap': 'round',
				'line-join': 'round',
			},
			paint: {
				'line-color': PLAYER_CONFIG.footprintTrailColor,
				'line-opacity': 0.34,
				'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 16, 2.6],
			},
		})
	}

	if (!map.getLayer(pointHaloLayerId)) {
		map.addLayer({
			id: pointHaloLayerId,
			type: 'circle',
			source: sourceId,
			filter: ['==', ['geometry-type'], 'Point'],
			paint: {
				'circle-color': PLAYER_CONFIG.footprintTrailColor,
				'circle-opacity': 0.08,
				'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 16, 10],
				'circle-stroke-color': PLAYER_CONFIG.footprintTrailColor,
				'circle-stroke-opacity': 0.18,
				'circle-stroke-width': 1,
			},
		})
	}

	if (!map.getLayer(pointLayerId)) {
		map.addLayer({
			id: pointLayerId,
			type: 'circle',
			source: sourceId,
			filter: ['==', ['geometry-type'], 'Point'],
			paint: {
				'circle-color': PLAYER_CONFIG.footprintPointColor,
				'circle-opacity': 0.55,
				'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2, 16, 4],
				'circle-stroke-color': '#061622',
				'circle-stroke-opacity': 0.42,
				'circle-stroke-width': 1,
			},
		})
	}

	if (!map.getLayer(labelLayerId)) {
		map.addLayer({
			id: labelLayerId,
			type: 'symbol',
			source: sourceId,
			filter: ['==', ['geometry-type'], 'Point'],
			layout: {
				'text-field': ['get', 'label'],
				'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
				'text-size': 10,
				'text-offset': [0, 1.2],
				'text-anchor': 'top',
				'text-allow-overlap': false,
			},
			paint: {
				'text-color': '#a8dce4',
				'text-opacity': 0.48,
				'text-halo-color': '#061622',
				'text-halo-width': 0.8,
			},
		})
	}

	updateFootprintTrail()
}

function updateFootprintTrail() {
	const source = mapboxMap?.getSource('player-footprints') as GeoJSONSource | undefined
	source?.setData(createFootprintFeatureCollection(footprints.value))
}

function createFootprintFeatureCollection(records: FootprintRecord[]) {
	const orderedRecords = [...records].reverse()
	const coordinates = orderedRecords.map(record => record.position)
	const features = orderedRecords.map((record, index) => ({
		type: 'Feature' as const,
		properties: {
			id: record.id,
			label: record.gameTime,
			order: index + 1,
			area: record.areaLabel,
			traveledMeters: Math.floor(record.traveledMeters),
		},
		geometry: {
			type: 'Point' as const,
			coordinates: record.position,
		},
	}))

	if (coordinates.length > 1) {
		features.unshift({
			type: 'Feature' as const,
			properties: {
				id: 'footprint-path',
				label: '',
				order: 0,
				area: '',
				traveledMeters: 0,
			},
			geometry: {
				type: 'LineString' as const,
				coordinates,
			},
		})
	}

	return {
		type: 'FeatureCollection' as const,
		features,
	}
}

function createExplorePulse(map: MapboxMap) {
	const sourceId = 'player-explore-pulse'
	const fillLayerId = 'player-explore-pulse-fill'
	const lineLayerId = 'player-explore-pulse-line'

	if (!map.getSource(sourceId)) {
		map.addSource(sourceId, {
			type: 'geojson',
			data: createCircleFeature(MAP_CONFIG.center, 0),
		})
	}

	if (!map.getLayer(fillLayerId)) {
		map.addLayer({
			id: fillLayerId,
			type: 'fill',
			source: sourceId,
			paint: {
				'fill-color': PLAYER_CONFIG.explorePulseColor,
				'fill-opacity': 0.08,
			},
		})
	}

	if (!map.getLayer(lineLayerId)) {
		map.addLayer({
			id: lineLayerId,
			type: 'line',
			source: sourceId,
			paint: {
				'line-color': PLAYER_CONFIG.explorePulseColor,
				'line-width': 2,
				'line-opacity': 0.8,
			},
		})
	}

	const startedAt = performance.now()
	const animate = (now: number) => {
		if (!mapboxMap) return

		const progress =
			((now - startedAt) % PLAYER_CONFIG.explorePulseDurationMs) /
			PLAYER_CONFIG.explorePulseDurationMs
		const center = playerMovement?.position ?? MAP_CONFIG.center
		const radius = PLAYER_CONFIG.explorePulseRadiusMeters * progress
		const opacity = 1 - progress
		const source = map.getSource(sourceId)

		if (source && 'setData' in source) {
			source.setData(createCircleFeature(center, radius))
		}

		if (map.getLayer(fillLayerId)) {
			map.setPaintProperty(fillLayerId, 'fill-opacity', 0.08 * opacity)
		}
		if (map.getLayer(lineLayerId)) {
			map.setPaintProperty(lineLayerId, 'line-opacity', 0.8 * opacity)
			map.setPaintProperty(lineLayerId, 'line-width', 1 + 3 * opacity)
		}

		explorePulseFrame = window.requestAnimationFrame(animate)
	}

	if (explorePulseFrame) {
		window.cancelAnimationFrame(explorePulseFrame)
	}
	explorePulseFrame = window.requestAnimationFrame(animate)
}

function createCircleFeature(center: [number, number], radiusMeters: number) {
	const coordinates = []
	const steps = 96
	const earthRadiusMeters = 6378137
	const [centerLng, centerLat] = center
	const centerLatRadians = (centerLat * Math.PI) / 180
	const centerLngRadians = (centerLng * Math.PI) / 180
	const angularDistance = radiusMeters / earthRadiusMeters

	for (let index = 0; index <= steps; index += 1) {
		const bearing = (index / steps) * Math.PI * 2
		const lat = Math.asin(
			Math.sin(centerLatRadians) * Math.cos(angularDistance) +
				Math.cos(centerLatRadians) * Math.sin(angularDistance) * Math.cos(bearing),
		)
		const lng =
			centerLngRadians +
			Math.atan2(
				Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(centerLatRadians),
				Math.cos(angularDistance) - Math.sin(centerLatRadians) * Math.sin(lat),
			)
		coordinates.push([(lng * 180) / Math.PI, (lat * 180) / Math.PI])
	}

	return {
		type: 'Feature' as const,
		properties: {},
		geometry: {
			type: 'Polygon' as const,
			coordinates: [coordinates],
		},
	}
}

onMounted(async () => {
	window._AMapSecurityConfig = {
		securityJsCode: AMAP_CONFIG.securityJsCode,
	}

	await footprintArchive.load()
	const latestFootprint = footprints.value[0]
	if (latestFootprint) {
		initialPlayerPosition = latestFootprint.position
		initialPlayerTraveledMeters = latestFootprint.traveledMeters
		playerTraveledMeters.value = latestFootprint.traveledMeters
		exploredAreaArchive.updateFromFootprints(footprints.value)
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

watch(footprints, () => {
	exploredAreaArchive.updateFromFootprints(footprints.value)
	updateFootprintTrail()
})

watch(exploredAreas, () => {
	updateExploredAreaLayers()
})

onUnmounted(() => {
	gameTime.stop()
	if (explorePulseFrame) {
		window.cancelAnimationFrame(explorePulseFrame)
	}

	if (playerLayer && mapboxMap?.getLayer(playerLayer.id)) {
		mapboxMap.removeLayer(playerLayer.id)
	}

	mapboxMap?.remove()
	maptalksMap?.remove()
	playerLayer = null
	playerMovement = null
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
	display: grid;
	gap: 6px;
	min-width: 178px;
	padding: 12px 14px;
	color: #d9fbff;
	background: rgb(3 16 28 / 72%);
	border: 1px solid rgb(74 224 255 / 44%);
	box-shadow: 0 0 24px rgb(34 220 255 / 18%), inset 0 0 18px rgb(34 220 255 / 10%);
	backdrop-filter: blur(10px);
}

.game-time span {
	font-size: 13px;
	line-height: 1;
	color: #80e5ef;
	white-space: nowrap;
}

.game-time strong {
	font-size: 28px;
	line-height: 1;
	font-variant-numeric: tabular-nums;
}

.game-time small {
	font-size: 12px;
	line-height: 1;
	color: #b9f4fa;
	white-space: nowrap;
}

.footprint-panel {
	position: absolute;
	z-index: 3;
	right: 20px;
	bottom: 20px;
	display: grid;
	gap: 10px;
	width: min(360px, calc(100vw - 40px));
	padding: 12px 14px;
	color: #d9fbff;
	background: rgb(3 16 28 / 72%);
	border: 1px solid rgb(74 224 255 / 38%);
	box-shadow: 0 0 24px rgb(34 220 255 / 15%), inset 0 0 18px rgb(34 220 255 / 8%);
	backdrop-filter: blur(10px);
}

.footprint-panel__header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
}

.footprint-panel__header strong {
	font-size: 14px;
	line-height: 1;
}

.footprint-panel__header span,
.footprint-panel p {
	margin: 0;
	font-size: 12px;
	line-height: 1.4;
	color: #80e5ef;
}

.footprint-panel ul {
	display: grid;
	gap: 8px;
	padding: 0;
	margin: 0;
	list-style: none;
}

.footprint-panel li {
	display: grid;
	grid-template-columns: 58px minmax(0, 1fr);
	gap: 8px;
	align-items: start;
	min-height: 20px;
	font-size: 12px;
	line-height: 1.35;
}

.footprint-panel li span {
	color: #80e5ef;
	font-variant-numeric: tabular-nums;
}

.footprint-panel li strong {
	overflow: hidden;
	color: #e8feff;
	font-weight: 500;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.visited-areas {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}

.visited-areas span {
	max-width: 100%;
	padding: 4px 7px;
	overflow: hidden;
	font-size: 11px;
	line-height: 1.2;
	color: #b9f4fa;
	text-overflow: ellipsis;
	white-space: nowrap;
	background: rgb(53 244 255 / 10%);
	border: 1px solid rgb(53 244 255 / 22%);
}

@media (max-width: 640px) {
	.footprint-panel {
		right: 12px;
		bottom: 12px;
		left: 12px;
		width: auto;
	}

	.game-time {
		top: 12px;
		left: 12px;
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

.mapboxgl-ctrl-logo,
.mapboxgl-ctrl-attrib,
.maptalks-attribution {
	display: none !important;
}
</style>
