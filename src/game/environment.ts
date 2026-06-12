import type { Map as MapboxMap } from 'mapbox-gl'

import type { GameTimeConfig } from './time'

export function applyGameTimeEnvironment(
	map: MapboxMap,
	hour: number,
	timeConfig: Pick<GameTimeConfig, 'dayStartsAt' | 'nightStartsAt'>,
) {
	const isDaytime = hour >= timeConfig.dayStartsAt && hour < timeConfig.nightStartsAt
	applyTechMapStyle(map, isDaytime)
	applySky(map, isDaytime)
}

function applySky(map: MapboxMap, isDaytime: boolean) {
	map.setFog(
		isDaytime
			? {
					color: 'rgb(205, 230, 244)',
					'high-color': 'rgb(96, 188, 228)',
					'horizon-blend': 0.08,
					'space-color': 'rgb(186, 224, 246)',
					'star-intensity': 0,
				}
			: {
					color: 'rgb(46, 82, 112)',
					'high-color': 'rgb(28, 180, 220)',
					'horizon-blend': 0.12,
					'space-color': 'rgb(3, 7, 18)',
					'star-intensity': 0.48,
				},
	)
}

function applyTechMapStyle(map: MapboxMap, isDaytime: boolean) {
	const paintUpdates: Array<[string, string, unknown]> = [
		['water', 'fill-color', isDaytime ? '#9eddf2' : '#061b2f'],
		['land', 'background-color', isDaytime ? '#d8edf3' : '#07111f'],
		['landcover', 'fill-color', isDaytime ? '#c7e6e8' : '#081d28'],
		['national-park', 'fill-color', isDaytime ? '#b6e3d8' : '#0a2731'],
		['building', 'fill-color', isDaytime ? '#8fc4d2' : '#12344d'],
		['building', 'fill-opacity', isDaytime ? 0.52 : 0.62],
		['road-primary', 'line-color', '#2ee6ff'],
		['road-secondary-tertiary', 'line-color', '#1a9fb8'],
		['road-street', 'line-color', isDaytime ? '#48bdd2' : '#16677c'],
		['road-label', 'text-color', isDaytime ? '#075f75' : '#7defff'],
		['place-label', 'text-color', isDaytime ? '#073c52' : '#d5fbff'],
		['poi-label', 'text-color', isDaytime ? '#0a6470' : '#79dcea'],
	]

	paintUpdates.forEach(([layerId, property, value]) => {
		if (map.getLayer(layerId)) {
			map.setPaintProperty(layerId, property, value)
		}
	})
}
