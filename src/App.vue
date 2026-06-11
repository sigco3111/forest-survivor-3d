<template>
	<div class="map-stage">
		<div ref="mapContainer" class="amap-container"></div>
		<div class="custom-sky" aria-hidden="true"></div>
	</div>
</template>

<script lang="ts" setup>
import AMapLoader from '@amap/amap-jsapi-loader'
import { onMounted, onUnmounted, ref } from 'vue'

defineOptions({
	name: 'App',
})

const mapContainer = ref<HTMLDivElement | null>(null)
let map: any = null

onMounted(async () => {
	window._AMapSecurityConfig = {
		securityJsCode: '6171dc6a7993ecde4079b2646d36f5bb',
	}

	const AMap = await AMapLoader.load({
		key: '95b533dc58b44f3cbae93cd9efff0858',
		version: '2.1Beta',
	})

	map = new AMap.Map(mapContainer.value, {
		viewMode: '3D',
		terrain: true,
		zoom: 12,
		pitch: 65,
		rotation: -15,
		center: [114.933, 25.831],
		mapStyle: 'amap://styles/normal',
	})
})

onUnmounted(() => {
	map?.destroy()
	map = null
})
</script>

<style lang="scss" scoped>
.map-stage {
	position: relative;
	width: 100vw;
	height: 100vh;
	overflow: hidden;
	background: #050810;
}

.amap-container {
	position: absolute;
	inset: 0;
}

.custom-sky {
	position: absolute;
	z-index: 10;
	top: 0;
	right: 0;
	left: 0;
	height: 54vh;
	pointer-events: none;
	background-image: url('/sky/sky.jpg');
	background-repeat: no-repeat;
	background-position: center top;
	background-size: cover;
	opacity: 0.96;
	mix-blend-mode: screen;
	mask-image: linear-gradient(to bottom, #000 0%, #000 54%, rgb(0 0 0 / 72%) 72%, transparent 100%);
	-webkit-mask-image: linear-gradient(to bottom, #000 0%, #000 54%, rgb(0 0 0 / 72%) 72%, transparent 100%);
}
</style>

<style lang="scss">
html,
body,
#app {
	width: 100%;
	height: 100%;
	margin: 0;
}

body {
	overflow: hidden;
}

.amap-logo,
.amap-copyright,
.amap-scalecontrol,
.amap-controlbar,
.amap-toolbar,
.amap-maptype,
.amap-overviewcontrol {
	display: none !important;
}
</style>
