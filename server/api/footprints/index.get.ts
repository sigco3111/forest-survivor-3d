import type { RowDataPacket } from 'mysql2'

import { ensureFootprintSchema, getMysqlPool } from '../../utils/mysql'

type FootprintRow = RowDataPacket & {
	id: number
	lng: string | number
	lat: string | number
	traveled_meters: string | number
	game_date: string
	game_time: string
	formatted_address: string
	country: string
	province: string
	city: string
	district: string
	township: string
	street: string
	created_at: Date | string
}

export default defineEventHandler(async event => {
	const query = getQuery(event)
	const playerId = String(query.playerId || 'default').slice(0, 64)
	const limit = Math.min(Math.max(Number(query.limit || 100), 1), 500)

	await ensureFootprintSchema()
	const [rows] = await getMysqlPool().execute<FootprintRow[]>(
		`
			SELECT
				id,
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
				street,
				created_at
			FROM player_footprints
			WHERE player_id = :playerId
			ORDER BY id DESC
			LIMIT ${limit}
		`,
		{
			playerId,
		},
	)

	return rows.map(row => ({
		id: row.id,
		position: [Number(row.lng), Number(row.lat)] as [number, number],
		traveledMeters: Number(row.traveled_meters),
		gameDate: row.game_date,
		gameTime: row.game_time,
		recordedAt: new Date(row.created_at).getTime(),
		area: {
			formattedAddress: row.formatted_address,
			country: row.country,
			province: row.province,
			city: row.city,
			district: row.district,
			township: row.township,
			street: row.street,
		},
	}))
})
