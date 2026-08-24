import { describe, expect, it, vi } from 'vitest'

import {
	DEFAULT_LOCALE,
	LOCALE_STORAGE_KEY,
	normalizeLocale,
	readStoredLocale,
	storeLocale,
} from '../../src/i18n/language'

describe('runtime language preferences', () => {
	it('defaults to Korean without browser-language detection', () => {
		expect(normalizeLocale(undefined)).toBe(DEFAULT_LOCALE)
		expect(readStoredLocale({ getItem: () => null })).toBe('ko')
	})

	it('restores Simplified Chinese and rejects obsolete values', () => {
		expect(readStoredLocale({ getItem: () => 'zh-CN' })).toBe('zh-CN')
		expect(readStoredLocale({ getItem: () => 'zh' })).toBe(DEFAULT_LOCALE)
	})

	it('persists an explicit language switch', () => {
		const setItem = vi.fn()
		storeLocale({ setItem }, 'zh-CN')
		expect(setItem).toHaveBeenCalledWith(LOCALE_STORAGE_KEY, 'zh-CN')
	})
})
