import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
	base: './',
	plugins: [vue()],
	resolve: {
		alias: {
			'@': resolve('src'),
			'@typings': resolve('typings'),
		},
		extensions: ['.js', '.ts', '.json', '.vue'],
	},
	server: {
		port: 4000,
		host: '0.0.0.0',
		open: true,
	},
	css: {
		preprocessorOptions: {
			scss: {
				api: 'modern-compiler',
			},
		},
	},
})
