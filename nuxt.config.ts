export default defineNuxtConfig({
	srcDir: 'src/',
	compatibilityDate: '2026-06-12',
	devtools: {
		enabled: false,
	},
	app: {
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
			link: [{ rel: 'icon', href: '/favicon.ico' }],
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
