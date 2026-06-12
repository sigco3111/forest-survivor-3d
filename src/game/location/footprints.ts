import { computed, ref } from 'vue'

import type { LngLat } from '../player/movement'

export type FootprintArea = {
	formattedAddress: string
	country: string
	province: string
	city: string
	district: string
	township: string
	street: string
}

export type FootprintRecord = {
	id: string
	position: LngLat
	traveledMeters: number
	gameDate: string
	gameTime: string
	recordedAt: number
	area: FootprintArea
	areaLabel: string
}

export type VisitedAreaArchive = FootprintArea & {
	id: string
	label: string
	count: number
	firstVisitedAt: number
	lastVisitedAt: number
}

export type FootprintArchiveConfig = {
	intervalSeconds: number
	maxItems: number
}

type FootprintSnapshot = {
	position: LngLat
	traveledMeters: number
	gameDate: string
	gameTime: string
	recordedAt: number
}

type SavedFootprintResponse = {
	id: number
	position: LngLat
	traveledMeters: number
	gameDate: string
	gameTime: string
	recordedAt: number
	area: FootprintArea
}

export function useFootprintArchive(config: FootprintArchiveConfig) {
	const footprints = ref<FootprintRecord[]>([])
	const isResolving = ref(false)
	const error = ref('')
	const latestFootprint = computed(() => footprints.value[0] ?? null)
	const visitedAreas = computed(() => archiveVisitedAreas(footprints.value))

	const pendingSnapshots: FootprintSnapshot[] = []
	let lastRecordTime = 0

	const load = async () => {
		try {
			const savedFootprints = await $fetch<SavedFootprintResponse[]>('/api/footprints')
			error.value = ''
			footprints.value = savedFootprints.map(createFootprintRecord)
		} catch {
			error.value = '足迹读取失败'
		}
	}

	const record = (
		position: LngLat,
		traveledMeters: number,
		gameDate: string,
		gameTime: string,
		now = performance.now(),
	) => {
		if (lastRecordTime && now - lastRecordTime < config.intervalSeconds * 1000) {
			return
		}

		lastRecordTime = now
		pendingSnapshots.push({
			position: [...position],
			traveledMeters,
			gameDate,
			gameTime,
			recordedAt: Date.now(),
		})

		if (pendingSnapshots.length > 4) {
			pendingSnapshots.splice(0, pendingSnapshots.length - 4)
		}

		void resolveNextSnapshot()
	}

	const resolveNextSnapshot = async () => {
		if (isResolving.value || pendingSnapshots.length === 0) return

		const snapshot = pendingSnapshots.shift()
		if (!snapshot) return

		isResolving.value = true

		try {
			const savedFootprint = await $fetch<SavedFootprintResponse>('/api/footprints', {
				method: 'POST',
				body: {
					playerId: 'default',
					position: snapshot.position,
					traveledMeters: snapshot.traveledMeters,
					gameDate: snapshot.gameDate,
					gameTime: snapshot.gameTime,
				},
			})
			error.value = ''
			footprints.value = [createFootprintRecord(savedFootprint), ...footprints.value].slice(
				0,
				config.maxItems,
			)
		} catch {
			error.value = '足迹归档失败'
		} finally {
			isResolving.value = false
			if (pendingSnapshots.length > 0) {
				void resolveNextSnapshot()
			}
		}
	}

	return {
		error,
		footprints,
		isResolving,
		latestFootprint,
		load,
		record,
		visitedAreas,
	}
}

function createFootprintRecord(savedFootprint: SavedFootprintResponse): FootprintRecord {
	return {
		position: savedFootprint.position,
		traveledMeters: savedFootprint.traveledMeters,
		gameDate: savedFootprint.gameDate,
		gameTime: savedFootprint.gameTime,
		recordedAt: savedFootprint.recordedAt,
		area: savedFootprint.area,
		areaLabel: createAreaLabel(savedFootprint.area),
		id: String(savedFootprint.id),
	}
}

function archiveVisitedAreas(footprints: FootprintRecord[]) {
	const areaMap = new Map<string, VisitedAreaArchive>()

	for (const footprint of footprints) {
		const id = createAreaId(footprint.area)
		if (!id) continue

		const current = areaMap.get(id)
		if (current) {
			current.count += 1
			current.lastVisitedAt = Math.max(current.lastVisitedAt, footprint.recordedAt)
			continue
		}

		areaMap.set(id, {
			...footprint.area,
			id,
			label: footprint.areaLabel,
			count: 1,
			firstVisitedAt: footprint.recordedAt,
			lastVisitedAt: footprint.recordedAt,
		})
	}

	return Array.from(areaMap.values()).sort((a, b) => b.lastVisitedAt - a.lastVisitedAt)
}

function createAreaId(area: FootprintArea) {
	return [
		area.country,
		area.province,
		area.city,
		area.district,
	]
		.filter(Boolean)
		.join('/')
}

function createAreaLabel(area: FootprintArea) {
	const province = area.province === area.city ? '' : area.province
	const label = [
		area.country,
		province,
		area.city,
		area.district,
	]
		.filter(Boolean)
		.join(' / ')
	return label || '待解析区域'
}
