import {
	AnimationAction,
	AnimationClip,
	AnimationMixer,
	Object3D,
} from 'three'

export type PlayerAnimationName =
	| 'death'
	| 'idle'
	| 'interact'
	| 'run'
	| 'walk'
	| 'wave'

export type PlayerAnimationController = {
	actions: Record<PlayerAnimationName, AnimationAction | null>
	play: (name: PlayerAnimationName) => void
	update: (delta: number) => void
}

const PLAYER_ANIMATION_INDEX: Record<PlayerAnimationName, number> = {
	death: 0,
	idle: 3,
	interact: 10,
	run: 11,
	walk: 14,
	wave: 16,
}

const PLAYER_ANIMATION_PATTERN: Record<PlayerAnimationName, RegExp> = {
	death: /(?:^|\|)death$/i,
	idle: /(?:^|\|)idle$/i,
	interact: /(?:^|\|)(?:interact|punch|idle_attack)$/i,
	run: /(?:^|\|)run$/i,
	walk: /(?:^|\|)walk$/i,
	wave: /(?:^|\|)wave$/i,
}

export function createPlayerAnimationController(
	model: Object3D,
	animations: AnimationClip[],
	defaultAnimation: PlayerAnimationName = 'walk',
): PlayerAnimationController {
	const mixer = new AnimationMixer(model)
	const actions: Record<PlayerAnimationName, AnimationAction | null> = {
		death: createAction(mixer, animations, 'death'),
		idle: createAction(mixer, animations, 'idle'),
		interact: createAction(mixer, animations, 'interact'),
		run: createAction(mixer, animations, 'run'),
		walk: createAction(mixer, animations, 'walk'),
		wave: createAction(mixer, animations, 'wave'),
	}
	let currentAction: AnimationAction | null = null

	const play = (name: PlayerAnimationName) => {
		const nextAction = actions[name]
		if (!nextAction || nextAction === currentAction) return

		nextAction.reset().fadeIn(0.2).play()
		currentAction?.fadeOut(0.2)
		currentAction = nextAction
	}

	play(defaultAnimation)

	return {
		actions,
		play,
		update: delta => mixer.update(delta),
	}
}

function createAction(
	mixer: AnimationMixer,
	animations: AnimationClip[],
	name: PlayerAnimationName,
) {
	const clip =
		animations.find(animation => PLAYER_ANIMATION_PATTERN[name].test(animation.name)) ??
		animations[PLAYER_ANIMATION_INDEX[name]]
	return clip ? mixer.clipAction(clip) : null
}
