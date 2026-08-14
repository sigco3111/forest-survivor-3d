# Forest Survivor 3D

<!-- repo-languages:start -->
[English](README.md) | 简体中文
<!-- repo-languages:end -->

<!-- repo-badges:start -->
[![Node.js 24](https://img.shields.io/badge/Node.js-24-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![pnpm 10.33.2](https://img.shields.io/badge/pnpm-10.33.2-F69220?style=flat-square&logo=pnpm&logoColor=white)](https://pnpm.io)
[![Nuxt 3.21.8](https://img.shields.io/badge/Nuxt-3.21.8-00DC82?style=flat-square&logo=nuxtdotjs&logoColor=white)](https://nuxt.com)
[![Vue 3.5.38](https://img.shields.io/badge/Vue-3.5.38-4FC08D?style=flat-square&logo=vuedotjs&logoColor=white)](https://vuejs.org)
[![Three.js 0.184.0](https://img.shields.io/badge/Three.js-0.184.0-000000?style=flat-square&logo=threedotjs&logoColor=white)](https://threejs.org)
[![Vite 7.3.5](https://img.shields.io/badge/Vite-7.3.5-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vite.dev)
[![TypeScript 5.8.3](https://img.shields.io/badge/TypeScript-5.8.3-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Test Coverage](https://img.shields.io/codecov/c/github/shenzhepei/forest-survivor-3d?style=flat-square&logo=codecov)](https://codecov.io/gh/shenzhepei/forest-survivor-3d)
[![License](https://img.shields.io/github/license/shenzhepei/forest-survivor-3d?style=flat-square)](https://github.com/shenzhepei/forest-survivor-3d/blob/HEAD/LICENSE)
[![Sponsor](https://img.shields.io/github/sponsors/shenzhepei?style=flat-square&logo=githubsponsors&label=Sponsor)](https://github.com/sponsors/shenzhepei)
<!-- repo-badges:end -->

一款运行在浏览器中的 3D 森林生存游戏。玩家需要在森林中持续收集木材，应对每日资源消耗，并避开巡逻、守卫和追击中的怪物。

**[在线试玩](https://shenzhepei.github.io/forest-survivor-3d/)**

## 游戏特色

- 基于 Three.js 的实时 3D 森林场景
- 自动移动、寻路和伐木的玩家 Agent
- 具备巡逻、守卫与追击行为的怪物 AI
- 昼夜循环与动态光照
- 木材收集、每日消耗和生存天数机制
- 小地图、跟随视角与自由视角切换

## 技术栈

- Nuxt 3
- Vue 3
- TypeScript
- Three.js
- WebGL

## 本地运行

```bash
pnpm install
pnpm dev
```

开发服务器默认运行在 `http://localhost:4000`。

## 构建

```bash
pnpm build
```

## 测试

```bash
pnpm test
pnpm test:coverage
pnpm test:build
```
