import { AMAP_CONFIG } from '../../src/config'

export type FootprintArea = {
	formattedAddress: string
	country: string
	province: string
	city: string
	district: string
	township: string
	street: string
}

type AmapRegeoResponse = {
	status: string
	info?: string
	regeocode?: {
		formatted_address?: string
		addressComponent?: {
			country?: string
			province?: string
			city?: string | string[]
			district?: string
			township?: string
			towncode?: string
			streetNumber?: {
				street?: string
				number?: string
			}
		}
	}
}

export async function resolveAmapArea(location: string): Promise<FootprintArea> {
	if (!/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(location)) {
		throw createError({
			statusCode: 400,
			statusMessage: 'Invalid location',
		})
	}

	const [lng, lat] = location.split(',').map(Number)
	const [amapLng, amapLat] = wgs84ToGcj02(lng, lat)
	const config = useRuntimeConfig()
	const key = config.amapWebServiceKey || process.env.AMAP_WEB_SERVICE_KEY || AMAP_CONFIG.key

	const response = await $fetch<AmapRegeoResponse>('https://restapi.amap.com/v3/geocode/regeo', {
		query: {
			key,
			location: `${amapLng},${amapLat}`,
			extensions: 'base',
			roadlevel: 0,
			radius: 100,
			output: 'json',
		},
	})

	if (response.status !== '1' || !response.regeocode) {
		const info = response.info || 'Amap regeo failed'
		const isPlatformMismatch = info === 'USERKEY_PLAT_NOMATCH'
		throw createError({
			statusCode: 502,
			statusMessage: isPlatformMismatch
				? 'AMAP_WEB_SERVICE_KEY must be a WebService key'
				: info,
		})
	}

	const component = response.regeocode.addressComponent ?? {}
	const street = component.streetNumber?.street || component.township || ''

	return {
		formattedAddress: response.regeocode.formatted_address || '',
		country: component.country || '',
		province: component.province || '',
		city: Array.isArray(component.city) ? '' : component.city || '',
		district: component.district || '',
		township: component.township || '',
		street,
	}
}

const EARTH_RADIUS = 6378245
const EE = 0.006693421622965943

function wgs84ToGcj02(lng: number, lat: number): [number, number] {
	if (isOutsideChina(lng, lat)) return [lng, lat]

	let deltaLat = transformLat(lng - 105, lat - 35)
	let deltaLng = transformLng(lng - 105, lat - 35)
	const radLat = (lat / 180) * Math.PI
	let magic = Math.sin(radLat)
	magic = 1 - EE * magic * magic
	const sqrtMagic = Math.sqrt(magic)
	deltaLat = (deltaLat * 180) / (((EARTH_RADIUS * (1 - EE)) / (magic * sqrtMagic)) * Math.PI)
	deltaLng = (deltaLng * 180) / ((EARTH_RADIUS / sqrtMagic) * Math.cos(radLat) * Math.PI)
	return [lng + deltaLng, lat + deltaLat]
}

function isOutsideChina(lng: number, lat: number) {
	return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}

function transformLat(lng: number, lat: number) {
	let result =
		-100 +
		2 * lng +
		3 * lat +
		0.2 * lat * lat +
		0.1 * lng * lat +
		0.2 * Math.sqrt(Math.abs(lng))
	result += ((20 * Math.sin(6 * lng * Math.PI) + 20 * Math.sin(2 * lng * Math.PI)) * 2) / 3
	result += ((20 * Math.sin(lat * Math.PI) + 40 * Math.sin((lat / 3) * Math.PI)) * 2) / 3
	result +=
		((160 * Math.sin((lat / 12) * Math.PI) + 320 * Math.sin((lat * Math.PI) / 30)) * 2) /
		3
	return result
}

function transformLng(lng: number, lat: number) {
	let result =
		300 +
		lng +
		2 * lat +
		0.1 * lng * lng +
		0.1 * lng * lat +
		0.1 * Math.sqrt(Math.abs(lng))
	result += ((20 * Math.sin(6 * lng * Math.PI) + 20 * Math.sin(2 * lng * Math.PI)) * 2) / 3
	result += ((20 * Math.sin(lng * Math.PI) + 40 * Math.sin((lng / 3) * Math.PI)) * 2) / 3
	result +=
		((150 * Math.sin((lng / 12) * Math.PI) + 300 * Math.sin((lng / 30) * Math.PI)) * 2) /
		3
	return result
}
