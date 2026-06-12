// 地图初始视角配置：中心点、缩放、俯仰和旋转角度。
export const MAP_CONFIG = {
	center: [120.1551, 30.2741] as [number, number],
	zoom: 15.8,
	pitch: 64,
	bearing: -18,
}

// 高德配置先集中存放，后续如果接高德服务或工具可以直接复用。
export const AMAP_CONFIG = {
	key: '95b533dc58b44f3cbae93cd9efff0858',
	securityJsCode: '6171dc6a7993ecde4079b2646d36f5bb',
}

// Mapbox 配置：矢量底图、3D 地形 DEM 和地形夸张倍率。
export const MAPBOX_CONFIG = {
	token: 'MAPBOX_ACCESS_TOKEN_REMOVED',
	style: 'mapbox://styles/mapbox/dark-v11',
	projection: 'mercator',
	terrainSource: 'mapbox-dem',
	terrainUrl: 'mapbox://mapbox.mapbox-terrain-dem-v1',
	terrainExaggeration: 1.8,
}

// 玩家模型配置：scale 是地图世界里的模型高度，terrainOffset 只做动态贴地后的脚底微调。
export const PLAYER_CONFIG = {
	url: '/models/Soldier.glb',
	scale: 60,
	terrainOffset: -30,
	rotationY: 180,
	headingOffset: 180,
	shadowOpacity: 0.58,
	shadowRadius: 90,
	walkStepDistanceMeters: 220,
	explorePulseRadiusMeters: 220,
	walkSpeedMetersPerSecond: 18,
	explorePulseDurationMs: 2400,
	explorePulseColor: '#35f4ff',
}

// 游戏时间配置：现实 1 秒会推进 speedMultiplier 秒游戏时间。
export const GAME_TIME_CONFIG = {
	startYear: 2100,
	daysPerYear: 365,
	initialDay: 1,
	initialHour: 14,
	initialMinute: 0,
	speedMultiplier: 1000,
	dayStartsAt: 6,
	nightStartsAt: 18,
}
