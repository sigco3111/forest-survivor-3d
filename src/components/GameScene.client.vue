<template>
	<div class="game-stage">
		<div ref="sceneContainer" class="scene-container"></div>
		<div class="vignette" :style="{ opacity: vignetteIntensity }" aria-hidden="true"></div>
		<div v-if="presets" class="start-overlay" role="dialog" :aria-label="t('start.title')">
			<div class="start-card">
				<h1 class="start-card__title">{{ t('start.title') }}</h1>
				<p class="start-card__subtitle">{{ t('start.subtitle') }}</p>
				<div class="start-card__meta">
					<div class="start-card__meta-row">
						<span>{{ t('meta.level') }}: <b>L{{ metaSummary.metaLevel }}</b></span>
						<span>{{ t('meta.xp') }}: {{ metaSummary.totalXp }}</span>
						<span>{{ t('meta.runs') }}: {{ metaSummary.totalRuns }}</span>
					</div>
					<div v-if="metaSummary.metaLevel > 0" class="start-card__meta-bonus">
						{{ t('meta.startBonus') }}:
						+{{ metaSummary.startBonus.extraHealth }} HP,
						+{{ metaSummary.startBonus.extraAttack }} atk
						<span v-if="metaSummary.startBonus.extraCritChance > 0">, +{{ Math.round(metaSummary.startBonus.extraCritChance * 100) }}% crit</span>
						<span v-if="metaSummary.startBonus.extraCritMultiplier > 0">, +{{ metaSummary.startBonus.extraCritMultiplier.toFixed(1) }}× crit power</span>
						<span v-if="metaSummary.startBonus.extraWood > 0">, +{{ metaSummary.startBonus.extraWood }} 🌲</span>
					</div>
					<div v-if="metaSummary.perks.length > 0" class="start-card__meta-perks">
						<div class="start-card__meta-perks-title">{{ t('meta.perks') }}</div>
						<div v-for="perk in metaSummary.perks" :key="perk" class="start-card__meta-perk">
							✓ {{ t(`metaPerk.${perk}`) }}
						</div>
					</div>
				</div>
				<div class="start-card__presets">
					<button v-if="loadedSave" type="button" class="start-preset start-preset--continue" @click="continueSave">
						<span class="start-preset__name">{{ t('start.continue', { day: loadedSave.day }) }}</span>
					</button>
					<button type="button" class="start-preset" @click="pickPreset('aggressive')">
						<span class="start-preset__name">{{ t('start.aggressive') }}</span>
						<span class="start-preset__desc">{{ t('start.aggressiveDesc') }}</span>
					</button>
					<button type="button" class="start-preset" @click="pickPreset('balanced')">
						<span class="start-preset__name">{{ t('start.balanced') }}</span>
						<span class="start-preset__desc">{{ t('start.balancedDesc') }}</span>
					</button>
					<button type="button" class="start-preset" @click="pickPreset('survivor')">
						<span class="start-preset__name">{{ t('start.survivor') }}</span>
						<span class="start-preset__desc">{{ t('start.survivorDesc') }}</span>
					</button>
				</div>
			</div>
		</div>
		<div class="monster-overlay" aria-hidden="true">
			<div
				v-for="bar in monsterBars"
				:key="bar.id"
				class="monster-hpbar"
				:style="bar.style"
			>
				<div class="monster-hpbar__fill" :style="{ width: `${bar.percent}%` }"></div>
			</div>
			<div
				v-for="popup in damagePopups"
				:key="popup.id"
				class="damage-popup"
				:class="`damage-popup--${popup.kind}`"
				:style="popup.style"
			>{{ popup.text }}</div>
		</div>
		<div class="language-switcher" role="group" :aria-label="t('language.label')">
			<button type="button" :class="{ active: locale === 'en' }" @click="changeLocale('en')">{{ t('language.english') }}</button>
			<button type="button" :class="{ active: locale === 'zh-CN' }" @click="changeLocale('zh-CN')">{{ t('language.chinese') }}</button>
			<button type="button" :class="{ active: locale === 'ko' }" @click="changeLocale('ko')">{{ t('language.korean') }}</button>
		</div>
		<div class="reward-toast-stack" aria-live="polite">
			<div v-for="toast in rewardToasts" :key="toast.id" class="reward-toast">
				{{ toast.text }}
			</div>
		</div>
		<div class="resource-panel">
			<div class="resource-panel__day">
				{{ t('hud.day', { day: currentDay }) }}
				<span class="resource-panel__tier">{{ t('hud.tier', { tier: currentTier }) }}</span>
			</div>
			<div v-if="runStarted && !activeBossId" class="resource-panel__nextboss">{{ nextBossLabel }}</div>
			<div class="resource-panel__label">{{ t('hud.wood') }}</div>
			<div class="resource-panel__value">{{ woodCount }}</div>
			<div class="resource-panel__consumption">{{ t('hud.dailyUse', { count: woodPerDay }) }}</div>
			<div class="resource-panel__hint">{{ choppingHint }}</div>
			<div v-if="lowWoodWarning" class="resource-panel__warning">{{ t('hud.lowWood') }}</div>
			<div :key="killsPulseKey" class="resource-panel__kills" :class="{ 'resource-panel__kills--pulse': killsPulsing }">
				<span class="resource-panel__kills-label">{{ t('hud.combat.kills', { count: monsterKills }) }}</span>
				<span v-if="isInCombat" class="resource-panel__combat-dot" :title="t('hud.combat.attacking', { progress: Math.round(attackingProgress * 100) })"></span>
			</div>
			<div v-if="choppingProgress > 0" class="resource-panel__progress">
				<div
					class="resource-panel__progress-bar"
					:style="{ width: `${Math.round(choppingProgress * 100)}%` }"
				></div>
			</div>
		</div>
		<div class="minimap-wrapper">
			<canvas ref="minimapCanvas" class="minimap-canvas" />
		</div>
		<button class="minimap-toggle" @click="toggleCameraMode" :title="t(cameraMode === 'follow' ? 'camera.free' : 'camera.follow')">
			{{ cameraMode === 'follow' ? '🔒' : '🔓' }}
		</button>
		<div class="player-status" aria-live="polite">
			<div class="player-status__title">{{ t('hud.status.title') }}</div>
			<div class="player-status__row">
				<span class="player-status__label">{{ t('hud.status.state') }}</span>
				<span class="player-status__value" :class="`player-status__value--${status.state}`">{{ stateLabel }}</span>
			</div>
			<div class="player-status__row">
				<span class="player-status__label">{{ t('hud.status.preset') }}</span>
				<span class="player-status__value">{{ selectedPreset ? t(`start.${selectedPreset}`) : '' }}</span>
			</div>
			<div class="player-status__row">
				<span class="player-status__label">{{ t('hud.status.life') }}</span>
				<span class="player-status__value" :class="{ 'player-status__value--low': lifeRatio < 0.2 }">
					{{ status.life }} / {{ status.lifeMax }}
				</span>
			</div>
			<div class="player-status__bar">
				<div
					class="player-status__bar-fill"
					:class="{ 'player-status__bar-fill--low': lifeRatio < 0.2 }"
					:style="{ width: `${Math.round(lifeRatio * 100)}%` }"
				></div>
			</div>
			<div class="player-status__row">
				<span class="player-status__label">{{ t('hud.status.wood') }}</span>
				<span class="player-status__value">{{ status.wood }}</span>
			</div>
			<div class="player-status__row">
				<span class="player-status__label">{{ t('hud.status.attack') }}</span>
				<span class="player-status__value">{{ status.attack }}</span>
			</div>
			<div class="player-status__row">
				<span class="player-status__label">{{ t('hud.status.weapon') }}</span>
				<span class="player-status__value">Lv. {{ status.weaponTier }}</span>
			</div>
			<div class="player-status__row player-status__row--hint">
				<span>{{ t('hud.status.nextUpgrade', { count: status.upgradeCost }) }}</span>
			</div>
			<div class="player-status__row">
				<span class="player-status__label">{{ t('hud.status.power') }}</span>
				<span class="player-status__value">{{ status.power }}</span>
			</div>
			<div class="player-status__row">
				<span class="player-status__label">{{ t('hud.status.level') }}</span>
				<span class="player-status__value">{{ status.level }}</span>
			</div>
			<div class="player-status__row">
				<span class="player-status__label">{{ t('hud.status.exp') }}</span>
				<span class="player-status__value">{{ status.exp }} / {{ status.expNext }}</span>
			</div>
			<div class="player-status__row">
				<span class="player-status__label">{{ t('hud.status.target') }}</span>
				<span class="player-status__value">
					<template v-if="status.target">{{ status.target }} · {{ t(status.targetStrong ? 'hud.status.strong' : 'hud.status.weak') }}</template>
					<template v-else>{{ t('hud.status.targetNone') }}</template>
				</span>
			</div>
			<div class="player-status__row player-status__row--hint">
				<span>{{ t('hud.status.nearby') }}: {{ t('hud.status.hostile') }} {{ status.hostileCount }} · {{ t('hud.status.preyShort') }} {{ status.preyCount }}</span>
			</div>
			<div class="player-status__line player-status__line--threat">{{ status.threatLine || t('hud.status.none') }}</div>
			<div class="player-status__line player-status__line--prey">{{ status.preyLine || t('hud.status.none') }}</div>
		</div>
		<div class="mastery-panel" v-if="masterySummary">
			<div class="mastery-panel__title">{{ t('hud.mastery.title') }}</div>
			<div class="mastery-panel__row" v-for="row in masterySummary.rows" :key="row.label">
				<span class="mastery-panel__species">{{ row.label }}</span>
				<span class="mastery-panel__count">{{ row.count }}</span>
			</div>
			<div v-if="masterySummary.bonusCount > 0" class="mastery-panel__bonus">
				{{ t('hud.mastery.bonus') }} × {{ masterySummary.bonusCount }}
			</div>
		</div>
		<div v-if="passiveSummary.length" class="passive-panel">
			<div class="passive-panel__title">{{ t('hud.passive.title') }} · {{ passiveSummary.length }}</div>
			<div v-for="(label, index) in passiveSummary" :key="`${label}-${index}`" class="passive-panel__row">
				{{ label }}
			</div>
		</div>
		<div v-if="bossBar" class="boss-bar">
			<div class="boss-bar__name">{{ bossBar.name }} · {{ bossBar.distance }}m</div>
			<div class="boss-bar__track">
				<div class="boss-bar__fill" :style="{ width: `${bossBar.percent}%` }"></div>
			</div>
			<div class="boss-bar__hp">{{ bossBar.health }} / {{ bossBar.maxHealth }}</div>
		</div>
		<div v-if="daySummary.visible" class="day-summary">
			<div class="day-summary__title">{{ t('hud.summary.title', { day: daySummary.day }) }}</div>
			<div class="day-summary__text">{{ t('hud.summary.text', { wood: daySummary.wood, kills: daySummary.kills, damage: daySummary.damage }) }}</div>
		</div>
		<div v-if="levelUpCard" class="level-up-card">
			<div class="level-up-card__title">{{ t('hud.levelUp.title', { level: levelUpCard.level }) }}</div>
			<div class="level-up-card__row">
				<span class="level-up-card__id">{{ t(`hud.levelUp.${levelUpCard.choice.id}`) }}</span>
				<span class="level-up-card__hint">{{ t('hud.levelUp.cardLabel') }}</span>
			</div>
		</div>
		<div class="combat-log" aria-live="polite">
			<div
				v-for="entry in combatLog"
				:key="entry.id"
				class="combat-log__entry"
				:class="`combat-log__entry--${entry.kind}`"
			>{{ entry.text }}</div>
		</div>
		<div class="game-controls" role="group" :aria-label="'game speed'">
			<button type="button" class="game-controls__btn" @click="paused = !paused">{{ paused ? '▶' : '⏸' }}</button>
			<button
				v-for="speed in [1, 2, 4]"
				:key="speed"
				type="button"
				class="game-controls__btn"
				:class="{ 'game-controls__btn--active': gameSpeed === speed }"
				@click="gameSpeed = speed"
			>×{{ speed }}</button>
		</div>
		<div v-if="gameOver" class="game-over-overlay">
			<div class="game-over-content">
				<h2>{{ t('gameOver.title') }}</h2>
				<p>{{ t('gameOver.survived', { days: currentDay - 1 }) }}</p>
				<p>{{ t(deathCause === 'slain' ? 'gameOver.slain' : 'gameOver.exhausted') }}</p>
				<p v-if="bestRecord" class="game-over-best">{{ t('gameOver.best', { days: bestRecord.days, kills: bestRecord.kills }) }}</p>
				<p class="game-over-meta">{{ t('meta.xpGained', { xp: metaSummary.lastRunXp }) }}</p>
				<p v-if="metaSummary.metaLevel > 0" class="game-over-meta">Lv → L{{ metaSummary.metaLevel }}</p>
				<p class="game-over-autorestart">{{ t('gameOver.autoRestart') }}</p>
				<button class="game-over-btn" @click="restartGame">{{ t('gameOver.restart') }}</button>
			</div>
		</div>
	</div>
</template>

<script lang="ts" setup>
import {
	AmbientLight,
	Box3,
	Clock,
	DirectionalLight,
	Group,
	HemisphereLight,
	Material,
	MathUtils,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	Object3D,
	PCFSoftShadowMap,
	PerspectiveCamera,
	PlaneGeometry,
	PointLight,
	Scene,
	SphereGeometry,
	Texture,
	TextureLoader,
	Vector3,
	WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { readStoredLocale, storeLocale, type AppLocale } from '~/i18n/language'

import { loadBestRecord, saveBestRecord } from '~/game/records'

import {
	BUILDING_CONFIG,
	CAMERA_DIRECTOR_CONFIG,
	COMBAT_AGGRESSION_CONFIG,
	DEAD_TREE_CONFIG,
	DAY_CYCLE_CONFIG,
	ENVIRONMENT_CONFIG,
	EVENT_CONFIG,
	LEVEL_UP_CONFIG,
	MASTERY_CONFIG,
	META_PERK_CONFIG,
	MONSTER_CONFIG,
	MONSTER_GUARDIAN_CONFIG,
	PASSIVE_TREE_CONFIG,
	PLAYER_CONFIG,
		PRESET_CONFIG,
		PROGRESSION_CONFIG,
		SKILL_CONFIG,
		SKILL_TREE_CONFIG,
		TREE_RESOURCE_CONFIG,
	WEAPON_CONFIG,
} from '~/config'
import {
	createPlayerAnimationController,
	type PlayerAnimationController,
} from '~/game/player/animations'
import {
	createCameraDirector,
	type CameraDirector,
} from '~/game/player/camera-director'
import {
	createPlayerAgent,
	expForLevel,
	type PlayerAgent,
	type PlayerPresetId,
} from '~/game/player/agent'
import {
	createEnvironmentObjects,
	type EnvironmentObject,
} from '~/game/resources/environment'
import {
	createNoiseTrees,
	createRandomTree,
	type PlanePoint,
	type TreeResource,
} from '~/game/resources/trees'
import {
	createMonsterAnimationController,
	type MonsterAnimationController,
} from '~/game/player/monster-animations'
import {
	createMonsterAgent,
	createMonsterResources,
	createBossMonster,
	createRespawnMonster,
	type MonsterAgent,
	type MonsterResource,
	type MonsterUpdateContext,
} from '~/game/resources/monsters'
import {
	createProjectileManager,
	type ActiveProjectile,
	type ProjectileManager,
} from '~/game/resources/projectiles'
import {
	createBuildingManager,
	type Building,
	type BuildingManager,
} from '~/game/resources/buildings'
import {
	createDayCycle,
	type DayCycleState,
} from '~/game/time/day-cycle'
import {
	createLightingController,
	type LightingController,
} from '~/game/time/lighting'
import { eventsForDay, type ScheduledEvent } from '~/game/events/scheduler'
import { createMasteryState, emptyMasteryBonus, recordKill, toApplication, type MasteryState } from '~/game/player/mastery'
import { applyRunXp, availablePerks, computeRunXp, emptyMetaState, loadMetaState, META_CONFIG, reconcileUnlockedPerks, saveMetaState, startBonusFor, type MetaState, type StartBonus } from '~/game/meta-progression'
import { loadRunState, saveRunState, clearRunState, type RunSaveState } from '~/game/save'

defineOptions({
	name: 'GameScene',
})

const appBaseURL = useRuntimeConfig().app.baseURL
const { locale, setLocale, t } = useI18n()
const assetURL = (path: string) => `${appBaseURL}${path.replace(/^\/+/, '')}`

async function changeLocale(nextLocale: AppLocale): Promise<void> {
	await setLocale(nextLocale)
	document.documentElement.lang = nextLocale
	storeLocale(localStorage, nextLocale)
}

onMounted(() => {
	void changeLocale(readStoredLocale(localStorage))
})

const sceneContainer = ref<HTMLDivElement | null>(null)
const minimapCanvas = ref<HTMLCanvasElement | null>(null)
const choppingProgress = ref(0)
const woodCount = ref(0)
const monsterKills = ref(0)
const currentDay = ref(1)
const playerAlive = ref(true)
const gameOver = ref(false)
const deathCause = ref<'starvation' | 'slain'>('starvation')
const lowWoodWarning = ref(false)
const woodPerDay = DAY_CYCLE_CONFIG.woodConsumedPerDay
const PLAYER_ATTACK_DAMAGE = 17
const cameraMode = ref<'follow' | 'free'>('follow')
const choppingHint = computed(() => {
	if (gameOver.value) return t('hud.gameOver')
	if (choppingProgress.value > 0) {
		return t('hud.chopping', { progress: Math.round(choppingProgress.value * 100) })
	}

	return t('hud.approachTree')
})

const attackingProgress = ref(0)
const isInCombat = computed(() => attackingProgress.value > 0)

// ===== 방치형 HUD: 현재 티어 배지 + 다음 보스(티어 전환) 카운트다운 =====
const nextBossInDays = computed(() => {
	const interval = MONSTER_CONFIG.bossIntervalDays
	const offset = currentDay.value % interval
	return offset === 0 ? 0 : interval - offset
})
const nextBossLabel = computed(() => nextBossInDays.value === 0
	? t('hud.nextBossToday')
	: t('hud.nextBossIn', { days: nextBossInDays.value }))

// ===== 몬스터 HP바 + 데미지 팝업 오버레이 =====
type MonsterBarView = { id: string; style: Record<string, string>; percent: number }
type DamagePopupView = { id: number; kind: 'damage' | 'hurt'; text: string; createdAt: number; style: Record<string, string> }

const monsterBars = ref<MonsterBarView[]>([])
const damagePopups = ref<DamagePopupView[]>([])
let popupSeq = 0
const POPUP_LIFETIME_MS = 900
const MONSTER_BAR_HEIGHT = 8 // 몬스터 머리 위 오프셋 (모델 높이 ≈ 6)

// 월드 좌표 → 화면 픽셀 좌표. 카메라 뒤쪽이면 visible=false
function projectWorldToScreen(x: number, y: number, z: number): { left: number; top: number; visible: boolean } {
	if (!camera || !sceneContainer.value) return { left: 0, top: 0, visible: false }
	const vector = new Vector3(x, y, z).project(camera)
	if (vector.z > 1) return { left: 0, top: 0, visible: false }
	return {
		left: (vector.x * 0.5 + 0.5) * sceneContainer.value.clientWidth,
		top: (-vector.y * 0.5 + 0.5) * sceneContainer.value.clientHeight,
		visible: true,
	}
}

function spawnDamagePopup(x: number, y: number, z: number, text: string, kind: 'damage' | 'hurt') {
	const point = projectWorldToScreen(x, y, z)
	if (!point.visible) return
	damagePopups.value = [...damagePopups.value, {
		id: ++popupSeq,
		kind,
		text,
		createdAt: gameNow,
		style: { left: `${point.left}px`, top: `${point.top}px` },
	}]
}

function updateMonsterOverlay() {
	damagePopups.value = damagePopups.value.filter(popup => gameNow - popup.createdAt < POPUP_LIFETIME_MS)

	if (!camera) {
		monsterBars.value = []
		return
	}

	const bars: MonsterBarView[] = []
	for (const agent of monsterAgents) {
		const resource = agent.resource
		if (resource.health <= 0) continue
		// 피해를 입었거나 전투 중인 몬스터만 표시
		const hostile = agent.state === 'chase' || agent.state === 'attack' || agent.state === 'hit'
		if (resource.health >= resource.maxHealth && !hostile) continue

		const point = projectWorldToScreen(agent.position[0], MONSTER_BAR_HEIGHT, agent.position[1])
		if (!point.visible) continue

		bars.push({
			id: resource.id,
			style: { left: `${point.left}px`, top: `${point.top}px` },
			percent: Math.max(0, Math.round((resource.health / resource.maxHealth) * 100)),
		})
	}
	monsterBars.value = bars
}

// ===== 플레이어 상태 창: FSM 상태/체력/전투력/레벨/타겟/주변 위협을 매 프레임 노출 =====
const STATUS_STATE_KEYS: Record<string, string> = {
	exploring: 'hud.status.states.exploring',
	approaching: 'hud.status.states.approaching',
	chopping: 'hud.status.states.chopping',
	fleeing: 'hud.status.states.fleeing',
	hunting: 'hud.status.states.hunting',
	attacking: 'hud.status.states.attacking',
}

type PlayerStatusSnapshot = {
	state: string
	life: number
	lifeMax: number
	wood: number
	attack: number
	weaponTier: number
	upgradeCost: number
	power: number
	level: number
	exp: number
	expNext: number
	target: string
	targetStrong: boolean
	hostileCount: number
	preyCount: number
	threatLine: string
	preyLine: string
}

const status = ref<PlayerStatusSnapshot>({
	state: 'exploring',
	life: PLAYER_CONFIG.maxHealth,
	lifeMax: PLAYER_CONFIG.maxHealth,
	wood: 0,
	attack: PLAYER_ATTACK_DAMAGE,
	weaponTier: 0,
	upgradeCost: WEAPON_CONFIG.upgradeCostBase,
	power: COMBAT_AGGRESSION_CONFIG.playerBasePower,
	level: 1,
	exp: 0,
	expNext: PROGRESSION_CONFIG.expBase,
	target: '',
	targetStrong: false,
	hostileCount: 0,
	preyCount: 0,
	threatLine: '',
	preyLine: '',
})

// 생명력 비율: 실제 HP / 최대 체력
const lifeRatio = computed(() => Math.min(1, status.value.life / status.value.lifeMax))

const stateLabel = computed(() => t(STATUS_STATE_KEYS[status.value.state] ?? 'hud.status.states.exploring'))

// 에이전트 내부 판정과 동일한 전투력 공식 (진단용 미러링)
function monsterStrengthOf(resource: MonsterResource): number {
	return resource.health * COMBAT_AGGRESSION_CONFIG.monsterHealthPowerWeight
		+ resource.attackDamage * COMBAT_AGGRESSION_CONFIG.monsterAttackPowerWeight
}

function updatePlayerStatus() {
	if (!playerAgent) return
	const agent = playerAgent
	const power = COMBAT_AGGRESSION_CONFIG.playerBasePower
		+ agent.woodCollected * COMBAT_AGGRESSION_CONFIG.powerPerWood

	const [px, pz] = agent.position
	const live = monsterAgents.filter(candidate => candidate.resource.health > 0)
	const infos = live.map(candidate => ({
		resource: candidate.resource,
		strength: Math.round(monsterStrengthOf(candidate.resource)),
		weaker: monsterStrengthOf(candidate.resource) < power,
		hostile: candidate.state === 'chase' || candidate.state === 'attack' || candidate.state === 'hit',
		distance: Math.round(Math.hypot(candidate.position[0] - px, candidate.position[1] - pz)),
		contained: Math.hypot(candidate.resource.homePosition[0] - px, candidate.resource.homePosition[1] - pz)
			<= candidate.resource.activityRadius,
	}))

	const hostiles = infos.filter(info => info.hostile)
	const prey = infos.filter(info =>
		info.weaker
		&& info.contained
		&& info.distance <= PLAYER_CONFIG.attackRangeMeters * COMBAT_AGGRESSION_CONFIG.huntAggroRangeMultiplier
	)
	const strongest = hostiles
		.filter(info => !info.weaker && info.contained)
		.sort((a, b) => a.distance - b.distance)[0] ?? null
	const nearestPrey = [...prey].sort((a, b) => a.distance - b.distance)[0] ?? null

	const targetResource = agent.attackTarget
		? live.find(candidate => candidate.resource.id === agent.attackTarget?.id)?.resource ?? null
		: null

	status.value = {
		state: agent.state,
		life: Math.max(0, agent.health),
		lifeMax: agent.maxHealth,
		wood: Math.max(0, agent.woodCollected),
		attack: agent.attackDamage + agent.bonusFlatDamage,
		weaponTier: agent.weaponTier,
		upgradeCost: agent.nextUpgradeCost(),
		power: Math.round(power),
		level: agent.level,
		exp: Math.floor(agent.exp),
		expNext: expForLevel(agent.level, PROGRESSION_CONFIG),
		target: targetResource
			? `${targetResource.modelName} (${targetResource.health}/${targetResource.maxHealth})`
			: '',
		targetStrong: targetResource ? monsterStrengthOf(targetResource) >= power : false,
		hostileCount: hostiles.length,
		preyCount: prey.length,
		threatLine: strongest
			? t('hud.status.threatLine', { model: strongest.resource.modelName, power: strongest.strength, distance: strongest.distance })
			: '',
		preyLine: nearestPrey
			? t('hud.status.preyLine', { model: nearestPrey.resource.modelName, power: nearestPrey.strength, distance: nearestPrey.distance })
			: '',
	}
}

let animationFrame = 0
let clock: Clock | null = null
let camera: PerspectiveCamera | null = null
let orbitControls: OrbitControls | null = null
let playerAgent: PlayerAgent | null = null
let playerAnimation: PlayerAnimationController | null = null
let playerModel: Object3D | null = null
let renderer: WebGLRenderer | null = null
let scene: Scene | null = null
let cameraDirector: CameraDirector | null = null
let projectileManager: ProjectileManager | null = null
let buildingManager: BuildingManager | null = null
const buildingObjects = new Map<string, Group>()
const projectileMeshes = new Map<number, Mesh>()
let cameraShakeOffsetX = 0
let cameraShakeOffsetZ = 0
let pendingRaid = { day: 0, count: 0 }
let lastDayEvents: ScheduledEvent[] = []
let goldenTreeId: string | null = null
let goldenTreeBonus = 0
let masteryState: MasteryState | null = null
let metaState: MetaState = emptyMetaState()
const metaSummary = ref<{ totalXp: number; metaLevel: number; xpIntoLevel: number; nextLevelXp: number; totalRuns: number; unlockedSpecies: string[]; lastRunXp: number; startBonus: StartBonus; perks: string[] }>({
	totalXp: 0,
	metaLevel: 0,
	xpIntoLevel: 0,
	nextLevelXp: 0,
	totalRuns: 0,
	unlockedSpecies: [],
	lastRunXp: 0,
	startBonus: { extraHealth: 0, extraAttack: 0, extraWood: 0, extraCritChance: 0, extraCritMultiplier: 0, extraCollectRadiusMultiplier: 1 },
	perks: [],
})
let lastRunXpEarned = 0
let runBuildingsBuilt = 0
let runGoldenTreesCollected = 0
// 방치형 티어: 런은 항상 티어 1에서 시작하고, 보스를 토벌할 때마다 +1된다 (무한 사다리).
const currentTier = ref(1)
let runRecorded = false

// 게임 시계: 배속/일시정지를 지원하기 위해 실시간과 분리된 누적 시간 (ms)
let gameNow = 0
const gameSpeed = ref(1)
const paused = ref(false)
let treeGroup: Group | null = null
let treeResources: TreeResource[] = []
const deadTreeTemplates = new Map<number, Object3D>()
const liveTreeTemplates = new Map<number, Object3D>()
const treeObjects = new Map<string, Object3D>()
const fadingTrees: { object: Object3D; createdAt: number }[] = []
let environmentObjects: EnvironmentObject[] = []
const envTemplates = new Map<string, Object3D>()
let monsterResources: MonsterResource[] = []
const monsterAgents: MonsterAgent[] = []
const monsterObjects = new Map<string, Object3D>()
const monsterAnimations = new Map<string, MonsterAnimationController>()

// 昼夜循环和光照
let dayCycle: ReturnType<typeof createDayCycle> | null = null
let lightingController: LightingController | null = null
let hemisphereLight: HemisphereLight | null = null
let ambientLight: AmbientLight | null = null
let keyLight: DirectionalLight | null = null
let rimLight: DirectionalLight | null = null

const WORLD_RADIUS = TREE_RESOURCE_CONFIG.radiusMeters
const PLAYER_START: PlanePoint = [0, 0]
const CAMERA_OFFSET = new Vector3(0, 180, 240)
const MINIMAP_SIZE = 180

onMounted(() => {
	// 씬은 시작 오버레이의 프리셋/이어하기 선택 후에 만든다 (자동 시작 안 함).
	bestRecord.value = loadBestRecord(localStorage)
	loadedSave.value = loadRunState(localStorage)
	metaState = loadMetaState(localStorage) ?? emptyMetaState()
	refreshMetaSummary()
})

function refreshMetaSummary() {
	const nextLevelXp = metaState.metaLevel === 0
		? 0
		: META_CONFIG.metaLevelXp(metaState.metaLevel)
	metaState = reconcileUnlockedPerks(metaState, META_PERK_CONFIG)
	saveMetaState(localStorage, metaState)
	metaSummary.value = {
		totalXp: metaState.totalXp,
		metaLevel: metaState.metaLevel,
		xpIntoLevel: metaState.xpIntoLevel,
		nextLevelXp,
		totalRuns: metaState.totalRuns,
		unlockedSpecies: [...metaState.unlockedSpecies],
		lastRunXp: lastRunXpEarned,
		startBonus: startBonusFor(metaState.metaLevel, META_PERK_CONFIG),
		perks: [...availablePerks(META_PERK_CONFIG, metaState.metaLevel)],
	}
}

onUnmounted(() => {
	cancelAutoRestart()
	disposeScene()
})

function createScene() {
	if (!sceneContainer.value) return

	clock = new Clock()
	scene = new Scene()

	camera = new PerspectiveCamera(
		52,
		sceneContainer.value.clientWidth / sceneContainer.value.clientHeight,
		1,
		5000,
	)

	renderer = new WebGLRenderer({ antialias: true })
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
	renderer.setSize(sceneContainer.value.clientWidth, sceneContainer.value.clientHeight)
	renderer.shadowMap.enabled = true
	renderer.shadowMap.type = PCFSoftShadowMap
	sceneContainer.value.appendChild(renderer.domElement)

	orbitControls = new OrbitControls(camera, renderer.domElement)
	orbitControls.enableDamping = true
	orbitControls.dampingFactor = 0.08
	orbitControls.maxPolarAngle = Math.PI / 2.1
	orbitControls.minDistance = 50
	orbitControls.maxDistance = 1500
	orbitControls.enabled = false

	// 初始化小地图 canvas 分辨率
	if (minimapCanvas.value) {
		const dpr = Math.min(window.devicePixelRatio, 2)
		minimapCanvas.value.width = MINIMAP_SIZE * dpr
		minimapCanvas.value.height = MINIMAP_SIZE * dpr
	}

	// 初始化昼夜循环
	dayCycle = createDayCycle(DAY_CYCLE_CONFIG)

	// Phase 2/3 integrations: camera director, projectile manager, building manager.
	cameraDirector = createCameraDirector(CAMERA_DIRECTOR_CONFIG)
	const demonRanged = MONSTER_CONFIG.speciesBehavior?.Demon?.ranged
	const projectileSpeed = demonRanged?.projectileSpeed ?? 110
	projectileManager = createProjectileManager(
		{ speedUnitsPerSecond: projectileSpeed },
		{
			onHit: (damage: number) => {
				if (!playerAgent) return
				const dodged = playerAgent.applyDamage(damage)
				if (dodged) {
					spawnDamagePopup(playerAgent.position[0], 8, playerAgent.position[1], t('hud.log.dodge'), 'hurt')
					logEvent(t('hud.log.dodge'), 'skill')
					cameraDirector?.triggerHit(gameNow)
					return
				}
				dayDamageTaken += damage
				spawnDamagePopup(playerAgent.position[0], 8, playerAgent.position[1], `-${damage}`, 'hurt')
				logEvent(t('hud.log.hurt', { count: damage }), 'hurt')
				if (!playerAgent.playerAlive) {
					deathCause.value = 'slain'
					playerAlive.value = false
					gameOver.value = true
					recordRun()
				}
				cameraDirector?.triggerHit(gameNow)
			},
		},
	)
	buildingManager = createBuildingManager(BUILDING_CONFIG)
	pendingRaid = { day: 0, count: 0 }
	lastDayEvents = []
	goldenTreeId = null
	goldenTreeBonus = 0
	masteryState = createMasteryState()

	addEnvironment(scene)
	createTrees(scene)
	createEnvObjects(scene)
	createMonsters(scene)
	createPlayer(scene, selectedPreset.value ?? 'balanced')
	// 메타 진행: 이전 런에서 누적된 레벨 → 시작 보너스 주입 (HP/atk/wood/crit/collect)
	if (playerAgent && !loadedSave.value) {
		const bonus = startBonusFor(metaState.metaLevel, META_PERK_CONFIG)
		playerAgent.maxHealth += bonus.extraHealth
		playerAgent.health += bonus.extraHealth
		playerAgent.attackDamage += bonus.extraAttack
		playerAgent.woodCollected += bonus.extraWood
		playerAgent.critChance = Math.min(PLAYER_CONFIG.critChanceCeiling, playerAgent.critChance + bonus.extraCritChance)
		playerAgent.critMultiplier += bonus.extraCritMultiplier
		playerAgent.collectRadiusMultiplier *= bonus.extraCollectRadiusMultiplier
		woodCount.value = Math.max(0, playerAgent.woodCollected)
	}
	lastRunXpEarned = 0
	runBuildingsBuilt = 0
	runGoldenTreesCollected = 0
	currentTier.value = 1
	runRecorded = false
	window.addEventListener('resize', handleResize)
	animationFrame = window.requestAnimationFrame(renderFrame)
}

function addEnvironment(targetScene: Scene) {
	new TextureLoader().load(assetURL('/sky/sky.jpg'), texture => {
		targetScene.background = texture
	})

	hemisphereLight = new HemisphereLight('#c9fbff', '#193023', 1.9)
	ambientLight = new AmbientLight('#ffffff', 0.55)
	keyLight = new DirectionalLight('#fff4dc', 4.6)
	keyLight.position.set(-280, 520, 260)
	keyLight.castShadow = true
	keyLight.shadow.mapSize.set(2048, 2048)
	keyLight.shadow.camera.near = 20
	keyLight.shadow.camera.far = 1400
	keyLight.shadow.camera.left = -900
	keyLight.shadow.camera.right = 900
	keyLight.shadow.camera.top = 900
	keyLight.shadow.camera.bottom = -900
	rimLight = new DirectionalLight('#35f4ff', 1.1)
	rimLight.position.set(320, 280, -420)

	targetScene.add(hemisphereLight, ambientLight, keyLight, keyLight.target, rimLight)

	// 创建光照控制器
	lightingController = createLightingController({
		hemisphere: hemisphereLight,
		ambient: ambientLight,
		key: keyLight,
		rim: rimLight,
	})

	const ground = new Mesh(
		new PlaneGeometry(WORLD_RADIUS * 2.6, WORLD_RADIUS * 2.6, 1, 1),
		new MeshStandardMaterial({
			color: '#0c281f',
			roughness: 0.95,
			metalness: 0.02,
		}),
	)
	ground.rotation.x = -Math.PI / 2
	ground.receiveShadow = true
	targetScene.add(ground)
}

function createTrees(targetScene: Scene) {
	treeGroup = new Group()
	targetScene.add(treeGroup)
	treeResources = createNoiseTrees(TREE_RESOURCE_CONFIG)
	woodCount.value = 0
	choppingProgress.value = 0
	treeObjects.clear()

	TREE_RESOURCE_CONFIG.modelUrls.forEach((modelUrl, modelIndex) => {
		new GLTFLoader().load(
			assetURL(modelUrl),
			gltf => {
				const template = normalizeModel(gltf.scene)
				liveTreeTemplates.set(modelIndex, template)
				spawnTreeInstances(template, modelIndex)
			},
			undefined,
			error => console.error(`나무 모델 로드 실패: ${modelUrl}`, error),
		)
	})

	TREE_RESOURCE_CONFIG.deadModelUrls.forEach((modelUrl, modelIndex) => {
		new GLTFLoader().load(
			assetURL(modelUrl),
			gltf => {
				deadTreeTemplates.set(modelIndex, normalizeModel(gltf.scene))
			},
			undefined,
			error => console.error(`마른나무 모델 로드 실패: ${modelUrl}`, error),
		)
	})
}

function spawnTreeInstances(template: Object3D, modelIndex: number) {
	treeResources
		.filter(tree => tree.modelIndex === modelIndex && !tree.collected)
		.forEach(tree => {
			if (treeObjects.has(tree.id)) return
			const object = new Group()
			const model = template.clone(true)
			model.rotation.y = tree.rotation
			model.scale.multiplyScalar(tree.scale)
			object.add(model)
			object.position.set(tree.position[0], 0, tree.position[1])
			treeObjects.set(tree.id, object)
			treeGroup?.add(object)
		})
}

function createEnvObjects(targetScene: Scene) {
	const envGroup = new Group()
	targetScene.add(envGroup)
	environmentObjects = createEnvironmentObjects(ENVIRONMENT_CONFIG)

	const allUrls = new Map<string, { category: string; index: number }>()
	for (const [category, urls] of Object.entries(ENVIRONMENT_CONFIG.modelUrls)) {
		urls.forEach((url, index) => {
			allUrls.set(url, { category, index })
		})
	}

	allUrls.forEach(({ category, index }, url) => {
		new GLTFLoader().load(
			assetURL(url),
			gltf => {
				const template = normalizeModel(gltf.scene)
				envTemplates.set(`${category}-${index}`, template)

				environmentObjects
					.filter(obj => obj.modelCategory === category && obj.modelIndex === index)
					.forEach(obj => {
						const wrapper = new Group()
						const model = template.clone(true)
						model.rotation.y = obj.rotation
						model.scale.multiplyScalar(obj.scale)
						wrapper.add(model)
						wrapper.position.set(obj.position[0], 0, obj.position[1])
						envGroup.add(wrapper)
					})
			},
			undefined,
			error => console.error(`환경 모델 로드 실패: ${url}`, error),
		)
	})
}

// 리스폰 대기열: 처치된 몬스터의 모델 인덱스와 부활 예정일
const pendingRespawns: { dueDay: number; modelIndex: number }[] = []
let respawnSeq = 0
// 플레이어 스윙/광역 스킬 → 다음 updateMonsters에서 FSM이 처리할 피해 패킷 목록
let pendingPlayerHits: { id: string; damage: number }[] = []
// 처치 보상 중복 지급 방지 + 사망 연출 중인 시체 (id → 연출 시작 시각)
const settledKills = new Set<string>()
const dyingMonsters = new Map<string, number>()

function createMonsters(targetScene: Scene) {
	monsterResources = createMonsterResources(MONSTER_CONFIG)
	monsterAgents.length = 0
	monsterObjects.clear()
	monsterAnimations.clear()
	pendingRespawns.length = 0
	settledKills.clear()
	dyingMonsters.clear()
	pendingPlayerHits = []

	// 每个怪物单独加载 GLB（蒙皮骨骼不能 clone）
	monsterResources.forEach(resource => {
		spawnMonsterVisual(resource, targetScene)
	})
}

// 몬스터 1마리를 씬에 추가: GLB 개별 로드 → 래퍼/애니메이션/AI 에이전트 생성
function spawnMonsterVisual(resource: MonsterResource, targetScene: Scene) {
	const modelUrl = MONSTER_CONFIG.modelUrls[resource.modelIndex]
	new GLTFLoader().load(
		assetURL(modelUrl),
		gltf => {
			if (monsterObjects.has(resource.id)) return

			const wrapper = new Group()
			const model = normalizeModel(gltf.scene, MONSTER_CONFIG.modelScale, false)
			model.rotation.y = resource.rotation
			wrapper.add(model)
			wrapper.position.set(resource.position[0], 0, resource.position[1])
			targetScene.add(wrapper)
			monsterObjects.set(resource.id, wrapper)

			// 创建动画控制器（修复之前的 bug：动画未注册）
			const animController = createMonsterAnimationController(model, gltf.animations)
			monsterAnimations.set(resource.id, animController)

			// 创建怪物 AI，传入种植回调
			monsterAgents.push(createMonsterAgent(resource, (position) => {
				plantTreeAtPosition(position)
			}))
		},
		undefined,
		error => console.error(`몬스터 모델 로드 실패: ${modelUrl}`, error),
	)
}

// 새 날이 밝으면 기한이 된 리스폰을 처리한다. 총 몬스터 수는 설정치를 넘지 않는다 (보스 제외).
function processRespawns() {
	if (!scene) return
	while (pendingRespawns.length > 0
		&& monsterAgents.filter(agent => !agent.resource.isBoss).length < MONSTER_CONFIG.count
	) {
		const task = pendingRespawns[0]
		if (task.dueDay > currentDay.value) break
		pendingRespawns.shift()
		const resource = createRespawnMonster(
			MONSTER_CONFIG,
			`monster-respawn-${respawnSeq++}`,
			task.modelIndex,
			currentTier.value,
		)
		spawnMonsterVisual(resource, scene)
	}
}

// ===== 보스: bossIntervalDays마다 스폰, 상시 추격, 전용 HP바 =====
const activeBossId = ref<string | null>(null)
const bossBar = ref<{ name: string; distance: number; health: number; maxHealth: number; percent: number } | null>(null)

function spawnBoss(dayNumber: number) {
	if (!scene) return
	// 보스는 현재 티어 스케일로 생성된다 — 토벌할 때마다 다음 보스는 자동으로 더 강하다.
	const resource = createBossMonster(MONSTER_CONFIG, `boss-${dayNumber}`, currentTier.value)
	spawnMonsterVisual(resource, scene)
	activeBossId.value = resource.id
	const message = t('hud.log.bossSpawn')
	showToast(message)
	logEvent(message, 'boss')
}

function updateBossBar() {
	const id = activeBossId.value
	if (!id || !playerAgent) {
		bossBar.value = null
		return
	}
	const agent = monsterAgents.find(candidate => candidate.resource.id === id)
	if (!agent || agent.resource.health <= 0) {
		bossBar.value = null
		return
	}
	const distance = Math.round(Math.hypot(
		agent.position[0] - playerAgent.position[0],
		agent.position[1] - playerAgent.position[1],
	))
	bossBar.value = {
		name: agent.resource.modelName,
		distance,
		health: Math.max(0, agent.resource.health),
		maxHealth: agent.resource.maxHealth,
		percent: Math.max(0, Math.round((agent.resource.health / agent.resource.maxHealth) * 100)),
	}
}

// 怪物种植回调：在指定位置创建新树
function plantTreeAtPosition(position: PlanePoint) {
	const newTree = createRandomTree(
		treeResources,
		TREE_RESOURCE_CONFIG.modelUrls.length,
		{
			radiusMeters: TREE_RESOURCE_CONFIG.radiusMeters,
			modelScale: TREE_RESOURCE_CONFIG.modelScale,
			woodPerTree: TREE_RESOURCE_CONFIG.woodPerTree,
			respawnMinSpacing: MONSTER_GUARDIAN_CONFIG.plantTreeRadius,
		},
		position,
	)
	if (!newTree) return

	treeResources.push(newTree)
	spawnTreeVisual(newTree)
}

// 玩家攻击怪物回调：스윙 시점 기록 → 다음 updateMonsters에서 FSM이 피해/사망을 처리한다
// agent의 attackRoll이 이미 crit/flat 규칙을 적용해 finalDamage를 계산했으므로 여기서는 popup과 �만 책임진다.
function handlePlayerAttack(monsterId: string, damage: number, isCrit: boolean = false) {
	const agent = monsterAgents.find(candidate => candidate.resource.id === monsterId)
	if (!agent || agent.resource.health <= 0) return
	spawnDamagePopup(agent.position[0], 8, agent.position[1], `-${damage}${isCrit ? '!' : ''}`, 'damage')
	pendingPlayerHits.push({ id: monsterId, damage })
	// 생명 흡수 스킬: 해준 피해의 일부 회복
	playerAgent?.applyLifeLeech(damage)
}

// 처치 정산: 나무 보상/체력 회복/경험치/리스폰 예약 (몬스터당 정확히 1회)
function settleKill(agent: MonsterAgent) {
	if (settledKills.has(agent.resource.id)) return
	settledKills.add(agent.resource.id)
	monsterKills.value += 1
	dayKills += 1
	// 보스는 완료한 티어 비례 보상 (maxHealth 비례 보상은 일반 몬스터 전용 — 보스 체력이 커서 경제가 깨진다)
	const reward = agent.resource.isBoss
		? MONSTER_CONFIG.bossRewardWood * currentTier.value
		: Math.max(1, Math.round(agent.resource.maxHealth * 0.3))
	awardWood(reward)
	if (agent.resource.isBoss) {
		logEvent(t('hud.log.bossKill', { count: reward }), 'boss')
		showToast(t('hud.log.bossKill', { count: reward }))
		activeBossId.value = null
		// 방치형 티어 상승: 보스 토벌 = 다음 티어 자동 진입 (사용자 개입 없음).
		// 이후 리스폰/보스는 새 티어 스케일로 생성되고, 연출로 전환을 알린다.
		currentTier.value += 1
		const tierMsg = t('hud.log.tierUp', { tier: currentTier.value })
		showToast(tierMsg)
		logEvent(tierMsg, 'boss')
		cameraDirector?.triggerBossIntro(gameNow)
	} else {
		logEvent(t('hud.log.kill', { model: agent.resource.modelName, count: reward }), 'kill')
	}
	// 처치 보상으로 체력 회복 + 경험치 (레벨업 시 공격력/체력/속도 증가)
	playerAgent?.applyKillHeal()
	playerAgent?.addExperience(agent.resource.maxHealth)
	// 패시브 트리: 처치 이벤트를 기록 (보스 여부 함께)
	playerAgent?.recordKill(agent.resource.modelName, agent.resource.isBoss)
	// 종족 숙련도: 누적 → 임계치 보너스 자동 적용
	if (masteryState) {
		const before = masteryState.activeBonus
		masteryState = recordKill(masteryState, agent.resource, MASTERY_CONFIG)
		const after = masteryState.activeBonus
		// 전체 누적값을 매번 더하지 말고, 이번 처치에서 새로 발생한 차이만 agent에 적용한다.
		const app = toApplication(after, before)
		playerAgent?.applyMasteryBonus(app)
		// 임계치 신규 발동 시 HUD 알림
		for (const key of masteryState.lastTriggeredKeys) {
			showToast(t('hud.mastery.bonus') + ' · ' + key)
		}
		// 변경분만 로그 남기기 (silent updates are not noise)
		void before
	}
	// 하루 뒤 같은 티어의 몬스터가 리스폰된다 (보스는 스케줄 스폰 — 리스폰 예약 제외)
	if (!agent.resource.isBoss) {
		pendingRespawns.push({ dueDay: currentDay.value + 1, modelIndex: agent.resource.modelIndex })
	}
}

// 结算 wood 报酬并刷新 HUD + 토스트 알림
function awardWood(amount: number) {
	if (!playerAgent) return
	playerAgent.woodCollected += amount
	woodCount.value = Math.max(0, playerAgent.woodCollected)
	showRewardToast(amount)
	triggerKillPulse()
}

const rewardToasts = ref<{ id: number; text: string }[]>([])
let toastSeq = 0
function showToast(text: string) {
	const id = ++toastSeq
	rewardToasts.value = [...rewardToasts.value, { id, text }]
	setTimeout(() => {
		rewardToasts.value = rewardToasts.value.filter(toast => toast.id !== id)
	}, 1500)
}

function showRewardToast(amount: number) {
	showToast(t('hud.combat.reward', { count: amount }))
}

const killsPulseKey = ref(0)
const killsPulsing = ref(false)
let killsPulseTimer: ReturnType<typeof setTimeout> | null = null
function triggerKillPulse() {
	killsPulseKey.value += 1
	// 펄스는 일시적으로만: 상시 scale(1.18)이면 행이 좌우로 부풀어 다른 줄과 어긋난다
	killsPulsing.value = true
	if (killsPulseTimer) clearTimeout(killsPulseTimer)
	killsPulseTimer = setTimeout(() => {
		killsPulsing.value = false
	}, 700)
}

// ===== 전투 로그 피드: 최근 이벤트를 좌측 하단에 스트리밍 =====
type LogEntry = { id: number; text: string; kind: 'kill' | 'hurt' | 'level' | 'day' | 'boss' | 'skill'; createdAt: number }
const combatLog = ref<LogEntry[]>([])
let logSeq = 0
const LOG_TTL_MS = 7_000
const LOG_MAX_ENTRIES = 6

function logEvent(text: string, kind: LogEntry['kind']) {
	combatLog.value = [...combatLog.value, { id: ++logSeq, text, kind, createdAt: gameNow }]
	if (combatLog.value.length > LOG_MAX_ENTRIES) {
		combatLog.value = combatLog.value.slice(-LOG_MAX_ENTRIES)
	}
}

function pruneCombatLog() {
	if (!combatLog.value.length) return
	combatLog.value = combatLog.value.filter(entry => gameNow - entry.createdAt < LOG_TTL_MS)
}

// ===== 일차 요약: 하루 동안의 성과를 새 날 시작 때 카드로 표시 =====
const daySummary = ref({ visible: false, day: 0, wood: 0, kills: 0, damage: 0 })
let dayWoodGained = 0
let dayKills = 0
let dayDamageTaken = 0
let summaryTimer: ReturnType<typeof setTimeout> | null = null

type LevelUpCardView = {
	id: string
	effects: Record<string, number>
	level: number
}
const levelUpCard = ref<LevelUpCardView | null>(null)
let levelUpTimer: ReturnType<typeof setTimeout> | null = null

function showLevelUpCard() {
	if (!playerAgent || !playerAgent.lastLevelUpChoice) return
	levelUpCard.value = {
		id: playerAgent.lastLevelUpChoice.id,
		effects: playerAgent.lastLevelUpChoice.effects,
		level: playerAgent.level,
	}
	playerAgent.pendingLevelUps = []
	if (levelUpTimer) clearTimeout(levelUpTimer)
	levelUpTimer = setTimeout(() => {
		levelUpCard.value = null
	}, 1_800)
}

function showDaySummary() {	daySummary.value = {
		visible: true,
		day: Math.max(1, currentDay.value - 1),
		wood: dayWoodGained,
		kills: dayKills,
		damage: dayDamageTaken,
	}
	dayWoodGained = 0
	dayKills = 0
	dayDamageTaken = 0
	if (summaryTimer) clearTimeout(summaryTimer)
	summaryTimer = setTimeout(() => {
		daySummary.value = { ...daySummary.value, visible: false }
	}, 4_000)
}

// ===== 최고 기록 =====
const bestRecord = ref<{ days: number; kills: number } | null>(null)

// ===== 2·3단계 고도화: 시작 오버레이/프리셋/저장/이벤트/카메라/건축/투사체 =====
const PRESET_IDS: PlayerPresetId[] = ['aggressive', 'balanced', 'survivor']
const runStarted = ref(false)
const selectedPreset = ref<PlayerPresetId | null>(null)
const loadedSave = ref<RunSaveState | null>(null)
const vignetteIntensity = ref(0)

/** 시작 오버레이 표시 여부: 저장된 데이터가 있으면 이어하기·새로 시작 둘 다 노출, 없으면 프리셋 3개만 */
const presets = computed(() => !runStarted.value)

type MasteryRow = { label: string; count: number }
const masterySummary = computed(() => {
	if (!masteryState) return null
	const rows: MasteryRow[] = []
	for (const [species, count] of masteryState.speciesCounts) {
		rows.push({ label: species, count })
	}
	if (masteryState.bossCount > 0) {
		rows.push({ label: '👑', count: masteryState.bossCount })
	}
	rows.sort((a, b) => b.count - a.count)
	const bonusCount = masteryState.triggeredKeys.size
	return { rows, bonusCount }
})

const passiveSummary = computed(() => {
	const unlockedIds = playerAgent?.passiveTreeState.unlockedIds ?? []
	return unlockedIds.map(id => t(`hud.passive['${id}']`))
})

function pickPreset(preset: PlayerPresetId): void {
	selectedPreset.value = preset
	startRun(preset, null)
}

function continueSave(): void {
	if (!loadedSave.value || !loadedSave.value.preset) return
	selectedPreset.value = loadedSave.value.preset
	startRun(loadedSave.value.preset, loadedSave.value)
}

function startRun(preset: PlayerPresetId, saveState: RunSaveState | null): void {
	loadedSave.value = saveState
	runStarted.value = true
	// 씬 생성은 기존 createScene을 재활용 (없으면 새로 만들고, 세이브 복원이면 applySavedState로 덮어쓴다)
	createScene()
	if (saveState) applySavedState(saveState)
	autosaveCurrentRun()
}
function recordRun() {
	if (runRecorded) return
	runRecorded = true
	bestRecord.value = saveBestRecord(localStorage, {
		days: Math.max(0, currentDay.value - 1),
		kills: monsterKills.value,
	})
	// 메타 진행: 런 종료 시 통계 → XP → 레벨업 → 영구 저장 + 도감 해금
	const summary = {
		days: Math.max(0, currentDay.value - 1),
		kills: monsterKills.value,
		bosses: currentTier.value - 1,
		buildings: runBuildingsBuilt,
		goldenTrees: runGoldenTreesCollected,
	}
	const unlocked = masteryState ? Array.from(masteryState.speciesCounts.keys()) : []
	metaState = applyRunXp(metaState, computeRunXp(summary), unlocked)
	metaState = reconcileUnlockedPerks(metaState, META_PERK_CONFIG)
	lastRunXpEarned = computeRunXp(summary)
	saveMetaState(localStorage, metaState)
	refreshMetaSummary()
}

// 从场景、动画控制器、Agent 列表中移除死亡怪物并释放资源
function disposeMonster(monsterId: string) {
	const obj = monsterObjects.get(monsterId)
	if (obj) {
		obj.removeFromParent()
		obj.traverse(child => {
			if (child instanceof Mesh) {
				child.geometry?.dispose()
				const materials = Array.isArray(child.material) ? child.material : [child.material]
				materials.forEach(material => {
					for (const value of Object.values(material)) {
						if (value instanceof Texture) value.dispose()
					}
					material.dispose()
				})
			}
		})
		monsterObjects.delete(monsterId)
	}
	monsterAnimations.delete(monsterId)
	const idx = monsterAgents.findIndex(agent => agent.resource.id === monsterId)
	if (idx >= 0) monsterAgents.splice(idx, 1)
}

// 生成树的视觉对象（从 spawnTreeInstances 和 spawnNewTree 中抽取的公共逻辑）
function spawnTreeVisual(tree: TreeResource) {
	const template = liveTreeTemplates.get(tree.modelIndex)
	if (!template || treeObjects.has(tree.id)) return

	const object = new Group()
	const model = template.clone(true)
	model.rotation.y = tree.rotation
	model.scale.multiplyScalar(tree.scale)
	object.add(model)
	object.position.set(tree.position[0], 0, tree.position[1])
	treeObjects.set(tree.id, object)
	treeGroup?.add(object)
}

function createPlayer(targetScene: Scene, preset: PlayerPresetId) {
	const playerRoot = new Group()
	playerRoot.position.set(PLAYER_START[0], 0, PLAYER_START[1])
	targetScene.add(playerRoot)
	playerModel = playerRoot

	playerAgent = createPlayerAgent(PLAYER_START, {
		exploreDistance: PLAYER_CONFIG.walkStepDistanceMeters,
		speed: PLAYER_CONFIG.walkSpeedMetersPerSecond,
		collectRadius: PLAYER_CONFIG.collectTreeRadiusMeters,
		chopDurationMs: PLAYER_CONFIG.chopTreeDurationMs,
		attackRangeMeters: PLAYER_CONFIG.attackRangeMeters,
		attackDamageMs: PLAYER_CONFIG.attackDamageMs,
		attackCooldownMs: PLAYER_CONFIG.attackCooldownMs,
		playerAttackDamage: PLAYER_ATTACK_DAMAGE,
		onAttackMonster: (monsterId, damage, isCrit) => handlePlayerAttack(monsterId, damage, isCrit),
		playerMaxHealth: PLAYER_CONFIG.maxHealth,
		killHealHealth: PLAYER_CONFIG.killHealHealth,
		regenHealthAmount: PLAYER_CONFIG.regenHealthAmount,
		regenIntervalMs: PLAYER_CONFIG.regenIntervalMs,
		criticalHealthRatio: PLAYER_CONFIG.criticalHealthRatio,
		damageTakenFloor: PLAYER_CONFIG.damageTakenFloor,
		critChanceCeiling: PLAYER_CONFIG.critChanceCeiling,
		critMultiplierCeiling: PLAYER_CONFIG.critMultiplierCeiling,
		dodgeChanceCeiling: PLAYER_CONFIG.dodgeChanceCeiling,
		fleeSafeDistanceMeters: PLAYER_CONFIG.fleeSafeDistanceMeters,
		playerBasePower: COMBAT_AGGRESSION_CONFIG.playerBasePower,
		powerPerWood: COMBAT_AGGRESSION_CONFIG.powerPerWood,
		monsterHealthPowerWeight: COMBAT_AGGRESSION_CONFIG.monsterHealthPowerWeight,
		monsterAttackPowerWeight: COMBAT_AGGRESSION_CONFIG.monsterAttackPowerWeight,
		huntAggroRangeMultiplier: COMBAT_AGGRESSION_CONFIG.huntAggroRangeMultiplier,
		huntGiveUpRangeMultiplier: COMBAT_AGGRESSION_CONFIG.huntGiveUpRangeMultiplier,
		huntScanRangePerLevel: PROGRESSION_CONFIG.huntScanRangePerLevel,
		slamUnlockLevel: SKILL_CONFIG.slamUnlockLevel,
		slamCooldownMs: SKILL_CONFIG.slamCooldownMs,
		slamRadius: SKILL_CONFIG.slamRadius,
		slamDamageMultiplier: SKILL_CONFIG.slamDamageMultiplier,
		furyUnlockLevel: SKILL_CONFIG.furyUnlockLevel,
		furyCooldownMs: SKILL_CONFIG.furyCooldownMs,
		furyDurationMs: SKILL_CONFIG.furyDurationMs,
		furySwingMultiplier: SKILL_CONFIG.furySwingMultiplier,
		leechUnlockLevel: SKILL_CONFIG.leechUnlockLevel,
		leechRatio: SKILL_CONFIG.leechRatio,
		upgradeCostBase: WEAPON_CONFIG.upgradeCostBase,
		upgradeCostGrowth: WEAPON_CONFIG.upgradeCostGrowth,
		weaponAttackPerTier: WEAPON_CONFIG.attackPerTier,
		weaponPowerPerTier: WEAPON_CONFIG.powerPerTier,
		reserveWood: WEAPON_CONFIG.reserveWood,
		worldRadius: WORLD_RADIUS,
		collisionCheck: pos => checkCollision(pos) || (buildingManager?.blocks(pos) ?? false),
		presetWeights: PRESET_CONFIG[preset],
		levelUpPool: LEVEL_UP_CONFIG.pool
			? { cardCount: LEVEL_UP_CONFIG.cardCount, choices: LEVEL_UP_CONFIG.pool }
			: undefined,
		levelUpAffinity: LEVEL_UP_CONFIG.presetAffinity[preset],
		skillTree: SKILL_TREE_CONFIG,
		passiveTree: PASSIVE_TREE_CONFIG,
		weaponMaxTier: WEAPON_CONFIG.maxTier,
		treeResources: () => treeResources,
		// 살아있는 모든 몬스터를 후보로 노출한다:
		// - hostile=true(chase/attack/hit)인 몬스터만 도망 판정 대상
		// - 나머지(idle/patrol/tendPlants)는 "나보다 약하면" 선제공격 사냥감이 된다
		threatSources: () => monsterAgents
			.filter(agent => agent.resource.health > 0)
			.map(agent => ({
				id: agent.resource.id,
				position: agent.position,
				homePosition: agent.resource.homePosition,
				activityRadius: agent.resource.activityRadius,
				speed: agent.resource.speed,
				attackRadius: MONSTER_CONFIG.attackRadius,
				attackDamage: agent.resource.attackDamage,
				health: agent.resource.health,
				hostile: agent.state === 'chase' || agent.state === 'attack' || agent.state === 'hit',
				isBoss: agent.resource.isBoss,
			})),
	})

	new GLTFLoader().load(
		assetURL(PLAYER_CONFIG.url),
		gltf => {
			if (!playerModel) return

			const model = normalizeModel(gltf.scene, PLAYER_CONFIG.scale, false)
			playerRoot.add(model)
			playerAnimation = createPlayerAnimationController(model, gltf.animations)
		},
		undefined,
		error => {
			console.error('플레이어 모델 로드 실패:', error);
		},
	)
}

function renderFrame() {
	animationFrame = window.requestAnimationFrame(renderFrame)
	if (!clock || !renderer || !scene || !camera || !playerAgent || !playerModel) return

	// Game Over 时冻结游戏但继续渲染
	if (gameOver.value) {
		renderer.render(scene, camera)
		return
	}

	// 배속/일시정지가 적용된 게임 시간 (일시정지 중에도 getDelta는 호출해 누적을 방지한다)
	const rawDelta = clock.getDelta()
	const delta = paused.value ? 0 : rawDelta * gameSpeed.value
	gameNow += delta * 1000
	const now = gameNow

	// 1. 更新昼夜循环
	const dayResult = dayCycle?.update(delta * 1000)
	if (dayResult?.isNewDay) {
		currentDay.value = dayResult.dayNumber
		playerAgent?.recordDayReached(dayResult.dayNumber)
		showDaySummary()
		logEvent(t('hud.log.day', { day: dayResult.dayNumber }), 'day')
		// 주기 보스 스폰
		if (activeBossId.value === null && dayResult.dayNumber % MONSTER_CONFIG.bossIntervalDays === 0) {
			spawnBoss(dayResult.dayNumber)
		}
		// 每天扣减木头
		playerAgent.woodCollected -= DAY_CYCLE_CONFIG.woodConsumedPerDay
		if (playerAgent.woodCollected <= 0) {
			endRun('starvation')
		}
		// 2·3단계: 오늘의 이벤트를 결정하고 (밤습격 예약 + 황금나무 선정) 다음 야간에 풀어낸다.
		processDayEvents(dayResult.dayNumber)
		// 건축 매니저에 오늘 건설을 시도시킨다 (모닥불 + 울타리 자동 배치).
		tryAutoBuild(dayResult.dayNumber)
		// 일차 변경 시 자동 저장 — 다음 프레임 전이면 같은 키로 덮어쓴다.
		autosaveCurrentRun()
	}

	// 밤으로 막 진입하면 예약된 습격을 스폰한다 (낙오된 상태에서는 호출되지 않으므로 멱등).
	maybeSpawnNightRaid()

	// 更新光照
	if (dayCycle && lightingController) {
		lightingController.update(dayCycle.state.dayProgress, dayCycle.state.timeOfDay)
	}

	// 低木头警告
	lowWoodWarning.value = playerAgent.playerAlive && playerAgent.woodCollected > 0 && playerAgent.woodCollected <= DAY_CYCLE_CONFIG.woodConsumedPerDay * 2

	// 2. 更新玩家
	const prevWood = playerAgent.woodCollected
	const prevAnim = playerAgent.animation
	const prevLevel = playerAgent.level
	const prevWeaponTier = playerAgent.weaponTier
	const prevUpgradeCost = playerAgent.nextUpgradeCost()
	const prevSlamAt = playerAgent.lastSlamAt
	const prevFuryUntil = playerAgent.furyActiveUntil

	playerAgent.update(delta, now)
	syncPlayerVisuals()

	if (playerAgent.woodCollected !== prevWood) {
		woodCount.value = Math.max(0, playerAgent.woodCollected)
		// 일일 성과 집계: 증가분만 가산 (소모/강화는 집계에서 제외)
		if (playerAgent.woodCollected > prevWood) dayWoodGained += playerAgent.woodCollected - prevWood
	}
	// 자동 무기 강화가 일어나면 토스트로 알린다 (나무가 말없이 사라지는 것처럼 보이지 않게)
	if (playerAgent.weaponTier > prevWeaponTier) {
		showToast(t('hud.combat.upgrade', { tier: playerAgent.weaponTier, count: prevUpgradeCost }))
	}
	// 레벨업 로그
	if (playerAgent.level > prevLevel) {
		logEvent(t('hud.log.levelup', { level: playerAgent.level }), 'level')
		showLevelUpCard()
	}
	// 스킬 시전 로그
	if (playerAgent.lastSlamAt > prevSlamAt) {
		logEvent(t('hud.log.slam'), 'skill')
	}
	if (playerAgent.furyActiveUntil > prevFuryUntil) {
		logEvent(t('hud.log.fury'), 'skill')
	}
	// 스킬트리 자동 해금 알림 (이번 프레임에 큐에 들어온 노드만 1회 표시)
	for (const nodeId of playerAgent.pendingSkillUnlocks) {
		logEvent(t('hud.log.skillUnlock', { name: nodeId }), 'skill')
		showToast(t('hud.log.skillUnlock', { name: nodeId }))
	}
	playerAgent.pendingSkillUnlocks = []
	choppingProgress.value = playerAgent.choppingProgress
	attackingProgress.value = playerAgent.attackingProgress
	updatePlayerStatus()
	updateMonsterOverlay()
	updateBossBar()
	pruneCombatLog()
	if (playerAgent.lastCollectedTree) {
		replaceTreeWithDeadModel(playerAgent.lastCollectedTree, now)
		if (goldenTreeId && playerAgent.lastCollectedTree.id === goldenTreeId) {
			const bonus = goldenTreeBonus
			awardWood(bonus)
			logEvent(t('hud.log.goldenCollected', { count: bonus }), 'kill')
			showRewardToast(bonus)
			goldenTreeId = null
			goldenTreeBonus = 0
			runGoldenTreesCollected += 1
		}
		playerAgent.lastCollectedTree = null
	}
	if (playerAgent.animation !== prevAnim && playerAnimation) {
		playerAnimation.play(playerAgent.animation)
	}

	// 3. 更新怪物
	updateMonsters(delta, now)
	// 처치/보스/일차 마일스톤 해금 알림
	for (const nodeId of playerAgent.pendingPassiveUnlocks) {
		const label = t(`hud.passive['${nodeId}']`)
		logEvent(t('hud.log.passiveUnlock', { name: label }), 'skill')
		showToast(t('hud.log.passiveUnlock', { name: label }))
	}
	playerAgent.pendingPassiveUnlocks = []

	// 4. 现有系统
	updateFadingTrees(now)
	playerAnimation?.update(delta)
	updateProjectiles(delta)
	updateCamera(delta)
	renderer.render(scene, camera)
	drawMinimap()
	processRespawns()
}

function syncPlayerVisuals() {
	if (!playerAgent || !playerModel) return
	playerModel.position.set(playerAgent.position[0], 0, playerAgent.position[1])
	playerModel.rotation.y = playerAgent.bearing + MathUtils.degToRad(PLAYER_CONFIG.rotationY)
}

function updateMonsters(delta: number, now: number) {
	if (!playerAgent) return

	const monsterContext: MonsterUpdateContext = {
		playerPosition: playerAgent.position,
		playerAlive: playerAgent.playerAlive,
		// 사냥(hunting)/공격(attacking) 중에도 "벌목 중"처럼 취급해 몬스터가 반격한다:
		// 선제공격을 당한 몬스터가 도망치지 않고 되받아치므로 전투가 성립한다.
		playerIsChopping: playerAgent.state === 'chopping'
			|| playerAgent.state === 'attacking'
			|| playerAgent.state === 'hunting',
		playerIsFleeing: playerAgent.state === 'fleeing',
		isNight: dayCycle?.state.isNight ?? false,
		// 모닥불 반경 안이면 실효 탐지 반경이 감쇠된다 (각 모닥불이 곱셈으로 작용).
		detectionMultiplier: buildingManager?.detectionMultiplierAt(playerAgent.position) ?? 1,
		// 울타리: 몬스터가 직진으로 막히면 ±π/6·±π/3·±π/2 팬으로 우회 시도 (MONSTER_DETOUR_OFFSETS).
		obstacleCheck: buildingManager ? pos => buildingManager!.blocks(pos) : undefined,
		// 원거리 종족 (Demon 등) 발사: 게임 로직의 projectile manager로 위임 (시각화도 거기서).
		onRangedAttack: projectileManager ? (from, to, damage) => {
			projectileManager!.spawn(from, to, damage)
		} : undefined,
		incomingPlayerHits: pendingPlayerHits,
		onAttackPlayer: () => {
			// 몬스터 공격: 나무 대신 체력을 깎는다 (HP 0 = 사망)
			if (!playerAgent) return
			const dodged = playerAgent.applyDamage(MONSTER_CONFIG.attackDamage)
			if (dodged) {
				spawnDamagePopup(playerAgent.position[0], 8, playerAgent.position[1], t('hud.log.dodge'), 'hurt')
				logEvent(t('hud.log.dodge'), 'skill')
				cameraDirector?.triggerHit(gameNow)
				return
			}
			dayDamageTaken += MONSTER_CONFIG.attackDamage
			spawnDamagePopup(playerAgent.position[0], 8, playerAgent.position[1], `-${MONSTER_CONFIG.attackDamage}`, 'hurt')
			logEvent(t('hud.log.hurt', { count: MONSTER_CONFIG.attackDamage }), 'hurt')
			if (!playerAgent.playerAlive) {
				endRun('slain')
			}
			cameraDirector?.triggerHit(gameNow)
		},
	}

	// 팩 응집: 피격당한 몬스터와 같은 종족이 근처 있으면 함께 자극받아 추격한다
	for (const hit of pendingPlayerHits) {
		const target = monsterAgents.find(candidate => candidate.resource.id === hit.id)
		if (!target) continue
		for (const ally of monsterAgents) {
			if (ally.resource.modelName !== target.resource.modelName) continue
			const dist = Math.hypot(
				ally.position[0] - target.position[0],
				ally.position[1] - target.position[1],
			)
			if (dist <= MONSTER_CONFIG.packAggroRadius) {
				ally.provokedUntil = now + MONSTER_CONFIG.packAggroDurationMs
			}
		}
	}

	for (const agent of monsterAgents) {
		agent.update(delta, now, monsterContext)
		// FSM 경로의 사망(스윙 피해)도 씬 정산/청소 대상에 포함한다
		if (agent.resource.health <= 0 && !dyingMonsters.has(agent.resource.id)) {
			settleKill(agent)
			dyingMonsters.set(agent.resource.id, now)
		}
		const obj = monsterObjects.get(agent.resource.id)
		const anim = monsterAnimations.get(agent.resource.id)
		if (!obj) continue
		obj.position.set(agent.position[0], 0, agent.position[1])
		obj.rotation.y = agent.bearing
		anim?.play(agent.animation as any)
		anim?.update(delta)
	}
	pendingPlayerHits = []

	// 사망 연출 종료 → 시체 정리 (죽는 애니메이션이 영구 반복되는 문제 방지)
	for (const [monsterId, startedAt] of [...dyingMonsters]) {
		if (now - startedAt >= MONSTER_CONFIG.deathAnimMs) {
			dyingMonsters.delete(monsterId)
			disposeMonster(monsterId)
		}
	}
}

function checkCollision(position: PlanePoint): boolean {
	const treeRadius = 14
	for (const tree of treeResources) {
		if (tree.collected) continue
		if (Math.hypot(position[0] - tree.position[0], position[1] - tree.position[1]) < treeRadius) {
			return true
		}
	}
	for (const obj of environmentObjects) {
		if (Math.hypot(position[0] - obj.position[0], position[1] - obj.position[1]) < ENVIRONMENT_CONFIG.collisionRadius) {
			return true
		}
	}
	return false
}

function replaceTreeWithDeadModel(tree: TreeResource, now: number) {
	const liveObject = treeObjects.get(tree.id)
	const templateIndex = tree.modelIndex % TREE_RESOURCE_CONFIG.deadModelUrls.length
	const deadTemplate = deadTreeTemplates.get(templateIndex)

	liveObject?.removeFromParent()
	treeObjects.delete(tree.id)

	if (!deadTemplate) return

	const deadObject = new Group()
	const model = deadTemplate.clone(true)
	model.rotation.y = tree.rotation
	model.scale.multiplyScalar(tree.scale)
	model.traverse(child => {
		if (child instanceof Mesh) {
			child.material = (child.material as Material).clone()
			child.material.transparent = true
		}
	})
	deadObject.add(model)
	deadObject.position.set(tree.position[0], 0, tree.position[1])
	treeGroup?.add(deadObject)
	fadingTrees.push({ object: deadObject, createdAt: now })
}

function updateFadingTrees(now: number) {
	const { lingerMs, fadeMs } = DEAD_TREE_CONFIG
	const toRemove: number[] = []

	for (let i = 0; i < fadingTrees.length; i++) {
		const elapsed = now - fadingTrees[i].createdAt
		if (elapsed < lingerMs) continue

		if (elapsed < lingerMs + fadeMs) {
			const progress = (elapsed - lingerMs) / fadeMs
			fadingTrees[i].object.traverse(child => {
				if (child instanceof Mesh) {
					child.material.opacity = 1 - progress
				}
			})
			continue
		}

		fadingTrees[i].object.removeFromParent()
		fadingTrees[i].object.traverse(child => {
			if (child instanceof Mesh) {
				child.geometry?.dispose()
				const mats = Array.isArray(child.material) ? child.material : [child.material]
				mats.forEach(m => {
					for (const v of Object.values(m)) {
						if (v instanceof Texture) v.dispose()
					}
					m.dispose()
				})
			}
		})
		toRemove.push(i)
		spawnNewTree()
	}

	for (let i = toRemove.length - 1; i >= 0; i--) {
		fadingTrees.splice(toRemove[i], 1)
	}
}

function spawnNewTree() {
	const newTree = createRandomTree(treeResources, TREE_RESOURCE_CONFIG.modelUrls.length, {
		radiusMeters: TREE_RESOURCE_CONFIG.radiusMeters,
		modelScale: TREE_RESOURCE_CONFIG.modelScale,
		woodPerTree: TREE_RESOURCE_CONFIG.woodPerTree,
		respawnMinSpacing: DEAD_TREE_CONFIG.respawnMinSpacing,
	})
	if (!newTree) return

	treeResources.push(newTree)
	spawnTreeVisual(newTree)
}

function updateCamera(deltaSeconds: number) {
	if (!camera || !playerModel || !orbitControls) return

	// 2·3단계: 카메라 연출 감독의 지시에 따라 거리/포커스/셰이크를 매 프레임 갱신한다.
	let directive = null
	if (cameraDirector && playerAgent) {
		directive = cameraDirector.update({
			deltaSeconds,
			nowMs: gameNow,
			playerPosition: playerAgent.position,
			threatPosition: playerAgent.attackTarget?.position ?? null,
			bossEngaged: activeBossId.value != null,
			healthRatio: Math.min(1, playerAgent.health / Math.max(1, playerAgent.maxHealth)),
		})
		vignetteIntensity.value = directive.vignetteIntensity
	}
	const focus = directive?.focusPoint
	const focusPos = focus
		? new Vector3(focus[0], 0, focus[1])
		: playerModel.position

	if (cameraMode.value === 'follow') {
		orbitControls.enabled = false
		// 감독 거리 배율 (기본 1 → 교전 줌인 0.75 등) 적용
		const scale = directive?.distanceScale ?? 1
		const shake = directive?.shakeIntensity ?? 0
		// 셰이크: 강도에 비례해 X/Z 평면에서 작은 흔들림 오프셋 (Math.random은 view 레이어 한정)
		if (shake > 0.001) {
			cameraShakeOffsetX = (Math.random() - 0.5) * shake * CAMERA_DIRECTOR_CONFIG.shakeDecayPerSecond
			cameraShakeOffsetZ = (Math.random() - 0.5) * shake * CAMERA_DIRECTOR_CONFIG.shakeDecayPerSecond
		} else {
			cameraShakeOffsetX = 0
			cameraShakeOffsetZ = 0
		}
		camera.position.lerp(
			new Vector3(
				focusPos.x + CAMERA_OFFSET.x * scale + cameraShakeOffsetX,
				focusPos.y + CAMERA_OFFSET.y * scale,
				focusPos.z + CAMERA_OFFSET.z * scale + cameraShakeOffsetZ,
			),
			0.08,
		)
		camera.lookAt(focusPos.x, focusPos.y + 45, focusPos.z)
	} else {
		orbitControls.enabled = true
		orbitControls.update()
	}
}

function toggleCameraMode() {
	if (!orbitControls || !camera || !playerModel) return

	if (cameraMode.value === 'follow') {
		cameraMode.value = 'free'
		orbitControls.target.set(
			playerModel.position.x,
			0,
			playerModel.position.z,
		)
		orbitControls.enabled = true
	} else {
		cameraMode.value = 'follow'
		orbitControls.enabled = false
	}
}

function drawMinimap() {
	const canvas = minimapCanvas.value
	if (!canvas || !playerAgent) return
	const ctx = canvas.getContext('2d')
	if (!ctx) return

	const size = canvas.width
	const scale = size / (WORLD_RADIUS * 2.4)
	const cx = size / 2
	const cy = size / 2

	// 坐标映射：世界 (x, z) → canvas
	const toX = (wx: number) => cx + wx * scale
	const toY = (wz: number) => cy + wz * scale

	ctx.clearRect(0, 0, size, size)

	// 世界背景（夜晚变暗）
	const bgAlpha = dayCycle?.state.isNight ? 0.92 : 0.85
	ctx.beginPath()
	ctx.arc(cx, cy, WORLD_RADIUS * scale, 0, Math.PI * 2)
	ctx.fillStyle = `rgba(12, 40, 31, ${bgAlpha})`
	ctx.fill()

	// 世界边界
	ctx.beginPath()
	ctx.arc(cx, cy, WORLD_RADIUS * scale, 0, Math.PI * 2)
	ctx.strokeStyle = 'rgba(53, 244, 255, 0.2)'
	ctx.lineWidth = 2
	ctx.stroke()

	// 环境物（淡色小点）
	ctx.fillStyle = 'rgba(60, 140, 80, 0.35)'
	for (const obj of environmentObjects) {
		ctx.beginPath()
		ctx.arc(toX(obj.position[0]), toY(obj.position[1]), 1.5, 0, Math.PI * 2)
		ctx.fill()
	}

	// 树木
	for (const tree of treeResources) {
		if (tree.collected) continue
		ctx.fillStyle = '#2ecc71'
		ctx.beginPath()
		ctx.arc(toX(tree.position[0]), toY(tree.position[1]), 3, 0, Math.PI * 2)
		ctx.fill()
	}

	// 怪物：看管者模式，用橙色显示
	for (const agent of monsterAgents) {
		if (agent.resource.health <= 0) continue
		// 보스는 핑크 마커로 위치를 항상 추적 가능하게
		if (agent.resource.isBoss) {
			ctx.fillStyle = '#ff6bd6'
			ctx.beginPath()
			ctx.arc(toX(agent.position[0]), toY(agent.position[1]), 5, 0, Math.PI * 2)
			ctx.fill()
			ctx.strokeStyle = '#ffffff'
			ctx.lineWidth = 1.5
			ctx.stroke()
			continue
		}
		// 种植中的怪物用绿色，其他用橙色
		ctx.fillStyle = agent.state === 'tendPlants' ? '#2ecc71' : '#ff8c00'
		ctx.beginPath()
		ctx.arc(toX(agent.position[0]), toY(agent.position[1]), 3, 0, Math.PI * 2)
		ctx.fill()
	}

	// 玩家位置 + 朝向
	const px = toX(playerAgent.position[0])
	const py = toY(playerAgent.position[1])
	const arrowLen = 10
	const angle = -playerAgent.bearing + Math.PI / 2 // 调整朝向角度映射

	ctx.fillStyle = '#35f4ff'
	ctx.beginPath()
	ctx.arc(px, py, 5, 0, Math.PI * 2)
	ctx.fill()

	ctx.strokeStyle = '#35f4ff'
	ctx.lineWidth = 2
	ctx.beginPath()
	ctx.moveTo(px, py)
	ctx.lineTo(px + Math.cos(angle) * arrowLen, py + Math.sin(angle) * arrowLen)
	ctx.stroke()

	// 自由模式下显示摄像头方向
	if (cameraMode.value === 'free' && camera) {
		const camDir = new Vector3()
		camera.getWorldDirection(camDir)
		const camX = toX(camera.position.x)
		const camY = toY(camera.position.z)
		ctx.strokeStyle = 'rgba(255, 200, 87, 0.7)'
		ctx.lineWidth = 2
		ctx.beginPath()
		ctx.moveTo(camX, camY)
		ctx.lineTo(camX + camDir.x * 20, camY + camDir.z * 20)
		ctx.stroke()
	}
}

function normalizeModel(model: Object3D, targetScale: number = 1, shouldClone: boolean = true) {
	const normalizedModel = shouldClone ? cloneSkinned(model) : model
	const bounds = new Box3().setFromObject(normalizedModel)
	const size = bounds.getSize(new Vector3())
	const center = bounds.getCenter(new Vector3())
	const maxSize = Math.max(size.x, size.y, size.z) || 1

	normalizedModel.position.sub(center)
	normalizedModel.scale.setScalar(targetScale / maxSize)
	normalizedModel.traverse(object => {
		object.frustumCulled = false
		if (object instanceof Mesh) {
			object.castShadow = true
			object.receiveShadow = true
		}
	})

	const normalizedBounds = new Box3().setFromObject(normalizedModel)
	normalizedModel.position.y -= normalizedBounds.min.y
	return normalizedModel
}

function handleResize() {
	if (!sceneContainer.value || !camera || !renderer) return

	const { clientWidth, clientHeight } = sceneContainer.value
	camera.aspect = clientWidth / clientHeight
	camera.updateProjectionMatrix()
	renderer.setSize(clientWidth, clientHeight)
}

// ===== 방치형 무인 순환: 사망 → 요약 표시 → 메타 전환 → 같은 프리셋으로 자동 재시작 =====
const AUTO_RESTART_DELAY_MS = 4_000
let autoRestartTimer: ReturnType<typeof setTimeout> | null = null

function cancelAutoRestart() {
	if (autoRestartTimer) {
		clearTimeout(autoRestartTimer)
		autoRestartTimer = null
	}
}

/** 런 종료 확정: 오버레이 + 기록/메타 전환 + 자동 재시작 예약 (사용자 개입 없음). */
function endRun(cause: 'starvation' | 'slain') {
	if (gameOver.value) return
	playerAgent && (playerAgent.playerAlive = false)
	deathCause.value = cause
	playerAlive.value = false
	gameOver.value = true
	recordRun()
	cancelAutoRestart()
	autoRestartTimer = setTimeout(() => {
		autoRestartTimer = null
		autoRestartRun()
	}, AUTO_RESTART_DELAY_MS)
}

function resetRunState() {
	disposeScene()
	clearRunState(localStorage)

	// 게임 종료/플레이 상태 리셋 — gameOver를 함께 false로 돌려야 오버레이가 풀린다.
	gameOver.value = false
	playerAlive.value = true
	deathCause.value = 'starvation'
	lowWoodWarning.value = false
	currentDay.value = 1
	choppingProgress.value = 0
	woodCount.value = 0
	monsterKills.value = 0
	dayWoodGained = 0
	dayKills = 0
	dayDamageTaken = 0
	vignetteIntensity.value = 0
	levelUpCard.value = null
	if (levelUpTimer) clearTimeout(levelUpTimer)
	currentTier.value = 1

	loadedSave.value = null
	runStarted.value = false
	bestRecord.value = loadBestRecord(localStorage)
	// 메타 진행은 영구 — 새 런 시작 시 현재 값을 다시 로드해 시작 오버레이에 반영.
	metaState = loadMetaState(localStorage) ?? emptyMetaState()
	lastRunXpEarned = 0
	runBuildingsBuilt = 0
	runGoldenTreesCollected = 0
	runRecorded = false
	refreshMetaSummary()
}

/** 수동 재시작 버튼: 씬을 폐기하고 시작 오버레이로 돌아간다 (프리셋 재선택 가능). */
function restartGame() {
	cancelAutoRestart()
	resetRunState()
	selectedPreset.value = null
}

/** 무인 재시작: 마지막 프리셋 그대로 새 런을 즉시 시작한다 (메타 perk는 resetRunState에서 재반영). */
function autoRestartRun() {
	const preset = selectedPreset.value ?? 'balanced'
	resetRunState()
	selectedPreset.value = preset
	startRun(preset, null)
}

// ===== 2·3단계: 이벤트 처리 / 자동 건설 / 밤습격 / 자동 저장 / 복원 =====
function processDayEvents(dayNumber: number) {
	if (!playerAgent) return
	lastDayEvents = eventsForDay(EVENT_CONFIG, dayNumber)
	for (const ev of lastDayEvents) {
		if (ev.type === 'nightRaid') {
			pendingRaid = { day: dayNumber, count: ev.count }
			const msg = t('hud.log.raidAlert', { count: ev.count })
			showToast(msg)
			logEvent(msg, 'boss')
		} else if (ev.type === 'goldenTree') {
			pickGoldenTree(ev.woodBonus)
			const msg = t('hud.log.goldenTree', { count: ev.woodBonus })
			showToast(msg)
			logEvent(msg, 'kill')
		}
	}
}

function pickGoldenTree(bonus: number) {
	if (!playerAgent) return
	const candidates = treeResources.filter(tree => !tree.collected)
	if (!candidates.length) return
	// 결정성: tree.id 사전순으로 day % length 번째를 황금 처리. (비결정적 Math.random 대안)
	candidates.sort((a, b) => a.id.localeCompare(b.id))
	const pickIndex = candidates.length ? (currentDay.value % candidates.length) : 0
	const pick = candidates[pickIndex]
	goldenTreeId = pick.id
	goldenTreeBonus = bonus
	tintGoldenTree(pick.id)
}

function tintGoldenTree(treeId: string) {
	const obj = treeObjects.get(treeId)
	if (!obj) return
	obj.traverse(child => {
		if (child instanceof Mesh) {
			const material = (child.material as MeshStandardMaterial)
			if (!material) return
			material.emissive = new MeshStandardMaterial({ color: '#ffd166' }).emissive
			material.color = new MeshStandardMaterial({ color: '#ffc857' }).color
		}
	})
}

function maybeSpawnNightRaid() {
	if (!scene || !dayCycle) return
	if (!pendingRaid.count || pendingRaid.day !== currentDay.value) return
	if (!dayCycle.state.isNight) return
	const raidDay = pendingRaid.day
	const raidCount = pendingRaid.count
	pendingRaid = { day: 0, count: 0 }
	for (let i = 0; i < raidCount; i++) {
		const modelIndex = i % Math.max(1, MONSTER_CONFIG.modelUrls.length)
		const resource = createRespawnMonster(
			MONSTER_CONFIG,
			`raid-${raidDay}-${i}`,
			modelIndex,
			currentTier.value,
		)
		// 습격 몬스터: 자기 활동 반경/탐지 무시하고 충분히 오래 추격한다.
		resource.activityRadius = WORLD_RADIUS
		spawnMonsterVisual(resource, scene)
		const spawned = monsterAgents.find(a => a.resource.id === resource.id)
		if (spawned) spawned.provokedUntil = Number.POSITIVE_INFINITY
	}
	const msg = t('hud.log.raidBegin')
	showToast(msg)
	logEvent(msg, 'boss')
}

function tryAutoBuild(dayNumber: number) {
	if (!buildingManager || !playerAgent || !scene) return
	const result = buildingManager.maybeBuild({
		day: dayNumber,
		wood: playerAgent.woodCollected,
		reserveWood: WEAPON_CONFIG.reserveWood,
		playerPosition: playerAgent.position,
	})
	if (!result.built.length) return
	playerAgent.woodCollected -= result.woodSpent
	woodCount.value = Math.max(0, playerAgent.woodCollected)
	for (const building of result.built) {
		if (building.type === 'campfire') {
			renderCampfire(building)
			logEvent(t('hud.log.buildCampfire', { count: BUILDING_CONFIG.campfireCostWood }), 'level')
			runBuildingsBuilt += 1
		} else if (building.type === 'fence') {
			renderFence(building)
		}
	}
}

function renderCampfire(building: Building) {
	if (!scene) return
	const group = new Group()
	group.position.set(building.position[0], 0, building.position[1])

	// 장작 더미 (단순한 원기둥)
	const logMat = new MeshStandardMaterial({ color: '#5b3a1a', roughness: 0.9 })
	for (let i = 0; i < 3; i++) {
		const log = new Mesh(new SphereGeometry(2.5, 6, 6), logMat)
		log.position.set((i - 1) * 2.2, 1, 0)
		group.add(log)
	}
	// 화염
	const flame = new Mesh(
		new SphereGeometry(4, 8, 8),
		new MeshBasicMaterial({ color: '#ff8c00', transparent: true, opacity: 0.75 }),
	)
	flame.position.y = 5
	group.add(flame)
	// 포인트 라이트 (배치 가능한 강한 광원)
	const pointLight = new PointLight('#ffaa55', 2, BUILDING_CONFIG.campfireLightRadius, 1.6)
	pointLight.position.y = 7
	group.add(pointLight)

	scene.add(group)
	buildingObjects.set(building.id, group)
}

function renderFence(building: Building) {
	if (!scene) return
	const group = new Group()
	group.position.set(building.position[0], 0, building.position[1])
	group.rotation.y = building.bearing
	const post = new Mesh(
		new PlaneGeometry(0.6, BUILDING_CONFIG.fenceBlockRadius * 2),
		new MeshStandardMaterial({ color: '#3b2a1a', side: 2 }),
	)
	group.add(post)
	scene.add(group)
	buildingObjects.set(building.id, group)
}

function autosaveCurrentRun() {
	if (!playerAgent || !dayCycle) return
	saveRunState(localStorage, {
		savedAtMs: Date.now(),
		day: currentDay.value,
		elapsedMsInDay: dayCycle.state.dayProgress * DAY_CYCLE_CONFIG.realMsPerDay,
		preset: selectedPreset.value ?? 'balanced',
		level: playerAgent.level,
		exp: playerAgent.exp,
		health: playerAgent.health,
		maxHealth: playerAgent.maxHealth,
		attackDamage: playerAgent.attackDamage,
		speed: playerAgent.speed,
		wood: playerAgent.woodCollected,
		kills: monsterKills.value,
		weaponTier: playerAgent.weaponTier,
		buildings: buildingManager ? buildingManager.snapshot().map(b => ({
			type: b.type,
			position: [b.position[0], b.position[1]] as PlanePoint,
			bearing: b.bearing,
			segmentIndex: b.segmentIndex,
			builtDay: b.builtDay,
		})) : [],
		critChance: playerAgent.critChance,
		critMultiplier: playerAgent.critMultiplier,
		damageTakenMultiplier: playerAgent.damageTakenMultiplier,
		dodgeChance: playerAgent.dodgeChance,
		bonusFlatDamage: playerAgent.bonusFlatDamage,
		slamCooldownMultiplier: playerAgent.slamCooldownMultiplier,
		furyDurationMultiplier: playerAgent.furyDurationMultiplier,
		extraRegenBonus: playerAgent.extraRegenBonus,
		extraScanRangePerLevel: playerAgent.extraScanRangePerLevel,
		collectRadiusMultiplier: playerAgent.collectRadiusMultiplier,
		scanRangeMultiplier: playerAgent.scanRangeMultiplier,
		suppressFlee: playerAgent.suppressFlee,
		lastSlamAt: playerAgent.lastSlamAt,
		lastFuryAt: playerAgent.lastFuryAt,
		furyActiveUntil: playerAgent.furyActiveUntil,
		regenTimer: playerAgent.regenTimer,
		mastery: masteryState ? {
			speciesCounts: Object.fromEntries(masteryState.speciesCounts),
			bossCount: masteryState.bossCount,
			triggeredKeys: [...masteryState.triggeredKeys],
			activeBonus: { ...(masteryState.activeBonus || emptyMasteryBonus()) },
		} : {
			speciesCounts: {},
			bossCount: 0,
			triggeredKeys: [],
			activeBonus: { ...emptyMasteryBonus() },
		},
		unlockedSkillNodes: [...playerAgent.unlockedSkillNodes],
		unlockedPassiveNodeIds: [...playerAgent.passiveTreeState.unlockedIds],
		speciesKills: { ...playerAgent.passiveTreeState.progress.speciesKills },
		bossKills: playerAgent.passiveTreeState.progress.bossKills,
		cardChoiceCount: playerAgent.passiveTreeState.progress.cardChoiceCount,
		dayReached: Math.max(playerAgent.passiveTreeState.progress.dayReached, currentDay.value),
		levelReached: playerAgent.passiveTreeState.progress.level,
		position: [playerAgent.position[0], playerAgent.position[1]],
		gameNowMs: gameNow,
	})
}

function applySavedState(state: RunSaveState) {
	if (!playerAgent || !dayCycle || !buildingManager) return
	// 날짜 진행 복원
	const totalMs = (state.day - 1) * DAY_CYCLE_CONFIG.realMsPerDay + state.elapsedMsInDay
	dayCycle.state.totalElapsedMs = totalMs
	dayCycle.state.currentDay = state.day
	dayCycle.state.dayProgress = (state.elapsedMsInDay) / DAY_CYCLE_CONFIG.realMsPerDay
	dayCycle.update(0)
	currentDay.value = state.day
	// 티어 복원: 보스 처치 수가 곧 (티어 - 1). 세이브의 passiveTree 진행 카운터와 동일 원천.
	currentTier.value = state.bossKills + 1
	// 플레이어 능력치/스탯 직접 주입
	playerAgent.exp = state.exp
	playerAgent.level = state.level
	playerAgent.health = state.health
	playerAgent.maxHealth = state.maxHealth
	playerAgent.attackDamage = state.attackDamage
	playerAgent.weaponTier = state.weaponTier
	playerAgent.weaponPower = state.weaponTier * WEAPON_CONFIG.weaponPowerPerTier
	playerAgent.woodCollected = state.wood
	playerAgent.restoreSpeed(state.speed)
	monsterKills.value = state.kills
	// 누적 전투 스탯
	playerAgent.critChance = state.critChance
	playerAgent.critMultiplier = state.critMultiplier
	playerAgent.damageTakenMultiplier = state.damageTakenMultiplier
	playerAgent.dodgeChance = state.dodgeChance
	playerAgent.bonusFlatDamage = state.bonusFlatDamage
	playerAgent.slamCooldownMultiplier = state.slamCooldownMultiplier
	playerAgent.furyDurationMultiplier = state.furyDurationMultiplier
	playerAgent.extraRegenBonus = state.extraRegenBonus
	playerAgent.extraScanRangePerLevel = state.extraScanRangePerLevel
	playerAgent.collectRadiusMultiplier = state.collectRadiusMultiplier
	playerAgent.scanRangeMultiplier = state.scanRangeMultiplier
	playerAgent.suppressFlee = state.suppressFlee
	// 타이머는 게임 시간(gameNow) 기준이므로 wall-clock(savedAtMs)과 섞지 않는다.
	playerAgent.lastSlamAt = state.lastSlamAt
	playerAgent.lastFuryAt = state.lastFuryAt
	playerAgent.furyActiveUntil = state.furyActiveUntil
	playerAgent.regenTimer = state.regenTimer
	gameNow = state.gameNowMs
	// 패시브 트리 진행
	playerAgent.passiveTreeState = {
		unlockedIds: [...state.unlockedPassiveNodeIds],
		pendingUnlocks: [],
		progress: {
			level: state.levelReached,
			totalKills: state.kills,
			speciesKills: { ...state.speciesKills },
			bossKills: state.bossKills,
			cardChoiceCount: state.cardChoiceCount,
			dayReached: state.dayReached,
		},
	}
	masteryState = {
		speciesCounts: new Map(Object.entries(state.mastery.speciesCounts)),
		bossCount: state.mastery.bossCount,
		activeBonus: { ...state.mastery.activeBonus },
		triggeredKeys: new Set(state.mastery.triggeredKeys),
		lastTriggeredKeys: [],
	}
	playerAgent.position = [state.position[0], state.position[1]]
	// 저장된 건축을 복원하고 시각화
	buildingManager.restore(state.buildings.map(b => ({
		type: b.type,
		position: [b.position[0], b.position[1]] as PlanePoint,
		bearing: b.bearing,
		segmentIndex: b.segmentIndex,
		builtDay: b.builtDay,
	})))
	for (const b of buildingManager.buildings) {
		if (b.type === 'campfire') renderCampfire(b)
		else renderFence(b)
	}
}

function updateProjectiles(deltaSeconds: number) {
	if (!projectileManager || !scene) return
	projectileManager.update(deltaSeconds)
	const alive = projectileManager.active()
	const seenIds = new Set<number>()
	for (const flight of alive) {
		seenIds.add(flight.id)
		let mesh = projectileMeshes.get(flight.id)
		if (!mesh) {
			mesh = new Mesh(
				new SphereGeometry(3.5, 8, 8),
				new MeshBasicMaterial({ color: '#ff6bd6', transparent: true, opacity: 0.85 }),
			)
			mesh.userData.id = flight.id
			scene.add(mesh)
			projectileMeshes.set(flight.id, mesh)
		}
		const px = flight.from[0] + (flight.to[0] - flight.from[0]) * flight.progress
		const pz = flight.from[1] + (flight.to[1] - flight.from[1]) * flight.progress
		mesh.position.set(px, 6, pz)
	}
	// 끝난 비행 메시 회수 (manager가 도착한 비행을 제거했으므로 seenIds에 없는 것은 정리)
	for (const [id, mesh] of [...projectileMeshes]) {
		if (seenIds.has(id)) continue
		mesh.removeFromParent()
		mesh.geometry.dispose()
		const m = mesh.material as MeshBasicMaterial
		m.dispose()
		projectileMeshes.delete(id)
	}
}

function disposeScene() {
	if (animationFrame) {
		window.cancelAnimationFrame(animationFrame)
	}
	window.removeEventListener('resize', handleResize)

	orbitControls?.dispose()
	orbitControls = null

	if (scene) {
		scene.traverse(object => {
			if (object instanceof Mesh) {
				object.geometry?.dispose()
				const materials = Array.isArray(object.material)
					? object.material
					: [object.material]
				materials.forEach(material => {
					for (const value of Object.values(material)) {
						if (value instanceof Texture) value.dispose()
					}
					material.dispose()
				})
			}
		})
		scene.clear()
	}

	// 2·3단계: 모닥불/울타리 그룹과 투사체 메시는 scene.add로 들어갔지만 Group은 Mesh가 아니라
	// traverse에서 정리되지 않는다. Map에 보관된 참조를 명시적으로 해제한다.
	for (const group of buildingObjects.values()) {
		group.traverse(child => {
			if (child instanceof Mesh) {
				child.geometry?.dispose()
				const mats = Array.isArray(child.material) ? child.material : [child.material]
				mats.forEach(material => {
					for (const value of Object.values(material)) {
						if (value instanceof Texture) value.dispose()
					}
					material.dispose()
				})
			}
		})
		group.removeFromParent()
	}
	buildingObjects.clear()
	for (const mesh of projectileMeshes.values()) {
		mesh.geometry?.dispose()
		const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
		mats.forEach(material => {
			for (const value of Object.values(material)) {
				if (value instanceof Texture) value.dispose()
			}
			material.dispose()
		})
		mesh.removeFromParent()
	}
	projectileMeshes.clear()

	playerAgent = null
	playerAnimation = null
	playerModel = null
	renderer?.dispose()
	renderer?.domElement.remove()
	animationFrame = 0
	camera = null
	clock = null
	renderer = null
	scene = null
	treeGroup = null
	treeResources = []
	environmentObjects = []
	monsterResources = []
	monsterAgents.length = 0
	monsterObjects.clear()
	monsterAnimations.clear()
	pendingRespawns.length = 0
	settledKills.clear()
	dyingMonsters.clear()
	pendingPlayerHits = []
	monsterBars.value = []
	damagePopups.value = []
	fadingTrees.length = 0
	deadTreeTemplates.clear()
	liveTreeTemplates.clear()
	treeObjects.clear()
	envTemplates.clear()
	dayCycle = null
	lightingController = null
	hemisphereLight = null
	ambientLight = null
	keyLight = null
	rimLight = null
	cameraDirector = null
	masteryState = null
	projectileManager = null
	buildingManager = null
}
</script>

<style lang="scss" scoped>
.game-stage {
	position: relative;
	width: 100vw;
	height: 100vh;
	overflow: hidden;
	background: #87c6ef;
}

// 몬스터 HP바 + 데미지 팝업 오버레이 (월드 → 화면 투영)
.monster-overlay {
	position: absolute;
	inset: 0;
	z-index: 5;
	overflow: hidden;
	pointer-events: none;
}

.monster-hpbar {
	position: absolute;
	width: 44px;
	height: 5px;
	margin-left: -22px;
	margin-top: -12px;
	border-radius: 999px;
	background: rgba(3, 12, 24, 0.75);
	box-shadow: 0 0 6px rgba(0, 0, 0, 0.5);
}

.monster-hpbar__fill {
	height: 100%;
	border-radius: inherit;
	background: linear-gradient(90deg, #ff4444, #ff8c00);
}

.damage-popup {
	position: absolute;
	margin-left: -14px;
	color: #ffd166;
	font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	font-size: 14px;
	font-weight: 800;
	text-shadow: 0 0 8px rgba(0, 0, 0, 0.8), 0 2px 4px rgba(0, 0, 0, 0.6);
	animation: damage-popup-rise 0.9s ease-out forwards;
}

.damage-popup--hurt {
	color: #ff6b6b;
}

@keyframes damage-popup-rise {
	0% {
		opacity: 0;
		transform: translateY(0) scale(0.85);
	}
	15% {
		opacity: 1;
		transform: translateY(-6px) scale(1.05);
	}
	100% {
		opacity: 0;
		transform: translateY(-34px) scale(1);
	}
}

.scene-container {
	position: absolute;
	inset: 0;
}

.scene-container :deep(canvas) {
	display: block;
	width: 100%;
	height: 100%;
}

.language-switcher {
	position: absolute;
	top: 20px;
	left: 50%;
	z-index: 12;
	display: flex;
	padding: 3px;
	border: 1px solid rgba(53, 244, 255, 0.32);
	border-radius: 6px;
	background: rgba(3, 12, 24, 0.78);
	transform: translateX(-50%);
	backdrop-filter: blur(12px);

	button {
		min-height: 30px;
		padding: 0 10px;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: rgba(223, 252, 255, 0.72);
		cursor: pointer;
		font: 600 12px/1 ui-sans-serif, system-ui, sans-serif;

		&.active {
			background: #35f4ff;
			color: #031018;
		}
	}
}

.resource-panel {
	position: absolute;
	top: 20px;
	right: 20px;
	z-index: 2;
	min-width: 132px;
	padding: 14px 16px;
	border: 1px solid rgba(53, 244, 255, 0.38);
	border-radius: 16px;
	background: rgba(3, 12, 24, 0.72);
	box-shadow: 0 12px 30px rgba(0, 0, 0, 0.32), inset 0 0 24px rgba(53, 244, 255, 0.08);
	color: #dffcff;
	font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	backdrop-filter: blur(12px);
}

.resource-panel__day {
	font-size: 16px;
	font-weight: 700;
	color: #ffc857;
	margin-bottom: 8px;
	text-shadow: 0 0 12px rgba(255, 200, 87, 0.4);
}

.resource-panel__tier {
	display: inline-block;
	margin-left: 6px;
	padding: 1px 7px;
	border: 1px solid rgba(255, 110, 199, 0.55);
	border-radius: 999px;
	font-size: 12px;
	color: #ff6ec7;
	text-shadow: 0 0 10px rgba(255, 110, 199, 0.5);
}

.resource-panel__nextboss {
	font-size: 11px;
	letter-spacing: 0.06em;
	color: rgba(255, 178, 224, 0.85);
	margin-bottom: 6px;
}

.resource-panel__label,
.resource-panel__hint {
	font-size: 12px;
	letter-spacing: 0.08em;
	opacity: 0.72;
}

.resource-panel__value {
	margin-top: 4px;
	font-size: 32px;
	font-weight: 800;
	line-height: 1;
	color: #35f4ff;
	text-shadow: 0 0 18px rgba(53, 244, 255, 0.45);
}

.resource-panel__consumption {
	font-size: 11px;
	opacity: 0.55;
	margin-top: 4px;
	letter-spacing: 0.02em;
}

.resource-panel__hint {
	margin-top: 8px;
	letter-spacing: 0.02em;
}

.resource-panel__warning {
	margin-top: 6px;
	font-size: 12px;
	font-weight: 700;
	color: #ff4444;
	animation: warning-pulse 1s ease-in-out infinite;
}

.resource-panel__kills {
	margin-top: 8px;
	font-size: 12px;
	letter-spacing: 0.08em;
	opacity: 0.72;
	color: #ff8c00;
	display: flex;
	align-items: center;
	gap: 6px;
	transition: color 0.18s ease-out, text-shadow 0.18s ease-out;
}

.resource-panel__kills--pulse {
	transform-origin: left center;
	animation: kills-pulse 0.7s ease-out;
}

@keyframes kills-pulse {
	0% {
		transform: scale(1);
		color: #ff8c00;
		text-shadow: none;
	}
	35% {
		transform: scale(1.18);
		color: #ffd166;
		text-shadow: 0 0 12px rgba(255, 209, 102, 0.75);
	}
	100% {
		transform: scale(1);
		color: #ff8c00;
		text-shadow: none;
	}
}

.resource-panel__kills-label {
	display: inline-block;
}

.resource-panel__combat-dot {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: #ff4d4d;
	box-shadow: 0 0 8px rgba(255, 77, 77, 0.85);
	animation: combat-dot-pulse 0.8s ease-in-out infinite;
}

.reward-toast-stack {
	position: absolute;
	top: 90px;
	left: 50%;
	z-index: 6;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 6px;
	pointer-events: none;
	transform: translateX(-50%);
}

.reward-toast {
	padding: 8px 16px;
	border-radius: 999px;
	background: rgba(255, 209, 102, 0.95);
	color: #1a1a1a;
	font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	font-size: 14px;
	font-weight: 700;
	letter-spacing: 0.02em;
	box-shadow: 0 8px 22px rgba(0, 0, 0, 0.35);
	animation: reward-toast-rise 1.5s ease-out forwards;
}

@keyframes reward-toast-rise {
	0% {
		opacity: 0;
		transform: translateY(12px) scale(0.92);
	}
	15% {
		opacity: 1;
		transform: translateY(0) scale(1.05);
	}
	35% {
		opacity: 1;
		transform: translateY(0) scale(1);
	}
	100% {
		opacity: 0;
		transform: translateY(-18px) scale(1);
	}
}

@keyframes combat-dot-pulse {
	0%, 100% {
		transform: scale(1);
		opacity: 1;
	}
	50% {
		transform: scale(1.4);
		opacity: 0.55;
	}
}

.resource-panel__progress {
	width: 100%;
	height: 6px;
	margin-top: 10px;
	overflow: hidden;
	border-radius: 999px;
	background: rgba(255, 255, 255, 0.14);
}

.resource-panel__progress-bar {
	height: 100%;
	border-radius: inherit;
	background: linear-gradient(90deg, #ffc857, #35f4ff);
	box-shadow: 0 0 12px rgba(53, 244, 255, 0.5);
	transition: width 0.12s linear;
}

.minimap-wrapper {
	position: absolute;
	top: 20px;
	left: 20px;
	z-index: 2;
	width: 180px;
	height: 180px;
	border-radius: 50%;
	overflow: hidden;
	border: 2px solid rgba(53, 244, 255, 0.38);
	box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4), inset 0 0 16px rgba(53, 244, 255, 0.08);
	background: rgba(3, 12, 24, 0.72);
	backdrop-filter: blur(12px);
}

.minimap-canvas {
	display: block;
	width: 100%;
	height: 100%;
}

.player-status {
	position: absolute;
	/* 미니맵(20px + 180px = 200px) 아래 32px 간격 */
	top: 232px;
	left: 20px;
	z-index: 2;
	width: 180px;
	padding: 10px 12px;
	border: 1px solid rgba(53, 244, 255, 0.38);
	border-radius: 12px;
	background: rgba(3, 12, 24, 0.72);
	box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4), inset 0 0 16px rgba(53, 244, 255, 0.08);
	color: #dffcff;
	font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	backdrop-filter: blur(12px);
}

.player-status__title {
	margin-bottom: 6px;
	font-size: 12px;
	font-weight: 700;
	letter-spacing: 0.06em;
	color: #ffc857;
	text-shadow: 0 0 12px rgba(255, 200, 87, 0.4);
}

.player-status__row {
	display: flex;
	gap: 8px;
	align-items: baseline;
	justify-content: space-between;
	font-size: 11px;
	line-height: 1.55;
}

.player-status__label {
	white-space: nowrap;
	letter-spacing: 0.04em;
	opacity: 0.6;
}

.player-status__value {
	font-weight: 600;
	text-align: right;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.player-status__value--fleeing {
	color: #ff6b6b;
}

.player-status__value--low {
	color: #ff6b6b;
}

.player-status__bar {
	height: 6px;
	margin-top: 4px;
	overflow: hidden;
	border-radius: 999px;
	background: rgba(255, 255, 255, 0.14);
}

.player-status__bar-fill {
	height: 100%;
	border-radius: inherit;
	background: linear-gradient(90deg, #ff8c00, #ffd166);
	box-shadow: 0 0 12px rgba(255, 200, 87, 0.5);
	transition: width 0.15s linear;
}

.player-status__bar-fill--low {
	background: linear-gradient(90deg, #ff4444, #ff6b6b);
	box-shadow: 0 0 12px rgba(255, 68, 68, 0.6);
	animation: warning-pulse 1s ease-in-out infinite;
}

.player-status__value--hunting,
.player-status__value--attacking {
	color: #ffd166;
}

.player-status__row--hint {
	justify-content: flex-start;
	font-size: 10px;
	opacity: 0.55;
}

.player-status__line {
	font-size: 10px;
	line-height: 1.5;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	opacity: 0.85;
}

.player-status__line--threat {
	color: #ff8c87;
}

.player-status__line--prey {
	color: #7dffa8;
}

.mastery-panel {
	position: absolute;
	top: 410px;
	left: 20px;
	z-index: 2;
	width: 180px;
	padding: 10px 12px;
	border: 1px solid rgba(255, 107, 214, 0.35);
	border-radius: 12px;
	background: rgba(3, 12, 24, 0.72);
	color: #dffcff;
	font-family: ui-sans-serif, system-ui, sans-serif;
	box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
	backdrop-filter: blur(12px);
}

.mastery-panel__title {
	margin-bottom: 6px;
	font-size: 12px;
	font-weight: 700;
	letter-spacing: 0.06em;
	color: #ff6bd6;
	text-shadow: 0 0 12px rgba(255, 107, 214, 0.4);
}

.mastery-panel__row {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	font-size: 11px;
	line-height: 1.55;
}

.mastery-panel__species {
	opacity: 0.75;
}

.mastery-panel__count {
	font-weight: 700;
	color: #ffd166;
}

.mastery-panel__bonus {
	margin-top: 4px;
	padding-top: 4px;
	border-top: 1px solid rgba(255, 107, 214, 0.18);
	font-size: 10px;
	font-weight: 700;
	color: #35f4ff;
}

.passive-panel {
	position: absolute;
	top: 545px;
	left: 20px;
	z-index: 2;
	width: 180px;
	max-height: 190px;
	overflow: auto;
	padding: 10px 12px;
	border: 1px solid rgba(53, 244, 255, 0.3);
	border-radius: 12px;
	background: rgba(3, 12, 24, 0.68);
	color: #dffcff;
	font-family: ui-sans-serif, system-ui, sans-serif;
	box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
	backdrop-filter: blur(12px);
}

.passive-panel__title {
	margin-bottom: 6px;
	font-size: 11px;
	font-weight: 700;
	color: #35f4ff;
}

.passive-panel__row {
	padding: 3px 0;
	border-top: 1px solid rgba(53, 244, 255, 0.12);
	font-size: 10px;
	line-height: 1.35;
}

.minimap-toggle {
	position: absolute;
	top: 166px;
	left: 166px;
	z-index: 10;
	width: 28px;
	height: 28px;
	padding: 0;
	border: 1px solid rgba(53, 244, 255, 0.3);
	border-radius: 50%;
	background: rgba(3, 12, 24, 0.8);
	color: #35f4ff;
	cursor: pointer;
	font-size: 14px;
	line-height: 28px;
	text-align: center;
	transition: background 0.2s;

	&:hover {
		background: rgba(53, 244, 255, 0.15);
	}
}

.game-over-overlay {
	position: absolute;
	inset: 0;
	z-index: 100;
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(0, 0, 0, 0.75);
	backdrop-filter: blur(8px);
	animation: fade-in 0.8s ease-out;
}

.game-over-content {
	text-align: center;
	color: #dffcff;
	font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;

	h2 {
		font-size: 48px;
		font-weight: 800;
		margin: 0 0 16px;
		color: #ff4444;
		text-shadow: 0 0 30px rgba(255, 68, 68, 0.5);
	}

	p {
		font-size: 18px;
		margin: 8px 0;
		opacity: 0.8;
	}
}

.game-over-btn {
	margin-top: 24px;
	padding: 12px 32px;
	border: 1px solid rgba(53, 244, 255, 0.5);
	border-radius: 12px;
	background: rgba(53, 244, 255, 0.15);
	color: #35f4ff;
	font-size: 18px;
	font-weight: 600;
	cursor: pointer;
	transition: all 0.2s;
	font-family: inherit;

	&:hover {
		background: rgba(53, 244, 255, 0.3);
		box-shadow: 0 0 20px rgba(53, 244, 255, 0.3);
	}
}

.vignette {
	position: absolute;
	inset: 0;
	z-index: 4;
	pointer-events: none;
	background: radial-gradient(circle at center, rgba(0, 0, 0, 0) 30%, rgba(0, 0, 0, 0.95) 100%);
	transition: opacity 0.18s ease-out;
}

.start-overlay {
	position: absolute;
	inset: 0;
	z-index: 50;
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(3, 12, 24, 0.82);
	backdrop-filter: blur(10px);
}

.start-card {
	max-width: 720px;
	padding: 32px 36px;
	border: 1px solid rgba(53, 244, 255, 0.42);
	border-radius: 16px;
	background: rgba(3, 12, 24, 0.92);
	box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
	color: #dffcff;
	font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
}

.start-card__title {
	margin: 0 0 6px;
	font-size: 26px;
	font-weight: 800;
	color: #ffc857;
	text-shadow: 0 0 18px rgba(255, 200, 87, 0.5);
}

.start-card__subtitle {
	margin: 0 0 12px;
	font-size: 14px;
	opacity: 0.78;
}

.start-card__meta {
	margin-bottom: 18px;
	padding: 10px 14px;
	border-radius: 10px;
	background: rgba(53, 244, 255, 0.08);
	color: #dffcff;
	font-size: 12px;
	line-height: 1.6;
}

.start-card__meta-row {
	display: flex;
	gap: 12px;
	justify-content: space-between;
	flex-wrap: wrap;
}

.start-card__meta-row b {
	color: #ffc857;
}

.start-card__meta-bonus {
	margin-top: 4px;
	font-size: 11px;
	opacity: 0.85;
}

.start-card__presets {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
	gap: 12px;
}

.start-preset {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 16px 18px;
	border: 1px solid rgba(53, 244, 255, 0.3);
	border-radius: 12px;
	background: rgba(53, 244, 255, 0.06);
	color: #dffcff;
	text-align: left;
	cursor: pointer;
	transition: transform 0.15s ease-out, background 0.15s ease-out, border-color 0.15s ease-out;

	&:hover {
		transform: translateY(-2px);
		background: rgba(53, 244, 255, 0.12);
		border-color: rgba(53, 244, 255, 0.6);
	}
}

.start-preset__name {
	font-size: 16px;
	font-weight: 700;
	color: #35f4ff;
}

.start-preset__desc {
	font-size: 12px;
	opacity: 0.75;
	line-height: 1.45;
}

.start-preset--continue {
	grid-column: 1 / -1;
	background: rgba(255, 200, 87, 0.12);
	border-color: rgba(255, 200, 87, 0.55);

	.start-preset__name {
		color: #ffc857;
		font-size: 18px;
	}
}

// 보스 상단 HP바
.boss-bar {
	position: absolute;
	top: 64px;
	left: 50%;
	z-index: 8;
	width: min(420px, 60vw);
	transform: translateX(-50%);
	text-align: center;
	pointer-events: none;
}

.boss-bar__name {
	margin-bottom: 4px;
	color: #ff6bd6;
	font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	font-size: 13px;
	font-weight: 800;
	letter-spacing: 0.2em;
	text-shadow: 0 0 12px rgba(255, 107, 214, 0.6);
}

.boss-bar__track {
	height: 10px;
	overflow: hidden;
	border: 1px solid rgba(255, 107, 214, 0.55);
	border-radius: 999px;
	background: rgba(3, 12, 24, 0.8);
}

.boss-bar__fill {
	height: 100%;
	border-radius: inherit;
	background: linear-gradient(90deg, #ff4444, #ff6bd6);
	box-shadow: 0 0 14px rgba(255, 107, 214, 0.6);
	transition: width 0.15s linear;
}

.boss-bar__hp {
	margin-top: 3px;
	font-size: 11px;
	font-weight: 700;
	color: #ffdff5;
	opacity: 0.9;
	text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
}

.game-controls {
	position: absolute;
	right: 20px;
	bottom: 20px;
	z-index: 10;
	display: flex;
	gap: 6px;
}

.game-controls__btn {
	min-width: 40px;
	padding: 6px 10px;
	border: 1px solid rgba(53, 244, 255, 0.38);
	border-radius: 8px;
	background: rgba(3, 12, 24, 0.72);
	color: #dffcff;
	cursor: pointer;
	font: 700 12px/1.4 ui-sans-serif, system-ui, sans-serif;
	backdrop-filter: blur(12px);

	&--active {
		background: #35f4ff;
		color: #031018;
	}

	&:hover {
		background: rgba(53, 244, 255, 0.15);
	}

	&--active:hover {
		background: #35f4ff;
	}
}

.combat-log {
	position: absolute;
	left: 20px;
	bottom: 20px;
	z-index: 5;
	display: flex;
	flex-direction: column;
	gap: 3px;
	max-width: 320px;
	pointer-events: none;
}

.combat-log__entry {
	padding: 3px 10px;
	border-radius: 6px;
	background: rgba(3, 12, 24, 0.6);
	color: #dffcff;
	font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	font-size: 11px;
	line-height: 1.5;
	animation: log-entry-in 0.2s ease-out;
}

.combat-log__entry--kill {
	color: #ffd166;
}

.combat-log__entry--hurt {
	color: #ff8c87;
}

.combat-log__entry--level {
	color: #7dffa8;
	font-weight: 700;
}

.combat-log__entry--skill {
	color: #6bb8ff;
	font-weight: 700;
}

.combat-log__entry--boss {
	color: #ff6bd6;
	font-weight: 700;
}

@keyframes log-entry-in {
	from {
		opacity: 0;
		transform: translateX(-8px);
	}
	to {
		opacity: 1;
		transform: translateX(0);
	}
}

.day-summary {
	position: absolute;
	top: 64px;
	left: 50%;
	z-index: 8;
	padding: 12px 24px;
	border: 1px solid rgba(255, 200, 87, 0.5);
	border-radius: 12px;
	background: rgba(3, 12, 24, 0.82);
	text-align: center;
	transform: translateX(-50%);
	backdrop-filter: blur(12px);
	animation: summary-in 0.3s ease-out;
}

.day-summary__title {
	font-size: 14px;
	font-weight: 800;
	letter-spacing: 0.08em;
	color: #ffc857;
}

.day-summary__text {
	margin-top: 4px;
	font-size: 12px;
	color: #dffcff;
	opacity: 0.85;
}

@keyframes summary-in {
	from {
		opacity: 0;
		transform: translateX(-50%) translateY(-8px);
	}
	to {
		opacity: 1;
		transform: translateX(-50%) translateY(0);
	}
}

.level-up-card {
	position: absolute;
	top: 124px;
	left: 50%;
	z-index: 8;
	min-width: 240px;
	padding: 12px 24px;
	border: 1px solid rgba(53, 244, 255, 0.55);
	border-radius: 12px;
	background: rgba(3, 12, 24, 0.86);
	text-align: center;
	color: #dffcff;
	font-family: ui-sans-serif, system-ui, sans-serif;
	transform: translateX(-50%);
	animation: levelup-in 0.3s ease-out;
}

.level-up-card__title {
	font-size: 14px;
	font-weight: 800;
	color: #ffc857;
	letter-spacing: 0.06em;
}

.level-up-card__row {
	display: flex;
	gap: 12px;
	align-items: center;
	justify-content: center;
	margin-top: 4px;
	font-size: 13px;
}

.level-up-card__id {
	font-weight: 700;
	color: #35f4ff;
}

.level-up-card__hint {
	font-size: 10px;
	opacity: 0.6;
}

@keyframes levelup-in {
	from { opacity: 0; transform: translateX(-50%) translateY(-12px); }
	to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

.game-over-best {
	color: #ffc857 !important;
	font-weight: 700;
}

.game-over-meta {
	color: #35f4ff !important;
	font-weight: 600;
}

.game-over-autorestart {
	color: rgba(223, 252, 255, 0.72) !important;
	font-size: 13px;
	letter-spacing: 0.04em;
	animation: auto-restart-pulse 2s ease-in-out infinite;
}

@keyframes auto-restart-pulse {
	0%, 100% { opacity: 1; }
	50% { opacity: 0.45; }
}

@media (max-width: 600px) {
	.language-switcher {
		top: auto;
		bottom: calc(env(safe-area-inset-bottom, 0px) + 16px);
	}
}

@keyframes warning-pulse {
	0%, 100% { opacity: 1; }
	50% { opacity: 0.4; }
}

@keyframes fade-in {
	from { opacity: 0; }
	to { opacity: 1; }
}
</style>

<style lang="scss">
html,
body,
#app {
	width: 100%;
	height: 100%;
	margin: 0;
}

body {
	overflow: hidden;
}
</style>
