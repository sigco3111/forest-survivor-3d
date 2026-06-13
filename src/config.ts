// 玩家模型配置：scale 是归一化后的目标高度（Three 场景单位）。
export const PLAYER_CONFIG = {
  url: "/models/player/player1.glb",
  scale: 6,
  rotationY: 0,
  walkStepDistanceMeters: 220, // 探索距离：220 单位
  walkSpeedMetersPerSecond: 24, // 基础速度：24 单位/秒
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
  maxTrees: 48, // 最大树木数量
  modelScale: 14,
  woodPerTree: 3,
};

// 枯树消失与重生配置
export const DEAD_TREE_CONFIG = {
  lingerMs: 5000, // 枯树持续时间：5 秒
  fadeMs: 2000, // 枯树淡出时间
  respawnMinSpacing: 80, // 新树与最近树的最小间距
};

// 环境障碍物配置：flower/grass/plant 随机散落，玩家不可穿过。
export const ENVIRONMENT_CONFIG = {
  modelUrls: {
    flower: ["/models/environment/flower/1.glb", "/models/environment/flower/2.glb"],
    grass: ["/models/environment/grass/1.glb", "/models/environment/grass/2.glb"],
    plant: ["/models/environment/plant/1.glb", "/models/environment/plant/2.glb"],
  },
  seed: 4200,
  count: 200, // 环境物总数量
  radiusMeters: 900,
  scaleRange: [3, 8] as [number, number],
  collisionRadius: 6,
};

// 昼夜循环：1 分钟 = 游戏内 1 天
export const DAY_CYCLE_CONFIG = {
  realMsPerDay: 60_000,        // 1 分钟 = 1 游戏天
  woodConsumedPerDay: 5,       // 每天消耗 5 木头
}

// 怪物看管植物配置
export const MONSTER_GUARDIAN_CONFIG = {
  guardianDetectionRadius: 135,  // 玩家砍树时怪物的警觉范围
  tendPlantRadius: 120,          // 怪物寻找种植点的搜索半径
  tendPlantDurationMs: 4000,     // 种植动作持续时间
  plantTreeRadius: 30,           // 怪物种出的树之间的最小间距
}

// 怪物配置：看管植物 AI
export const MONSTER_CONFIG = {
  modelUrls: [
    "/models/monster/1.glb",
    "/models/monster/Giant.glb",
    "/models/monster/Goblin.glb",
    "/models/monster/Skeleton.glb",
    "/models/monster/Yeti.glb",
    "/models/monster/Zombie.glb",
  ],
  seed: 7300,
  count: 15, // 怪物总数量
  radiusMeters: 900,
  modelScale: 6,
  scaleRange: [0.8, 1.2] as [number, number],
  patrolRadius: 80,
  speed: 22,
  detectionRadius: 120,
  attackRadius: 20,
  activityRadius: 170,
  health: 100,
  attackDamage: 10,
  attackCooldownMs: 1500,
};
