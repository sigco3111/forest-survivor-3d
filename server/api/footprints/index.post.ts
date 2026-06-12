import { ensureFootprintSchema, getMysqlPool } from '../../utils/mysql'

type FootprintBody = {
	playerId?: string
	position?: [number, number]
	traveledMeters?: number
	gameDate?: string
	gameTime?: string
}

export default defineEventHandler(async event => {
	const body = await readBody<FootprintBody>(event)
	const position = body.position

	if (!Array.isArray(position) || position.length !== 2) {
		throw createError({
			statusCode: 400,
			statusMessage: 'Invalid position',
		})
	}

	const [lng, lat] = position.map(Number)
	if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
		throw createError({
			statusCode: 400,
			statusMessage: 'Invalid position',
		})
	}

	const traveledMeters = Number(body.traveledMeters ?? 0)
	const gameDate = String(body.gameDate ?? '')
	const gameTime = String(body.gameTime ?? '')
	const playerId = String(body.playerId || 'default').slice(0, 64)

	await ensureFootprintSchema()
	const [result] = await getMysqlPool().execute(
		`
			INSERT INTO player_footprints (
				player_id,
				lng,
				lat,
				traveled_meters,
				game_date,
				game_time,
				formatted_address,
				country,
				province,
				city,
				district,
				township,
				street
			) VALUES (
				:playerId,
				:lng,
				:lat,
				:traveledMeters,
				:gameDate,
				:gameTime,
				:formattedAddress,
				:country,
				:province,
				:city,
				:district,
				:township,
				:street
			)
		`,
		{
			playerId,
			lng,
			lat,
			traveledMeters,
			gameDate,
			gameTime,
			formattedAddress: '',
			country: '',
			province: '',
			city: '',
			district: '',
			township: '',
			street: '',
		},
	)
	const id = 'insertId' in result ? result.insertId : 0

	return {
		id,
		position: [lng, lat] as [number, number],
		traveledMeters,
		gameDate,
		gameTime,
		recordedAt: Date.now(),
		area: {
			formattedAddress: '',
			country: '',
			province: '',
			city: '',
			district: '',
			township: '',
			street: '',
		},
	}
})
