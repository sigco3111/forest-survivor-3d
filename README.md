# Forest Survivor 3D

<!-- repo-languages:start -->
English | [简体中文](README-zh-CN.md)
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

A browser-based 3D forest survival game. Collect wood continuously, meet the
daily resource cost, and avoid monsters while they patrol, guard, and chase.

**[Play online](https://shenzhepei.github.io/forest-survivor-3d/)**

## Features

- Real-time 3D forest environment powered by Three.js
- Player agent with automatic movement, pathfinding, and woodcutting
- Monster AI with patrol, guard, and chase behaviors
- Day-night cycle with dynamic lighting
- Wood collection, daily consumption, and survival-day mechanics
- Minimap, follow camera, and free-camera modes

## Tech Stack

- Nuxt 3
- Vue 3
- TypeScript
- Three.js
- WebGL

## Local Development

```bash
pnpm install
pnpm dev
```

The development server runs at `http://localhost:4000` by default.

## Build

```bash
pnpm build
```

## Test

```bash
pnpm test
pnpm test:coverage
pnpm test:build
```
