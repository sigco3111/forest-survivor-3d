export const APP_LOCALES = ['ko', 'en', 'zh-CN'] as const
export const DEFAULT_LOCALE = 'ko'
export const LOCALE_STORAGE_KEY = 'forest-survivor-locale'

export type AppLocale = (typeof APP_LOCALES)[number]

export function normalizeLocale(value: unknown): AppLocale {
	return APP_LOCALES.includes(value as AppLocale) ? value as AppLocale : DEFAULT_LOCALE
}

export function readStoredLocale(storage: Pick<Storage, 'getItem'>): AppLocale {
	return normalizeLocale(storage.getItem(LOCALE_STORAGE_KEY))
}

export function storeLocale(storage: Pick<Storage, 'setItem'>, locale: AppLocale): void {
	storage.setItem(LOCALE_STORAGE_KEY, locale)
}
