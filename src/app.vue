<template>
	<ClientOnly>
		<GameScene />
	</ClientOnly>
</template>

<script lang="ts" setup>
const { locale, t } = useI18n()

useHead(() => ({
	htmlAttrs: { lang: locale.value },
	title: t('meta.title'),
	meta: [{ name: 'description', content: t('meta.description') }],
}))
</script>
