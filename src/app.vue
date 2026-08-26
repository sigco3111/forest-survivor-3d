<template>
	<ClientOnly>
		<GameScene />
	</ClientOnly>
</template>

<script lang="ts" setup>
const { locale, t } = useI18n()

useHead(() => ({
	htmlAttrs: { lang: locale.value },
	title: t('app.title'),
	meta: [{ name: 'description', content: t('app.description') }],
}))
</script>
