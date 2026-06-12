import {
	AnimationAction,
	AnimationClip,
	AnimationMixer,
	Object3D,
} from 'three'

export type MonsterAnimationName = 'idle' | 'walk' | 'run' | 'attack' | 'death' | 'hit'

export type MonsterAnimationController = {
	play: (name: MonsterAnimationName) => void
	update: (delta: number) => void
}

const ANIMATION_PATTERN: Record<MonsterAnimationName, RegExp> = {
	idle: /(?:^|\|)idle$/i,
	walk: /(?:^|\|)walk$/i,
	run: /(?:^|\|)run$/i,
	attack: /(?:^|\|)attack$/i,
	death: /(?:^|\|)death$/i,
	hit: /(?:^|\|)hitrecieve$/i,
}

const ANIMATION_FALLBACK: Record<MonsterAnimationName, number> = {
	idle: 3,
	walk: 6,
	run: 5,
	attack: 0,
	death: 1,
	hit: 2,
}

export function createMonsterAnimationController(
	model: Object3D,
	animations: AnimationClip[],
	defaultAnimation: MonsterAnimationName = 'idle',
): MonsterAnimationController {
	const mixer = new AnimationMixer(model)
	const actions: Record<MonsterAnimationName, AnimationAction | null> = {
		idle: createAction(mixer, animations, 'idle'),
		walk: createAction(mixer, animations, 'walk'),
		run: createAction(mixer, animations, 'run'),
		attack: createAction(mixer, animations, 'attack'),
		death: createAction(mixer, animations, 'death'),
		hit: createAction(mixer, animations, 'hit'),
	}
	let currentAction: AnimationAction | null = null

	const play = (name: MonsterAnimationName) => {
		const nextAction = actions[name]
		if (!nextAction || nextAction === currentAction) return

		nextAction.reset().fadeIn(0.15).play()
		currentAction?.fadeOut(0.15)
		currentAction = nextAction
	}

	play(defaultAnimation)

	return {
		play,
		update: delta => mixer.update(delta),
	}
}

function createAction(
	mixer: AnimationMixer,
	animations: AnimationClip[],
	name: MonsterAnimationName,
) {
	const clip =
		animations.find(a => ANIMATION_PATTERN[name].test(a.name)) ??
		animations[ANIMATION_FALLBACK[name]]
	return clip ? mixer.clipAction(clip) : null
}
