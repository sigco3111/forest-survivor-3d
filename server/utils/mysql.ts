import mysql from 'mysql2/promise'

let pool: mysql.Pool | null = null
let schemaReady: Promise<void> | null = null

export function getMysqlPool() {
	if (pool) return pool

	const config = useRuntimeConfig()
	const host = config.mysqlHost || process.env.MYSQL_HOST
	const port = Number(config.mysqlPort || process.env.MYSQL_PORT || 3306)
	const user = config.mysqlUser || process.env.MYSQL_USER
	const password = config.mysqlPassword || process.env.MYSQL_PASSWORD
	const database = config.mysqlDatabase || process.env.MYSQL_DATABASE

	if (!host || !user || !password || !database) {
		throw createError({
			statusCode: 500,
			statusMessage: 'MySQL config is missing',
		})
	}

	pool = mysql.createPool({
		host,
		port,
		user,
		password,
		database,
		waitForConnections: true,
		connectionLimit: 6,
		namedPlaceholders: true,
		charset: 'utf8mb4',
	})

	return pool
}

export async function ensureFootprintSchema() {
	if (!schemaReady) {
		schemaReady = getMysqlPool()
			.execute(`
				CREATE TABLE IF NOT EXISTS player_footprints (
					id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
					player_id VARCHAR(64) NOT NULL DEFAULT 'default',
					lng DECIMAL(11, 7) NOT NULL,
					lat DECIMAL(10, 7) NOT NULL,
					traveled_meters DECIMAL(12, 2) NOT NULL,
					game_date VARCHAR(32) NOT NULL,
					game_time VARCHAR(16) NOT NULL,
					formatted_address VARCHAR(255) NOT NULL DEFAULT '',
					country VARCHAR(64) NOT NULL DEFAULT '',
					province VARCHAR(64) NOT NULL DEFAULT '',
					city VARCHAR(64) NOT NULL DEFAULT '',
					district VARCHAR(64) NOT NULL DEFAULT '',
					township VARCHAR(128) NOT NULL DEFAULT '',
					street VARCHAR(128) NOT NULL DEFAULT '',
					area_resolved TINYINT(1) NOT NULL DEFAULT 0,
					area_resolve_attempts INT UNSIGNED NOT NULL DEFAULT 0,
					area_resolved_at TIMESTAMP NULL DEFAULT NULL,
					created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
					INDEX idx_player_created_at (player_id, created_at),
					INDEX idx_area_resolved (area_resolved, area_resolve_attempts, id),
					INDEX idx_area (country, province, city, district)
				) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
			`)
			.then(() => ensureFootprintSchemaColumns())
			.then(() => undefined)
	}

	await schemaReady
}

async function ensureFootprintSchemaColumns() {
	const pool = getMysqlPool()
	await addColumnIfMissing(
		pool,
		'area_resolved',
		'area_resolved TINYINT(1) NOT NULL DEFAULT 0',
	)
	await addColumnIfMissing(
		pool,
		'area_resolve_attempts',
		'area_resolve_attempts INT UNSIGNED NOT NULL DEFAULT 0',
	)
	await addColumnIfMissing(
		pool,
		'area_resolved_at',
		'area_resolved_at TIMESTAMP NULL DEFAULT NULL',
	)
}

async function addColumnIfMissing(pool: mysql.Pool, columnName: string, columnDefinition: string) {
	const [rows] = await pool.execute<mysql.RowDataPacket[]>(
		`
			SELECT COUNT(*) AS count
			FROM INFORMATION_SCHEMA.COLUMNS
			WHERE TABLE_SCHEMA = DATABASE()
				AND TABLE_NAME = 'player_footprints'
				AND COLUMN_NAME = :columnName
		`,
		{ columnName },
	)

	if (Number(rows[0]?.count ?? 0) > 0) return

	await pool.execute(`ALTER TABLE player_footprints ADD COLUMN ${columnDefinition}`)
}
