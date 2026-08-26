# 업적 시스템 설계 제안

> 상태: **구현 완료** — 본 문서는 설계 근거를 남기기 위한 기록이다.
> 제안 시점 커밋: `0274bb3` / 구현: `src/game/achievements.ts` + `ACHIEVEMENT_CONFIG`
> (세부 수치·파일명은 구현 과정에서 일부 조정됐다. 코드가 원본이다.)

## 1. 목표

관전형 방치 러프에 "장기 목표"를 얹는다. 티어 사다리(보스 토벌 → 티어+1)가
단일 축의 성장이라면, 업적은 **여러 축의 누적을 보여주는 배지 + 즉시 메타 XP 보너스**다.
핵심 원칙은 두 가지다.

1. **새 측정원을 만들지 않는다.** 패시브 트리(`passiveTreeState`)가 이미 런 진행을
   카운터로 수집하고 있다. 업적은 그 카운터의 **읽기 전용 소비자**다.
2. **보상은 메타 XP 한 통로다.** 달성해도 런 밸런스를 흔들지 않고
   `META_CONFIG` 경유 XP만 지급한다(= 다음 런 시작 보너스로 환원).

## 2. 측정원: PassiveProgress 재활용

```ts
// src/game/player/passive-tree.ts — 이미 존재하는 카운터
export type PassiveProgress = {
  level: number
  totalKills: number          // → "총 처치 N" 계열 업적
  speciesKills: Record<string, number>  // → 종족별 업적 (Goblin/Skeleton/…)
  bossKills: number           // → 보스 토벌 = 티어 사다리 진행도 업적
  cardChoiceCount: number     // → 빌드 다양성 업적
  dayReached: number          // → 생존 일차 업적
}
```

- 패시브 트리의 `recordKill / recordCardChoice / recordDayReached` 호출 지점이
  곧 업적 평가 트리거다. **카운터 자체는 건드리지 않는다.**
- 런 중간 평가(실시간 토스트)와 런 종료 정산 두 군데서 같은 술어를 쓴다.
  - 실시간: `updateMonsters` 뒤 씬 레이어가 `agent.passiveTreeState.progress`를 읽고 평가.
    (패시브 노드 해금 알림과 동일한 타이밍)
  - 정산: `recordRun()`에서 최종 스냅샷으로 한 번 더 평가 (놓친 것 없이).

### 상태이상 확장 여지 (선택)

상태이상 도입으로 "기절 누적 N회" 같은 새 카운터 후보가 생겼다. 다만
`PassiveProgress`를 늘리면 세이브 v2 검증(save.ts) 필드 추가가 따라오므로,
1차 업적 세트는 기존 5개 카운터만 쓰고, 필요하면 v2 마이그레이션과 함께
`statusInflicted?: Record<string, number>`를 별도 단계로 추가한다.

## 3. 데이터 모델

설정은 전부 `src/config.ts`에 (프로젝트 관례). 순수 규칙은 신규
`src/game/achievements.ts`(예정)로 분리 — Vue/three 금지, 100% 커버리지 대상.

```ts
// src/config.ts에 추가될 형태 (초안)
export const ACHIEVEMENT_CONFIG = {
  definitions: [
    { id: 'kills.100',   trigger: { totalKills: 100 },        metaXpReward: 30 },
    { id: 'kills.500',   trigger: { totalKills: 500 },        metaXpReward: 80 },
    { id: 'boss.5',      trigger: { bossKills: 5 },           metaXpReward: 120 },
    { id: 'goblin.50',   trigger: { speciesKills: { name: 'Goblin', count: 50 } }, metaXpReward: 40 },
    { id: 'cards.25',    trigger: { cardChoiceCount: 25 },    metaXpReward: 35 },
    { id: 'day.15',      trigger: { dayReached: 15 },         metaXpReward: 60 },
  ],
} as import('~/game/achievements').AchievementConfig
```

- `trigger`는 패시브 노드(`PASSIVE_TREE_CONFIG`)의 트리거 스키마를 **그대로 재사용**한다.
  판정 함수도 `findPassiveUnlocks`의 조건 비교 로직을 추출해 공유하는 것을 권장.
  두 시스템이 같은 문법을 공유하면 "패시브=런 내 1회 버프 / 업적=영구 배지+XP"라는
  차이만 남고, 정의 실수가 줄어든다.

### 영구 상태 (MetaState 확장)

업적 달성 여부는 **메타 저장소**(localStorage `forest-survivor-meta:v1`)에 귀속된다.
런 저장소가 아니므로 리셋돼도 배지가 유지된다.

```ts
// MetaState v2에 필드 하나 추가 (v3 마이그레이션 또는 v2 후행 필드로)
unlockedAchievements: string[]   // 예: ['kills.100', 'boss.5']
```

- 마이그레이션은 기존 패턴(`v1→v2`의 `unlockedPerks` 추가)을 따른다:
  구버전 저장에 빈 배열 채우기 + 손상 값은 무시.
- `pendingAchievements: string[]`는 영구 저장하지 않고 런 메모리로만 —
  HUD 토스트 큐는 `pendingPassiveUnlocks`와 같은 "표시 후 비움" 계약.

## 4. 지급 경로: META_CONFIG 경유

```
recordKill()/recordDayReached()  (기존, 수정 없음)
        └─ progress 카운터 증가
             └─ evaluateAchievements(progress, ACHIEVEMENT_CONFIG, unlockedIds)   ← 순수 함수
                  ├─ 새로 달성된 id 목록 반환 (부작용 없음)
                  └─ 씬 레이어가 받아서:
                       1. metaState.unlockedAchievements에 id 추가
                       2. applyRawXp(metaState, definition.metaXpReward)  ← 기존 함수 재사용
                          · computeRunXp()와 별개 — 런 종료 정산 XP와 합산되되 이중 계산 아님
                       3. saveMetaState(localStorage, metaState)  (기존 트랜잭션 유지)
                       4. logEvent + showToast(t('hud.log.achievement', { name }))
```

- `applyRawXp(state, xp)`는 이미 "런 카운터 오염 없는 순수 XP 주입"으로 구현돼 있어
  그대로 쓴다. 업적 보너스가 `RunSummary` 통계와 섞이지 않는다.
- 지급 타이밍: **달성 즉시**(런 도중이라도). 방치 게임 특성상 관전자에게
  즉각 피드백이 중요하고, 저장은 멱등(달성 집합 기반)이라 중복 지급이 없다.

## 5. 모듈 설계 (구현 시 파일 지도)

| 파일 | 역할 |
|---|---|
| `src/game/achievements.ts` | `evaluateAchievements(progress, config, unlocked)` 순수 함수 + 타입. 불변, 결정론 |
| `src/config.ts` | `ACHIEVEMENT_CONFIG` 정의 (id/trigger/metaXpReward) |
| `src/game/meta-progression.ts` | `MetaState.unlockedAchievements` + 마이그레이션 + `unlockAchievements(state, ids, config)` 헬퍼 |
| `GameScene.client.vue` | 패시브 해금 알림 옆 평가 호출, 토스트/로그, 정산 시 재평가 |
| `tests/unit/achievements.test.ts` | 경계값(정확히 임계 도달), 중복 방지, 다중 동시 달성, 손상 저장 |

## 6. i18n

키는 flat dot 네임스페이스 관례대로:

```
hud.log.achievement: 'Achievement unlocked: {name} (+{xp} meta XP)'  (en)
                     '成就达成：{name}（元经验 +{xp}）'               (zh-CN)
                     '업적 달성: {name} (메타 XP +{xp})'              (ko)
achievement.<id>: 각 정의의 표시명 — en 선작성 후 zh-CN·ko 동시 등록
```

`MessageSchema = typeof messages.en`이므로 en 먼저, 나머지 두 로캘 즉시 미러링.

## 7. 의도적 제외 (Non-goals)

- **런 내 스탯 보너스 없음**: 업적은 메타 XP만 준다. 런 밸런스는 프리셋/카드/스킬트리/패시브 트리가 담당.
- **포인트/코인 화폐화 없음**: META_PERK_CONFIG의 레벨 기반 perk가 이미 보상 체계를 갖고 있다. 이중 화폐는 만들지 않는다.
- **도전 과제형 난이도 곡선 튜닝 없음**: 정의는 config 배열이므로 밸런싱은 데이터 수정만으로 가능.

## 8. 구현 착수 체크리스트 (차기 세션용)

1. `achievements.ts` 순수 모듈 + `tests/unit/achievements.test.ts` (커버리지 100% 게이트)
2. `MetaState` v2 후행 필드 or v3 마이그레이션 — `save.test.ts` 회귀 포함
3. `ACHIEVEMENT_CONFIG` 정의 10~15종 (총 처치/종족별 3종/보스/카드/일차 축 골고루)
4. GameScene 연결: 평가 시점 2곳(실시간/정산), 토스트, i18n 3 로캘
5. `pnpm test:coverage && pnpm generate` — vue-tsc 신규 오류 0 유지
