const baseURL = process.env.NUXT_APP_BASE_URL || '/'

export default defineNuxtConfig({
	srcDir: 'src/',
	modules: ['@nuxtjs/i18n'],
	i18n: {
		defaultLocale: 'ko',
		locales: [
			{ code: 'en', language: 'en' },
			{ code: 'zh-CN', language: 'zh-CN' },
			{ code: 'ko', language: 'ko' },
		],
		strategy: 'no_prefix',
		detectBrowserLanguage: false,
		vueI18n: '../i18n.config.ts',
	},
	dir: {
		public: '../public',
	},
	compatibilityDate: '2026-06-12',
	devtools: {
		enabled: false,
	},
	app: {
		baseURL,
		head: {
			htmlAttrs: {
				lang: 'ko',
			},
			link: [{ rel: 'icon', type: 'image/png', href: `${baseURL}favicon.png` }],
			meta: [
				{ charset: 'utf-8' },
				{
					name: 'viewport',
					content:
						'width=device-width, viewport-fit=cover, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no',
				},
			],
		},
	},
	vite: {
		css: {
		preprocessorOptions: {
			scss: {
			},
		},
		},
	},
})
