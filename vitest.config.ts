import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Workers 运行时自带的虚拟模块，node 上解析不到（不给别名的话，import 到它的
      // 测试文件整个加载失败）。打包侧的对应处理是 build-workers.mjs 里的 external。
      'cloudflare:workers': new URL('./test/stubs/cloudflare-workers.ts', import.meta.url).pathname,
    },
  },
  test: {
    // Transform the UI library's CSS modules in browser component tests.
    server: { deps: { inline: ['animal-island-ui'] } },
    environment: 'node',
    setupFiles: ['./test-setup.ts'],
    include: [
      'utils/**/*.test.ts',
      'utils/storyTheaterUpstreamIntegration.test.tsx',
      'utils/largeHistoryStress.test.tsx',
      'worker/**/*.test.ts',
      'scripts/**/*.test.ts',
      // Reusable 3D motion architecture runs lightweight Node-only tests.
      'apps/room3d/**/*.test.ts',
      'apps/room3d/**/*.test.js',
    ],
    // 组件测试按需纳入，避免默认加载所有视觉测试。
    exclude: ['node_modules', '**/node_modules/**', '.worktrees', 'dist'],
  },
});
