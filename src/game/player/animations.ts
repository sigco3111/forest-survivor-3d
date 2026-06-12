import {
	AnimationAction,
	AnimationClip,
	AnimationMixer,
	Object3D,
} from 'three'

export type PlayerAnimationName = 'idle' | 'walk' | 'run'

export type PlayerAnimationController = {
	actions: Record<PlayerAnimationName, AnimationAction | null>
	play: (name: PlayerAnimationName) => void
	update: (delta: number) => void
}

const PLAYER_ANIMATION_INDEX: Record<PlayerAnimationName, number> = {
	idle: 0,
	walk: 3,
	run: 1,
}

export function createPlayerAnimationController(
	model: Object3D,
	animations: AnimationClip[],
	defaultAnimation: PlayerAnimationName = 'walk',
): PlayerAnimationController {
	const mixer = new AnimationMixer(model)
	const actions = {
		idle: createAction(mixer, animations, PLAYER_ANIMATION_INDEX.idle),
		walk: createAction(mixer, animations, PLAYER_ANIMATION_INDEX.walk),
		run: createAction(mixer, animations, PLAYER_ANIMATION_INDEX.run),
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
	index: number,
) {
	const clip = animations[index]
	return clip ? mixer.clipAction(clip) : null
}
