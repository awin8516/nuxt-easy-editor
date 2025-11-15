import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    module: 'src/module.ts',
    'runtime/plugin.client': 'runtime/plugin.client.ts',
    'runtime/visual-editor': 'runtime/visual-editor.ts',
    'runtime/visual-editor-utils': 'runtime/visual-editor-utils.ts',
    'runtime/utils/shared-utils': 'runtime/utils/shared-utils.ts',
    'runtime/utils/server-utils': 'runtime/utils/server-utils.ts',
    'runtime/server/api/read-file': 'runtime/server/api/read-file.ts',
    'runtime/server/api/update-file': 'runtime/server/api/update-file.ts',
    'runtime/server/api/search-content': 'runtime/server/api/search-content.ts',
    'runtime/server/api/search-css': 'runtime/server/api/search-css.ts',
    'runtime/server/api/update-css': 'runtime/server/api/update-css.ts'
  },
  format: ['esm'],
  dts: {
    entry: {
      index: 'src/index.ts'
    }
  },
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['@nuxt/kit', 'nuxt', 'h3', '#app', '#imports'],
  outDir: 'dist',
  onSuccess: 'node scripts/copy-runtime-assets.mjs',
  // 修复构建问题的配置
  esbuildOptions(options) {
    options.platform = 'node';
    // 确保每个入口文件独立构建，不进行不必要的代码合并
    options.bundle = false;
  },
  // 确保每个文件独立编译
  noExternal: [],
  // 禁用可能导致文件合并的选项
  minify: false,
  bundle: false
})

