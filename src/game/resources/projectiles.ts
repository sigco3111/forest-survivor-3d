import type { PlanePoint } from './trees'
import type { StatusInfliction } from '../combat/status-effects'

export type ActiveProjectile = {
	id: number
	from: PlanePoint
	to: PlanePoint
	damage: number
	/** 0..1 비행 진행도 */
	progress: number
	/** 명중 시 대상에게 주입되는 상태이상 레시피 (미지정 = 없음). 불변 취급 */
	status?: StatusInfliction
}

export type ProjectileManagerConfig = {
	/** 단위/초 비행 속도 */
	speedUnitsPerSecond: number
}

/**
 * 악마 원거리 투사체의 순수 비행 수학만 담당하는 관리자다.
 * 씬 계층은 active() 위치를 렌더링하고, 도착 피해는 onHit 콜백으로 전달받는다.
 * 투사체에 상태이상 레시피가 실려 있으면 onHit가 damage와 함께 전달한다.
 */
export function createProjectileManager(
	config: ProjectileManagerConfig,
	deps: { onHit: (damage: number, status?: StatusInfliction) => void },
): {
	spawn(from: PlanePoint, to: PlanePoint, damage: number, status?: StatusInfliction): void
	/** deltaSeconds만큼 비행을 진행한다. 거리 0 투사체는 다음 update에서 즉시 명중한다.
	 * 한 프레임에 여러 개가 도착하면 생성(spawn) 순서대로 onHit가 호출된다. */
	update(deltaSeconds: number): void
	/** 활성 투사체의 새 얕은 복사 배열을 반환한다 — 반환값 조작이 내부 상태에 영향을 주지 않는다 */
	active(): readonly ActiveProjectile[]
	/** 모든 비행을 즉시 제거한다. 이때 onHit는 호출되지 않는다. */
	clear(): void
} {
	const projectiles: ActiveProjectile[] = []
	let nextId = 1

	function spawn(from: PlanePoint, to: PlanePoint, damage: number, status?: StatusInfliction): void {
		// 호출자 배열의 방어적 복사 — spawn 이후 외부 변경이 비행에 영향을 주지 않는다
		const start: PlanePoint = [from[0], from[1]]
		const end: PlanePoint = [to[0], to[1]]
		// 거리 0 투사체는 진행도 1로 시작해 다음 update에서 즉시 명중한다
		const progress = start[0] === end[0] && start[1] === end[1] ? 1 : 0
		projectiles.push({ id: nextId, from: start, to: end, damage, progress, status })
		nextId += 1
	}

	function update(deltaSeconds: number): void {
		const survivors: ActiveProjectile[] = []
		for (const projectile of projectiles) {
			// 아직 비행 중인 투사체만 전진시킨다 (거리 0 투사체는 이미 진행도 1)
			if (projectile.progress < 1) {
				const totalDistance = Math.hypot(
					projectile.to[0] - projectile.from[0],
					projectile.to[1] - projectile.from[1],
				)
				// 진행도 증분 = (속도 × 경과 시간) / 총거리, 상한 1로 클램프
				projectile.progress = Math.min(
					1,
					projectile.progress + (config.speedUnitsPerSecond * deltaSeconds) / totalDistance,
				)
			}
			if (projectile.progress >= 1) {
				// 순방향 순회이므로 같은 프레임 도착분도 생성 순서대로 명중한다.
				// 상태이상 유무로 인자 수를 유지한다 — 기존 소비자의 정확 인자 검증을 깨지 않는다.
				if (projectile.status !== undefined) deps.onHit(projectile.damage, projectile.status)
				else deps.onHit(projectile.damage)
				continue
			}
			survivors.push(projectile)
		}
		projectiles.length = 0
		projectiles.push(...survivors)
	}

	function active(): readonly ActiveProjectile[] {
		return [...projectiles]
	}

	function clear(): void {
		projectiles.length = 0
	}

	return { spawn, update, active, clear }
}
