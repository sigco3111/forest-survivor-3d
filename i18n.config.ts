import { defineI18nConfig } from '#i18n'

import { messages } from './src/i18n/messages'

export default defineI18nConfig(() => ({
	legacy: false,
	locale: 'ko',
	fallbackLocale: 'en',
	messages,
}))
