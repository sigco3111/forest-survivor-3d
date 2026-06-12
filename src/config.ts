// 玩家模型配置：scale 是归一化后的目标高度（Three 场景单位）。
export const PLAYER_CONFIG = {
  url: "/models/player/player1.glb",
  scale: 6,
  rotationY: 0,
  walkStepDistanceMeters: 220, // 探索距离：220 单位
  walkSpeedMetersPerSecond: 18, // 基础速度：18 单位/秒
  collectTreeRadiusMeters: 18, // 玩家与树的距离 ≤ 18 时触发砍树
  chopTreeDurationMs: 2800,
};

// 树资源配置：使用确定性噪声生成，采集后枯树淡出并在随机位置重生。
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

// 枯树消失与重生配置
export const DEAD_TREE_CONFIG = {
  lingerMs: 10000,
  fadeMs: 2000,
  respawnMinSpacing: 80,
};

// 环境障碍物配置：flower/grass/plant 随机散落，玩家不可穿过。
export const ENVIRONMENT_CONFIG = {
  modelUrls: {
    flower: ["/models/environment/flower/1.glb", "/models/environment/flower/2.glb"],
    grass: ["/models/environment/grass/1.glb", "/models/environment/grass/2.glb"],
    plant: ["/models/environment/plant/1.glb", "/models/environment/plant/2.glb"],
  },
  seed: 4200,
  count: 200,
  radiusMeters: 900,
  scaleRange: [3, 8] as [number, number],
  collisionRadius: 6,
};
