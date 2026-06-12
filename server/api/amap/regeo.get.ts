import { resolveAmapArea } from '../../utils/amapRegeo'

export default defineEventHandler(async event => {
	const query = getQuery(event)
	const location = String(query.location ?? '')
	return resolveAmapArea(location)
})
