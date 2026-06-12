import { resolvePendingFootprintAreas } from '../utils/footprintAreaResolver'

const RESOLVE_INTERVAL_MS = 30_000

export default defineNitroPlugin(() => {
	if (import.meta.prerender) return

	let isRunning = false

	const run = async () => {
		if (isRunning) return
		isRunning = true

		try {
			await resolvePendingFootprintAreas()
		} catch (error) {
			console.warn('[footprints] batch area resolve failed', error)
		} finally {
			isRunning = false
		}
	}

	void run()
	const timer = setInterval(run, RESOLVE_INTERVAL_MS)
	timer.unref?.()
})
