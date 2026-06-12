import { computed, ref } from 'vue'

export type GameTimeConfig = {
	initialHour: number
	initialMinute: number
	speedMultiplier: number
	dayStartsAt: number
	nightStartsAt: number
}

const SECONDS_PER_DAY = 86400

export function useGameTime(config: GameTimeConfig) {
	const seconds = ref((config.initialHour * 60 + config.initialMinute) * 60)
	const hour = computed(() => Math.floor(seconds.value / 3600) % 24)
	const minute = computed(() => Math.floor((seconds.value % 3600) / 60))
	const second = computed(() => Math.floor(seconds.value % 60))
	const isDaytime = computed(
		() => hour.value >= config.dayStartsAt && hour.value < config.nightStartsAt,
	)
	const label = computed(
		() =>
			`${formatTimeUnit(hour.value)}:${formatTimeUnit(minute.value)}:${formatTimeUnit(second.value)}`,
	)

	let animationFrame = 0
	let lastRealTime = 0

	const start = () => {
		stop()
		lastRealTime = performance.now()

		const tick = (now: number) => {
			const elapsedRealSeconds = (now - lastRealTime) / 1000
			lastRealTime = now
			seconds.value = (seconds.value + elapsedRealSeconds * config.speedMultiplier) % SECONDS_PER_DAY
			animationFrame = window.requestAnimationFrame(tick)
		}

		animationFrame = window.requestAnimationFrame(tick)
	}

	const stop = () => {
		if (animationFrame) {
			window.cancelAnimationFrame(animationFrame)
			animationFrame = 0
		}
	}

	return {
		hour,
		isDaytime,
		label,
		start,
		stop,
	}
}

function formatTimeUnit(value: number) {
	return String(value).padStart(2, '0')
}
