export default defineNuxtConfig({
	srcDir: 'src/',
	dir: {
		public: '../public',
	},
	compatibilityDate: '2026-06-12',
	devtools: {
		enabled: false,
	},
	app: {
		baseURL: process.env.NUXT_APP_BASE_URL || '/',
		head: {
			htmlAttrs: {
				lang: 'zh',
			},
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
