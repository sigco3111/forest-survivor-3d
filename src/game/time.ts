import { computed, ref } from 'vue'

export type GameTimeConfig = {
	startYear: number
	daysPerYear: number
	initialDay: number
	initialHour: number
	initialMinute: number
	speedMultiplier: number
	dayStartsAt: number
	nightStartsAt: number
}

const SECONDS_PER_DAY = 86400

export function useGameTime(config: GameTimeConfig) {
	const totalSeconds = ref(
		((config.initialDay - 1) * 24 * 60 + config.initialHour * 60 + config.initialMinute) * 60,
	)
	const elapsedDays = computed(() => Math.floor(totalSeconds.value / SECONDS_PER_DAY))
	const year = computed(() => config.startYear + Math.floor(elapsedDays.value / config.daysPerYear))
	const dayOfYear = computed(() => (elapsedDays.value % config.daysPerYear) + 1)
	const secondsOfDay = computed(() => totalSeconds.value % SECONDS_PER_DAY)
	const hour = computed(() => Math.floor(secondsOfDay.value / 3600) % 24)
	const minute = computed(() => Math.floor((secondsOfDay.value % 3600) / 60))
	const second = computed(() => Math.floor(secondsOfDay.value % 60))
	const isDaytime = computed(
		() => hour.value >= config.dayStartsAt && hour.value < config.nightStartsAt,
	)
	const timeLabel = computed(
		() =>
			`${formatTimeUnit(hour.value)}:${formatTimeUnit(minute.value)}:${formatTimeUnit(second.value)}`,
	)
	const dateLabel = computed(() => `公元 ${year.value} 年 第 ${dayOfYear.value} 天`)
	const label = computed(() => `${dateLabel.value} ${timeLabel.value}`)

	let animationFrame = 0
	let lastRealTime = 0

	const start = () => {
		stop()
		lastRealTime = performance.now()

		const tick = (now: number) => {
			const elapsedRealSeconds = (now - lastRealTime) / 1000
			lastRealTime = now
			totalSeconds.value += elapsedRealSeconds * config.speedMultiplier
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
		dateLabel,
		dayOfYear,
		hour,
		isDaytime,
		label,
		timeLabel,
		year,
		start,
		stop,
	}
}

function formatTimeUnit(value: number) {
	return String(value).padStart(2, '0')
}
