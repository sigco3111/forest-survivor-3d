import { describe, expect, it, vi } from 'vitest'

import {
	DEFAULT_LOCALE,
	LOCALE_STORAGE_KEY,
	normalizeLocale,
	readStoredLocale,
	storeLocale,
} from '../../src/i18n/language'

describe('runtime language preferences', () => {
	it('defaults to English without browser-language detection', () => {
		expect(normalizeLocale(undefined)).toBe(DEFAULT_LOCALE)
		expect(readStoredLocale({ getItem: () => null })).toBe('en')
	})

	it('restores Simplified Chinese and rejects obsolete values', () => {
		expect(readStoredLocale({ getItem: () => 'zh-CN' })).toBe('zh-CN')
		expect(readStoredLocale({ getItem: () => 'zh' })).toBe('en')
	})

	it('persists an explicit language switch', () => {
		const setItem = vi.fn()
		storeLocale({ setItem }, 'zh-CN')
		expect(setItem).toHaveBeenCalledWith(LOCALE_STORAGE_KEY, 'zh-CN')
	})
})
