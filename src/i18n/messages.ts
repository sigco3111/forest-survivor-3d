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
			korean: '한국어',
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
			korean: '한국어',
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
	ko: {
		meta: {
			title: '숲의 생존자 3D',
			description: '차가운 밤이 오기 전에 충분한 나무를 모아 숲에서 살아남으세요.',
		},
		language: {
			label: '언어',
			english: 'English',
			chinese: '简体中文',
			korean: '한국어',
		},
		hud: {
			day: '{day}일차',
			wood: '나무',
			dailyUse: '매일 소모 -{count} 나무',
			lowWood: '나무 부족!',
			gameOver: '게임 오버',
			chopping: '벌목 중 {progress}%',
			approachTree: '나무에 다가가면 벌목을 시작합니다',
		},
		camera: {
			free: '자유 시점으로 전환',
			follow: '따라가기 시점으로 전환',
		},
		gameOver: {
			title: '게임 오버',
			survived: '{days}일 동안 살아남았습니다',
			exhausted: '나무가 떨어진 채로 추운 밤을 버티지 못하고 쓰러졌습니다.',
			restart: '다시 시작',
		},
	},
} as const

export type MessageSchema = typeof messages.en
