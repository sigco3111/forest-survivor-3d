export default defineNuxtConfig({
	compatibilityDate: '2026-06-12',
	runtimeConfig: {
		mysqlHost: process.env.MYSQL_HOST,
		mysqlPort: process.env.MYSQL_PORT,
		mysqlUser: process.env.MYSQL_USER,
		mysqlPassword: process.env.MYSQL_PASSWORD,
		mysqlDatabase: process.env.MYSQL_DATABASE,
		amapWebServiceKey: process.env.AMAP_WEB_SERVICE_KEY,
	},
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
					api: 'modern-compiler',
				},
			},
		},
	},
})
