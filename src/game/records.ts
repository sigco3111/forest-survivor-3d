/**
 * 최고 기록 저장: localStorage에 최고 생존 일차/처치 수를 보관한다.
 * language.ts와 동일한 storage 주입 패턴 (테스트에서 mock Storage 사용).
 */
export type BestRecord = { days: number; kills: number }

const STORAGE_KEY = 'forest-survivor-best'

export function loadBestRecord(storage: Pick<Storage, 'getItem'>): BestRecord | null {
	const raw = storage.getItem(STORAGE_KEY)
	if (!raw) return null
	try {
		const parsed = JSON.parse(raw) as Partial<BestRecord> | null
		if (parsed && typeof parsed.days === 'number' && typeof parsed.kills === 'number') {
			return { days: parsed.days, kills: parsed.kills }
		}
		return null
	} catch {
		return null
	}
}

/**
 * 기록을 저장하고 저장된 최고 기록을 반환한다.
 * 일차가 같으면 처치 수가 많은 쪽을 유지한다.
 */
export function saveBestRecord(
	storage: Pick<Storage, 'getItem' | 'setItem'>,
	record: BestRecord,
): BestRecord {
	const current = loadBestRecord(storage)
	const challengerWins =
		!current
		|| record.days > current.days
		|| (record.days === current.days && record.kills > current.kills)
	const best = challengerWins ? record : current
	storage.setItem(STORAGE_KEY, JSON.stringify(best))
	return best
}
