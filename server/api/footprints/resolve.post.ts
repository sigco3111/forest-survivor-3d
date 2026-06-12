import { resolvePendingFootprintAreas } from '../../utils/footprintAreaResolver'

export default defineEventHandler(async () => {
	return resolvePendingFootprintAreas()
})
