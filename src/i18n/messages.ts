export const messages = {
	en: {
		meta: {
			title: 'Forest Survivor 3D',
			description: 'Survive the forest by gathering enough wood before each cold night.',
		},
		language: {
			label: 'Language',
			english: 'English',
			chinese: '简体中文',
		},
		hud: {
			day: 'Day {day}',
			wood: 'Wood',
			dailyUse: 'Daily use -{count} wood',
			lowWood: 'Low wood!',
			gameOver: 'Game over',
			chopping: 'Chopping {progress}%',
			approachTree: 'Approach a tree to start chopping',
		},
		camera: {
			free: 'Switch to free camera',
			follow: 'Switch to follow camera',
		},
		gameOver: {
			title: 'Game over',
			survived: 'You survived {days} days',
			exhausted: 'You ran out of wood and fell during the cold night.',
			restart: 'Restart',
		},
	},
	'zh-CN': {
		meta: {
			title: '森林生存者 3D',
			description: '在寒夜到来前收集足够木材，在森林中生存下去。',
		},
		language: {
			label: '语言',
			english: 'English',
			chinese: '简体中文',
		},
		hud: {
			day: '第 {day} 天',
			wood: '木材',
			dailyUse: '每日消耗 -{count} 木材',
			lowWood: '木材不足！',
			gameOver: '游戏结束',
			chopping: '伐木中 {progress}%',
			approachTree: '靠近树木开始伐木',
		},
		camera: {
			free: '切换自由视角',
			follow: '切换跟随视角',
		},
		gameOver: {
			title: '游戏结束',
			survived: '你存活了 {days} 天',
			exhausted: '木材耗尽，你在寒夜中倒下。',
			restart: '重新开始',
		},
	},
} as const

export type MessageSchema = typeof messages.en
