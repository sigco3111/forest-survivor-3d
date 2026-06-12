import type { RowDataPacket } from 'mysql2'

import { resolveAmapArea } from './amapRegeo'
import { ensureFootprintSchema, getMysqlPool } from './mysql'

type PendingFootprintRow = RowDataPacket & {
	id: number
	lng: string | number
	lat: string | number
}

export const FOOTPRINT_RESOLVE_BATCH_SIZE = 8
export const FOOTPRINT_MAX_RESOLVE_ATTEMPTS = 3

export async function resolvePendingFootprintAreas() {
	await ensureFootprintSchema()
	const pool = getMysqlPool()
	const [rows] = await pool.execute<PendingFootprintRow[]>(
		`
			SELECT id, lng, lat
			FROM player_footprints
			WHERE area_resolved = 0
				AND area_resolve_attempts < :maxAttempts
			ORDER BY id ASC
			LIMIT ${FOOTPRINT_RESOLVE_BATCH_SIZE}
		`,
		{
			maxAttempts: FOOTPRINT_MAX_RESOLVE_ATTEMPTS,
		},
	)

	let resolved = 0
	let failed = 0

	for (const row of rows) {
		const didResolve = await resolveFootprintArea(row)
		if (didResolve) {
			resolved += 1
		} else {
			failed += 1
		}
	}

	return {
		failed,
		pending: rows.length,
		resolved,
	}
}

async function resolveFootprintArea(row: PendingFootprintRow) {
	const pool = getMysqlPool()

	try {
		const area = await resolveAmapArea(`${row.lng},${row.lat}`)
		await pool.execute(
			`
				UPDATE player_footprints
				SET
					formatted_address = :formattedAddress,
					country = :country,
					province = :province,
					city = :city,
					district = :district,
					township = :township,
					street = :street,
					area_resolved = 1,
					area_resolve_attempts = area_resolve_attempts + 1,
					area_resolved_at = CURRENT_TIMESTAMP
				WHERE id = :id
			`,
			{
				id: row.id,
				formattedAddress: area.formattedAddress,
				country: area.country,
				province: area.province,
				city: area.city,
				district: area.district,
				township: area.township,
				street: area.street,
			},
		)
		return true
	} catch {
		await pool.execute(
			`
				UPDATE player_footprints
				SET area_resolve_attempts = area_resolve_attempts + 1
				WHERE id = :id
			`,
			{
				id: row.id,
			},
		)
		return false
	}
}
