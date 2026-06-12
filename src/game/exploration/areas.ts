import { computed, ref } from 'vue'

import type { FootprintRecord } from '../location/footprints'
import type { LngLat } from '../player/movement'

export type ExploredArea = {
	id: string
	coordinates: LngLat[]
	areaSquareMeters: number
	createdAt: number
}

export type ExploredAreaConfig = {
	closeDistanceMeters: number
	minSquareMeters: number
}

type ProjectedPoint = {
	x: number
	y: number
	position: LngLat
}

const EARTH_RADIUS_METERS = 6378137

export function useExploredAreas(config: ExploredAreaConfig) {
	const areas = ref<ExploredArea[]>([])
	const latestArea = computed(() => areas.value[areas.value.length - 1] ?? null)
	const knownAreaIds = new Set<string>()

	const updateFromFootprints = (footprints: FootprintRecord[]) => {
		const area = detectClosedArea(footprints, config)
		if (!area || knownAreaIds.has(area.id)) return

		knownAreaIds.add(area.id)
		areas.value = [...areas.value, area]
	}

	return {
		areas,
		latestArea,
		updateFromFootprints,
	}
}

export function isInsideExploredAreas(position: LngLat, areas: ExploredArea[]) {
	return areas.some(area => isInsidePolygon(position, area.coordinates))
}

function detectClosedArea(footprints: FootprintRecord[], config: ExploredAreaConfig) {
	const orderedFootprints = [...footprints].reverse()
	if (orderedFootprints.length < 6) return null

	const latestPosition = orderedFootprints[orderedFootprints.length - 1].position
	const latestIndex = orderedFootprints.length - 1

	for (let index = 0; index < latestIndex - 3; index += 1) {
		const distance = distanceMeters(latestPosition, orderedFootprints[index].position)
		if (distance > config.closeDistanceMeters) continue

		const ring = orderedFootprints.slice(index, latestIndex + 1).map(footprint => footprint.position)
		if (ring.length < 5) continue

		const areaSquareMeters = polygonAreaSquareMeters(ring)
		if (areaSquareMeters < config.minSquareMeters) continue

		return {
			id: createAreaId(ring),
			coordinates: closeRing(ring),
			areaSquareMeters,
			createdAt: Date.now(),
		}
	}

	return null
}

function closeRing(ring: LngLat[]) {
	const first = ring[0]
	const last = ring[ring.length - 1]
	if (first[0] === last[0] && first[1] === last[1]) return ring
	return [...ring, first]
}

function createAreaId(ring: LngLat[]) {
	return ring
		.map(position => `${position[0].toFixed(5)},${position[1].toFixed(5)}`)
		.join('|')
}

function isInsidePolygon(position: LngLat, polygon: LngLat[]) {
	let inside = false
	const [lng, lat] = position

	for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index++) {
		const [currentLng, currentLat] = polygon[index]
		const [previousLng, previousLat] = polygon[previousIndex]
		const intersects =
			currentLat > lat !== previousLat > lat &&
			lng < ((previousLng - currentLng) * (lat - currentLat)) / (previousLat - currentLat) + currentLng

		if (intersects) {
			inside = !inside
		}
	}

	return inside
}

function polygonAreaSquareMeters(ring: LngLat[]) {
	const origin = ring[0]
	const projectedRing = ring.map(position => projectToMeters(position, origin))
	let area = 0

	for (let index = 0; index < projectedRing.length; index += 1) {
		const current = projectedRing[index]
		const next = projectedRing[(index + 1) % projectedRing.length]
		area += current.x * next.y - next.x * current.y
	}

	return Math.abs(area) / 2
}

function projectToMeters(position: LngLat, origin: LngLat): ProjectedPoint {
	const [lng, lat] = position
	const [originLng, originLat] = origin
	const latitudeScale = Math.cos(toRadians(originLat))

	return {
		x: toRadians(lng - originLng) * EARTH_RADIUS_METERS * latitudeScale,
		y: toRadians(lat - originLat) * EARTH_RADIUS_METERS,
		position,
	}
}

function distanceMeters(from: LngLat, to: LngLat) {
	const lat1 = toRadians(from[1])
	const lat2 = toRadians(to[1])
	const deltaLat = toRadians(to[1] - from[1])
	const deltaLng = toRadians(to[0] - from[0])
	const a =
		Math.sin(deltaLat / 2) ** 2 +
		Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2
	return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function toRadians(degrees: number) {
	return (degrees * Math.PI) / 180
}
