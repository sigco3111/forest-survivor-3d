// 玩家模型配置：scale 是 Three 场景里的模型高度。
export const PLAYER_CONFIG = {
  url: "/models/player/player1.glb",
  scale: 6,
  rotationY: 0,
  headingOffset: 0,
  walkStepDistanceMeters: 220,
  walkSpeedMetersPerSecond: 18,
  collectTreeRadiusMeters: 42,
  chopTreeDurationMs: 2800,
};

// 树资源配置：使用确定性噪声生成，采集后只在本次运行中消失。
export const TREE_RESOURCE_CONFIG = {
  deadModelUrls: [
    "/models/tree-dead/1.glb",
    "/models/tree-dead/2.glb",
    "/models/tree-dead/3.glb",
  ],
  modelUrls: ["/models/tree/1.glb", "/models/tree/2.glb", "/models/tree/3.glb"],
  seed: 2100,
  radiusMeters: 900,
  gridSize: 42,
  densityThreshold: 0.36,
  noiseScale: 0.12,
  maxTrees: 48,
  modelScale: 14,
  woodPerTree: 3,
};

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
};
