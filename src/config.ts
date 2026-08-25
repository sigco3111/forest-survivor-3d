// 玩家模型配置：scale 是归一化后的目标高度（Three 场景单位）。
export const PLAYER_CONFIG = {
  url: "/models/player/player1.glb",
  scale: 6,
  rotationY: 0,
  walkStepDistanceMeters: 220, // 探索距离：220 单位
  walkSpeedMetersPerSecond: 24, // 基础速度：24 单位/秒
  collectTreeRadiusMeters: 18, // 玩家与树的距离 ≤ 18 时触发砍树
  chopTreeDurationMs: 2800,
  attackRangeMeters: 20, // 玩家攻击怪物的距离
  attackDamageMs: 600, // 攻击挥砍动画耗时（毫秒）
  attackCooldownMs: 1500, // 攻击之间的冷却时间（毫秒）
  maxHealth: 100, // 플레이어 최대 체력. 몬스터 공격 = HP 데미지, HP 0 = 사망
  killHealHealth: 15, // 몬스터 처치 시 체력 회복량 (적극적인 전투가 생존 전략이 되도록)
  regenHealthAmount: 2, // 비전투 중 체력 회복량 (틱당)
  regenIntervalMs: 1000, // 비전투 체력 회복 틱 간격
  criticalHealthRatio: 0.25, // 위기 체력 비율: 이하로 내려가면 교전을 접고 도주한다
  fleeSafeDistanceMeters: 250, // 이 거리만큼 벗어나면 도망을 종료하고 회복한다 (보스 장기 추격 대비)
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

// 성장 설정: 몬스터 처치 경험치 → 레벨업 스탯 증가
export const PROGRESSION_CONFIG = {
  expBase: 100,        // 2레벨까지 필요 경험치
  expGrowth: 1.6,      // 레벨별 필요 경험치 증가율
  levelAttackBonus: 3, // 레벨당 공격력 증가
  levelHealthBonus: 20, // 레벨당 최대 체력 증가 (동시에 회복)
  levelSpeedBonus: 1,  // 레벨당 이동속도 증가
  huntScanRangePerLevel: 20, // 레벨당 선제공격 스캔 범위 추가 (성장할수록 더 멀리서 사냥)
};

// 무기 강화: 나무를 소비해 영구 전투력/공격력으로 전환한다 (성장의 두 번째 축)
export const WEAPON_CONFIG = {
  upgradeCostBase: 30,     // 첫 강화 비용 (나무)
  upgradeCostGrowth: 1.5,  // 강화 비용 증가율 (30 → 45 → 68 ...)
  attackPerTier: 6,        // 티어당 공격력 증가
  powerPerTier: 40,        // 티어당 전투력 증가 (소비한 나무보다 크게 — 강화가 항상 이득)
  reserveWood: 10,         // 강화 후에도 유지할 비상 나무 (자동 강화가 비축을 갈취하지 않도록)
};

// 자동 스킬: 레벨 해금 + 쿨다운 자동 시전 (관전 재미의 고점)
export const SKILL_CONFIG = {
  // 광역 강타: 교전 중 주변 모든 적을 타격
  slamUnlockLevel: 2,
  slamCooldownMs: 8000,
  slamRadius: 90,
  slamDamageMultiplier: 1.5,
  // 분노: 교전 중 자발 발동 — 스윙 간격 감소 (공속 증가)
  furyUnlockLevel: 4,
  furyCooldownMs: 15_000,
  furyDurationMs: 5000,
  furySwingMultiplier: 0.5,
  // 생명 흡수: 피해량 일부 회복 (패시브)
  leechUnlockLevel: 6,
  leechRatio: 0.3,
};

// ===== Tier 2: 스킬트리 (3 브랜치 × 3 노드) =====
// 레벨 임계 도달 시 자동으로 노드가 해금되어 누적 효과를 받는다. 같은 노드는 중복 발동되지 않는다.
export const SKILL_TREE_CONFIG = {
  branches: {
    attack: {
      label: 'attack',
      nodes: [
        // Lv 3: 광역 강타 강화 (쿨다운 30% 감소)
        { id: 'attack.slam.cooldown', unlockLevel: 3, effects: { slamCooldownMultiplier: 0.7 } },
        // Lv 6: 분노 강화 (분노 지속 시간 +50%)
        { id: 'attack.fury.extend', unlockLevel: 6, effects: { furyDurationMultiplier: 1.5 } },
        // Lv 10: 임팩트 (일반 공격에 5% 추가 고정 피해)
        { id: 'attack.impact', unlockLevel: 10, effects: { bonusFlatDamage: 4 } },
      ],
    },
    defense: {
      label: 'defense',
      nodes: [
        // Lv 4: 회피 (피격 시 10% 확률 무효)
        { id: 'defense.dodge', unlockLevel: 4, effects: { dodgeChance: 0.1 } },
        // Lv 7: 강인함 (받는 피해 12% 감소)
        { id: 'defense.bulwark', unlockLevel: 7, effects: { damageTakenMultiplier: 0.88 } },
        // Lv 12: 재생 (비전투 회복 1 추가)
        { id: 'defense.regen', unlockLevel: 12, effects: { extraRegenBonus: 1 } },
      ],
    },
    utility: {
      label: 'utility',
      nodes: [
        // Lv 5: 채집 확대 (수집 반경 1.5배)
        { id: 'utility.magnet', unlockLevel: 5, effects: { collectRadiusMultiplier: 1.5 } },
        // Lv 8: 본능 (선제공격 스캔 범위 +30%)
        { id: 'utility.instinct', unlockLevel: 8, effects: { scanRangeMultiplier: 1.3 } },
        // Lv 11: 결의 (위기 체력에서 도주하지 않음 — 보스처럼 맞서기)
        { id: 'utility.resolve', unlockLevel: 11, effects: { suppressFlee: true } },
      ],
    },
  },
};

// 昼夜循环：1 分钟 = 游戏内 1 天
export const DAY_CYCLE_CONFIG = {
  realMsPerDay: 60_000,        // 1 分钟 = 1 游戏天
  woodConsumedPerDay: 5,       // 每天消耗 5 木头
}

// ===== Tier 1: 레벨업 자동 카드 3택 =====
// 매 레벨업마다 풀에서 후보 3장을 결정론 추출하고, preset 친화도와 카드 가중치 곱으로
// 가장 점수 높은 카드를 자동 채택한다 (관전자가 빌드 방향을 읽을 수 있도록).
export const LEVEL_UP_CONFIG = {
  cardCount: 3,
  // 카드 풀. effects 값들은 모두 "config 단위" 보너스.
  pool: [
    { id: 'attack', pickWeight: 1.0, effects: { attackBonus: 5 } },
    { id: 'health', pickWeight: 1.0, effects: { healthBonus: 30 } },
    { id: 'speed',  pickWeight: 0.8, effects: { speedBonus: 1 } },
    { id: 'crit',   pickWeight: 0.6, effects: { critChanceBonus: 0.04 } },
    { id: 'regen',  pickWeight: 0.6, effects: { regenBonus: 1 } },
    { id: 'scan',   pickWeight: 0.8, effects: { scanBonus: 12 } },
  ],
  // 성향 친화도: 카드 점수 = pickWeight × affinity. 1.0 = 중립.
  presetAffinity: {
    aggressive: { attack: 1.6, health: 0.7, speed: 1.3, crit: 1.5, regen: 0.6, scan: 1.3 },
    balanced:   { attack: 1.0, health: 1.0, speed: 1.0, crit: 1.0, regen: 1.0, scan: 1.0 },
    survivor:   { attack: 0.7, health: 1.5, speed: 0.8, crit: 0.8, regen: 1.4, scan: 0.8 },
  },
}

// ===== Tier 1: 종족 숙련도 카운터 =====
// 같은 종족을 일정 수만큼 처치하면 영구 보너스가 누적된다. 카운터 자체는 런 한정.
export const MASTERY_CONFIG = {
  thresholds: [
    { count: 5,  bonus: { scanBonus: 15 } },
    { count: 15, bonus: { critChanceBonus: 0.03 } },
    { count: 30, bonus: { attackBonus: 3 } },
    { count: 50, bonus: { damageTakenMultiplier: 0.92 } },
  ],
  bossThresholds: [
    { count: 1, bonus: { critMultiplierBonus: 0.3 } },
    { count: 3, bonus: { scanBonus: 25 } },
    { count: 5, bonus: { damageTakenMultiplier: 0.9 } },
  ],
}

// 전투 성향 설정: 플레이어가 자신보다 약한 적을 선제공격하는 호전성 튜닝.
// 전투력 비교: playerPower = playerBasePower + wood × powerPerWood
//             threatStrength = health × monsterHealthPowerWeight + attackDamage × monsterAttackPowerWeight
// threatStrength < playerPower 인 적을 "약한 적"으로 간주하고 먼저 추격/공격한다.
export const COMBAT_AGGRESSION_CONFIG = {
  playerBasePower: 40,            // 플레이어 기본 전투력
  powerPerWood: 1,                // 나무 1개당 전투력 증가량
  monsterHealthPowerWeight: 0.35, // 몬스터 체력 → 위협 전투력 가중치
  monsterAttackPowerWeight: 1.5,  // 몬스터 공격력 → 위협 전투력 가중치
  huntAggroRangeMultiplier: 4,    // 선제공격 스캔 범위 = attackRangeMeters × 4 = 80
  huntGiveUpRangeMultiplier: 6,   // 추격 포기 범위 = attackRangeMeters × 6 = 120
};

// 怪物看管植物配置
export const MONSTER_GUARDIAN_CONFIG = {
  guardianDetectionRadius: 135,  // 玩家砍树时怪物的警觉范围
  nightDetectionMultiplier: 1.5, // 밤에는 경계 범위 확대 (야간 위험도)
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
  count: 20, // 怪物总数量 (조우율 확보를 위해 유지 — 리스폰 상한이기도 하다)
  radiusMeters: 900,
  modelScale: 6,
  scaleRange: [0.8, 1.2] as [number, number],
  patrolRadius: 110,
  speed: 22,
  detectionRadius: 120,
  attackRadius: 20,
  activityRadius: 170,
  health: 100,
  attackDamage: 10,
  attackCooldownMs: 1500,
  hitStunMs: 700, // 怪物被玩家击中后的硬直时间（毫秒）
  // 모델별 강도 배율: 체력/공격력에 곱해져 약한 적(고블린)과 강한 적(거인)이 섞인다.
  // 미등록 모델은 배율 1.0 적용. seed 기반 생성이므로 여전히 결정론적.
  strengthMultipliers: {
    Goblin: 0.65,
    Skeleton: 0.9,
    Zombie: 0.9,
    Yeti: 1.1,
    Giant: 1.4,
    Demon: 1.4,
  } as Record<string, number>,
  // 리스폰 몬스터 스케일링: 경과 일차당 체력/공격력 증가율 (선형)
  dayScalePerDay: 0.15,
  // 사망 연출 유지 시간 (이후 시체 정리)
  deathAnimMs: 1200,
  // 보스: bossIntervalDays마다 스폰. 체력/공격력 배율은 모델 강도에 추가 곱산.
  // 20~30초짜리 전투가 되도록 조정 — 너무 높으면 게이지가 움직이지 않는다.
  bossIntervalDays: 5,
  bossHealthMultiplier: 2,
  bossDamageMultiplier: 0.8,
  bossRewardWood: 60,
  // 팩 응집: 피격당한 몬스터 주변 같은 종족을 자극해 함께 추격
  packAggroRadius: 100,
  packAggroDurationMs: 8000,
  // 종족 특수화 — 소심함(도주) 커브
  fleeSafeDistanceMultiplier: 1.8, // 도주 종료 거리 = 탐지 반경 × 이 배율
  cowerDurationMs: 9000,           // 도주 종료 후 이 시간까지 재추격하지 않는다 (겁먹은 상태)
  // 종족별 행동 특화: 같은 스탯이라도 느낌이 다르게 (미등록 종족은 배율 1)
  // - fleeHealthRatio: 체력이 이 비율 이하로 깎이면 도주한다 (겁 많은 종족)
  // - ranged: 이 사거리에서 멈춰 투사체를 날린다 (원거리 종족)
  speciesBehavior: {
    Goblin: { speedMultiplier: 1.25, attackCooldownMultiplier: 0.8, fleeHealthRatio: 0.35 },
    Skeleton: { speedMultiplier: 0.85, attackDamageMultiplier: 1.5 },
    Zombie: {},
    Yeti: { speedMultiplier: 1.35 },
    Giant: { attackDamageMultiplier: 1.3, attackCooldownMultiplier: 1.3 },
    Demon: { detectionMultiplier: 1.3, ranged: { range: 70, projectileSpeed: 110 } },
  } as Record<string, import('~/game/resources/monsters').SpeciesBehavior>,
};

// ===== 2·3단계 고도화: 일일 이벤트 / 성향 프리셋 / 카메라 연출 / 건축 =====

// 일일 이벤트 스케줄러: day별 이벤트를 seed 기반으로 결정론 산출한다.
// 밤습격 = raidFirstDay 이상 & day % raidIntervalDays === 0 인 날 해질녘에 몬스터 무리가 습격한다.
export const EVENT_CONFIG = {
  seed: 9900,
  raidFirstDay: 5,
  raidIntervalDays: 5,
  raidBaseCount: 3,             // 첫 습격 규모
  raidCountGrowthPerDay: 0.4,   // 경과 일차당 습격 규모 증가
  goldenTreeChance: 0.4,        // 하루당 황금 나무 등장 확률 (seeded)
  goldenTreeWoodBonus: 12,      // 황금 나무 벌목 보너스 나무
};

// 성향 프리셋: 레벨업 스탯 분배 가중치. 플레이어는 시작 시 3택하고 이후 자동 성장한다.
export const PRESET_CONFIG = {
  aggressive: { attackWeight: 2, healthWeight: 0.6, speedWeight: 1.4, scanWeight: 2, regenBonus: 0 },
  balanced: { attackWeight: 1, healthWeight: 1, speedWeight: 1, scanWeight: 1, regenBonus: 0 },
  survivor: { attackWeight: 0.6, healthWeight: 1.8, speedWeight: 0.7, scanWeight: 0.5, regenBonus: 2 },
} as Record<
  import('~/game/player/agent').PlayerPresetId,
  import('~/game/player/agent').PresetWeights
>;

// 카메라 연출 감독: 교전 줌인/보스 인트로 셰이크/위기 비네트 강도를 순수 수학으로 산출한다.
export const CAMERA_DIRECTOR_CONFIG = {
  followLerpPerSecond: 6,        // 줌 배율 보간 속도 (1/초)
  combatZoomScale: 0.75,         // 교전 중 카메라 거리 배율 (줌인)
  bossZoomScale: 0.85,           // 보스 교전 중 거리 배율
  crisisVignetteRatio: 0.4,      // HP 비율이 이하로 내려가면 비네트 시작
  maxVignetteIntensity: 0.85,    // 비네트 최대 불투명도
  shakeDecayPerSecond: 1.8,      // 셰이크 강도 초당 감쇠
  bossIntroShakeIntensity: 1,    // 보스 등장 셰이크 초기 강도
  hitShakeIntensity: 0.35,       // 피격 셰이크 초기 강도
  hitShakeDurationMs: 350,       // 피격 셰이크 지속 시간
  focusBlendRatio: 0.35,         // 포커스 = 플레이어↔위협 중점 블렌드 비율
};

// 건축: 목재를 소비해 모닥불(야간 탐지 감쇠)과 울타리(몬스터 우회 유도)를 자동 건설한다.
// 배치는 전부 결정론적 — 모닥불 = 플레이어 위치, 울타리 = 모닥불 중심 균등 원형 배치 (0번 세그먼트는 출입문).
export const BUILDING_CONFIG = {
  campfireMinDay: 2,             // 이 일차부터 건설 시도
  campfireCostWood: 22,
  campfireMaxCount: 3,
  campfireLightRadius: 140,      // 야간 탐지 감쇠가 적용되는 빛 반경
  campfireDetectionFactor: 0.45, // 빛 반경 안 플레이어의 실효 탐지 배율 (곱산)
  detectionFactorFloor: 0.25,    // 여러 모닥불 중첩 시 최저 배율
  buildCooldownDays: 1,          // 건설 시도 간격 (일차)
  fenceSegments: 10,             // 모닥불당 울타리 세그먼트 수 (0번 = 출입문)
  fenceCostPerSegment: 2,
  fenceRingRadius: 42,           // 울타리 링 반경
  fenceBlockRadius: 9,           // 세그먼트 통과 차단 반경
};
