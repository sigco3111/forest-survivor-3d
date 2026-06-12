export type LngLat = [number, number]

export type PlayerMovementConfig = {
	origin: LngLat
	radiusMeters: number
	speedMetersPerSecond: number
}

export type PlayerMovementState = {
	bearing: number
	position: LngLat
	target: LngLat
	update: (delta: number) => void
}

const EARTH_RADIUS_METERS = 6378137

export function createPlayerMovement(config: PlayerMovementConfig): PlayerMovementState {
	const state: PlayerMovementState = {
		bearing: 0,
		position: [...config.origin],
		target: createRandomTarget(config.origin, config.radiusMeters),
		update: delta => {
			const distance = distanceMeters(state.position, state.target)

			if (distance < 0.5) {
				state.target = createRandomTarget(config.origin, config.radiusMeters)
				return
			}

			state.bearing = bearingDegrees(state.position, state.target)
			const travelDistance = Math.min(distance, config.speedMetersPerSecond * delta)
			state.position = moveAlongBearing(state.position, state.bearing, travelDistance)
		},
	}

	return state
}

function createRandomTarget(origin: LngLat, radiusMeters: number): LngLat {
	const distance = Math.sqrt(Math.random()) * radiusMeters
	const bearing = Math.random() * 360
	return moveAlongBearing(origin, bearing, distance)
}

function moveAlongBearing(position: LngLat, bearing: number, distance: number): LngLat {
	const [lng, lat] = position
	const angularDistance = distance / EARTH_RADIUS_METERS
	const bearingRadians = toRadians(bearing)
	const latRadians = toRadians(lat)
	const lngRadians = toRadians(lng)
	const nextLat = Math.asin(
		Math.sin(latRadians) * Math.cos(angularDistance) +
			Math.cos(latRadians) * Math.sin(angularDistance) * Math.cos(bearingRadians),
	)
	const nextLng =
		lngRadians +
		Math.atan2(
			Math.sin(bearingRadians) * Math.sin(angularDistance) * Math.cos(latRadians),
			Math.cos(angularDistance) - Math.sin(latRadians) * Math.sin(nextLat),
		)

	return [toDegrees(nextLng), toDegrees(nextLat)]
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

function bearingDegrees(from: LngLat, to: LngLat) {
	const lat1 = toRadians(from[1])
	const lat2 = toRadians(to[1])
	const deltaLng = toRadians(to[0] - from[0])
	const y = Math.sin(deltaLng) * Math.cos(lat2)
	const x =
		Math.cos(lat1) * Math.sin(lat2) -
		Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng)
	return (toDegrees(Math.atan2(y, x)) + 360) % 360
}

function toRadians(degrees: number) {
	return (degrees * Math.PI) / 180
}

function toDegrees(radians: number) {
	return (radians * 180) / Math.PI
}
