import type { PlanePoint } from './trees'

export type BuildingType = 'campfire' | 'fence'

export type Building = {
	id: string
	type: BuildingType
	position: PlanePoint
	bearing: number // 울타리 접선 방향(라디안). 모닥불은 0.
	segmentIndex: number // 울타리 세그먼트 번호(0 = 출입문이라 차단하지 않음). 모닥불은 -1.
	builtDay: number
}

export type PersistedBuilding = {
	type: BuildingType
	position: PlanePoint
	bearing: number
	segmentIndex: number
	builtDay: number
}

export type BuildingManagerConfig = {
	campfireMinDay: number
	campfireCostWood: number
	campfireMaxCount: number
	campfireLightRadius: number
	campfireDetectionFactor: number // 빛 반경 안 실효 탐지 배율 (곱산)
	detectionFactorFloor: number // 중첩 하한
	buildCooldownDays: number
	fenceSegments: number
	fenceCostPerSegment: number
	fenceRingRadius: number
	fenceBlockRadius: number
}

export type BuildContext = {
	day: number
	wood: number // 현재 보유 나무 (차감은 호출자가 woodSpent로 수행)
	reserveWood: number // 건설 후에도 남겨야 하는 비축
	playerPosition: PlanePoint
}

export type BuildResult = { built: Building[]; woodSpent: number }

export function createBuildingManager(config: BuildingManagerConfig): {
	readonly buildings: readonly Building[]
	maybeBuild(ctx: BuildContext): BuildResult
	detectionMultiplierAt(position: PlanePoint): number
	blocks(position: PlanePoint): boolean
	snapshot(): PersistedBuilding[]
	restore(list: readonly PersistedBuilding[]): void
} {
	const buildings: Building[] = []
	// 첫 건설 가능 일부터 쿨다운이 막지 않도록 -Infinity로 초기화한다.
	let lastBuildDay = Number.NEGATIVE_INFINITY
	// 모든 건물에 걸쳐 단일 증가 카운터(id는 `${type}-${n}`, n은 1부터).
	let nextIdNumber = 1

	function allocateId(type: BuildingType): string {
		const id = `${type}-${nextIdNumber}`
		nextIdNumber += 1
		return id
	}

	// position은 항상 방어 복사본으로 저장한다(외부 변경이 건물에 영향 주지 않음).
	function makeBuilding(
		type: BuildingType,
		position: PlanePoint,
		bearing: number,
		segmentIndex: number,
		builtDay: number,
	): Building {
		return {
			id: allocateId(type),
			type,
			position: [position[0], position[1]],
			bearing,
			segmentIndex,
			builtDay,
		}
	}

	function maybeBuild(ctx: BuildContext): BuildResult {
		// 쿨다운 게이트가 최우선이다. 여기서 걸리면 무엇도 하지 않는다.
		if (ctx.day - lastBuildDay < config.buildCooldownDays) {
			return { built: [], woodSpent: 0 }
		}

		// 모닥불 게이트: 최대 개수 / 최소 일차 / 비축 목재를 모두 충족해야 한다.
		// 하나라도 불가능하면 울타리 없이 전체 중단하며, 이때 쿨다운은 소모되지 않는다.
		let campfireCount = 0
		for (const building of buildings) {
			if (building.type === 'campfire') campfireCount += 1
		}
		if (
			campfireCount >= config.campfireMaxCount
			|| ctx.day < config.campfireMinDay
			|| ctx.wood - config.campfireCostWood < ctx.reserveWood
		) {
			return { built: [], woodSpent: 0 }
		}

		const built: Building[] = []
		let spent = 0

		// 모닥불은 플레이어 위치의 복사본에 세우고, 방위 0 / 세그먼트 -1로 기록한다.
		const campfire = makeBuilding('campfire', ctx.playerPosition, 0, -1, ctx.day)
		built.push(campfire)
		spent += config.campfireCostWood
		// 실제 건설에 성공했을 때만 쿨다운을 소모한다.
		lastBuildDay = ctx.day

		// 울타리는 이 호출에서 모닥불이 성공한 경우에만 세운다.
		// 세그먼트 0은 출입문이므로 절대 짓지 않는다(1부터 마지막까지).
		const [centerX, centerZ] = campfire.position
		for (let i = 1; i < config.fenceSegments; i++) {
			// 이 울타리까지 지은 뒤에도 비축이 유지되는지 먼저 확인한다.
			// 유지되지 않으면 루프를 중단하고 이후 세그먼트는 짓지 않는다.
			const remainingAfterThisFence = ctx.wood - spent - config.fenceCostPerSegment
			if (remainingAfterThisFence < ctx.reserveWood) break

			// 각도 공식: angle = (i / fenceSegments) × 2π (0이 출입문, 반시계 방향 배치).
			const angle = (i / config.fenceSegments) * Math.PI * 2
			const position: PlanePoint = [
				centerX + Math.cos(angle) * config.fenceRingRadius,
				centerZ + Math.sin(angle) * config.fenceRingRadius,
			]
			// bearing은 원의 접선 방향(진행 방향에 수직) = angle + π/2.
			built.push(makeBuilding('fence', position, angle + Math.PI / 2, i, ctx.day))
			spent += config.fenceCostPerSegment
		}

		// 이번 호출에 지어진 건물을 관리자 상태에도 등록한다.
		for (const building of built) buildings.push(building)

		return { built, woodSpent: spent }
	}

	function detectionMultiplierAt(position: PlanePoint): number {
		// 빛 반경 안의 모닥불 개수만큼 탐지 배율을 곱한다. 근처에 없으면 곱셈 항등원 1.
		let product = 1
		for (const building of buildings) {
			if (building.type !== 'campfire') continue
			const dx = building.position[0] - position[0]
			const dz = building.position[1] - position[1]
			// 유클리드 거리 판정은 제곱합 비교로 수행(루트 생략, 결정론적 부동소수점).
			if (dx * dx + dz * dz <= config.campfireLightRadius * config.campfireLightRadius) {
				product *= config.campfireDetectionFactor
			}
		}
		// 중첩이 아무리 커도 하한(floor)보다 작아지지 않도록 클램프한다.
		return Math.max(config.detectionFactorFloor, product)
	}

	function blocks(position: PlanePoint): boolean {
		return buildings.some((building) => {
			// 모닥불은 절대 통행을 막지 않고, 울타리만 판단한다.
			if (building.type !== 'fence') return false
			// 출입문 세그먼트(0)는 울타리라도 막지 않는다.
			if (building.segmentIndex === 0) return false
			const dx = building.position[0] - position[0]
			const dz = building.position[1] - position[1]
			return dx * dx + dz * dz <= config.fenceBlockRadius * config.fenceBlockRadius
		})
	}

	function snapshot(): PersistedBuilding[] {
		// 깊은 복사본(평면 배열)을 돌려준다. 스냅샷 조작이 내부 상태에 영향 없다.
		return buildings.map(building => ({
			type: building.type,
			position: [building.position[0], building.position[1]],
			bearing: building.bearing,
			segmentIndex: building.segmentIndex,
			builtDay: building.builtDay,
		}))
	}

	function restore(list: readonly PersistedBuilding[]): void {
		// 기존 건물을 모두 버리고 방어 복사본으로 대체한다.
		buildings.length = 0
		list.forEach((persisted, index) => {
			buildings.push({
				id: `${persisted.type}-${index + 1}`,
				type: persisted.type,
				position: [persisted.position[0], persisted.position[1]],
				bearing: persisted.bearing,
				segmentIndex: persisted.segmentIndex,
				builtDay: persisted.builtDay,
			})
		})
		// id 카운터는 복원된 개수 바로 다음 번호부터 이어진다.
		nextIdNumber = list.length + 1
	}

	return {
		buildings,
		maybeBuild,
		detectionMultiplierAt,
		blocks,
		snapshot,
		restore,
	}
}
