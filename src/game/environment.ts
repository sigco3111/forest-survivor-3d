import type { Map as MapboxMap } from 'mapbox-gl'

export function applyGameTimeEnvironment(map: MapboxMap) {
	applyTechMapStyle(map)
	applySky(map)
}

function applySky(map: MapboxMap) {
	map.setFog({
		color: 'rgb(46, 82, 112)',
		'high-color': 'rgb(28, 180, 220)',
		'horizon-blend': 0.12,
		'space-color': 'rgb(3, 7, 18)',
		'star-intensity': 0.48,
	})
}

function applyTechMapStyle(map: MapboxMap) {
	const paintUpdates: Array<[string, string, unknown]> = [
		['water', 'fill-color', '#061b2f'],
		['land', 'background-color', '#07111f'],
		['landcover', 'fill-color', '#081d28'],
		['national-park', 'fill-color', '#0a2731'],
		['building', 'fill-color', '#12344d'],
		['building', 'fill-opacity', 0.62],
		['road-primary', 'line-color', '#2ee6ff'],
		['road-secondary-tertiary', 'line-color', '#1a9fb8'],
		['road-street', 'line-color', '#16677c'],
		['road-label', 'text-color', '#7defff'],
		['place-label', 'text-color', '#d5fbff'],
		['poi-label', 'text-color', '#79dcea'],
	]

	paintUpdates.forEach(([layerId, property, value]) => {
		if (map.getLayer(layerId)) {
			map.setPaintProperty(layerId, property, value)
		}
	})
}
