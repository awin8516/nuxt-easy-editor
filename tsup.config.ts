import { defineConfig } from 'tsup'

export default defineConfig({
  // 使用对象形式的入口配置，这是最标准的方式
  entry: {
    index: 'src/index.ts',
    module: 'src/module.ts',
    'runtime/plugin.client': 'runtime/plugin.client.ts',
    'runtime/index': 'runtime/index.ts',
    'runtime/edit-content': 'runtime/edit-content.ts',
    'runtime/edit-css': 'runtime/edit-css.ts',
    'runtime/server/api/read-file': 'runtime/server/api/read-file.ts',
    'runtime/server/api/search-content': 'runtime/server/api/search-content.ts',
    'runtime/server/api/search-css': 'runtime/server/api/search-css.ts',
    'runtime/server/api/update-content': 'runtime/server/api/update-content.ts',
    'runtime/server/api/update-css': 'runtime/server/api/update-css.ts',
    'runtime/server/api/utils': 'runtime/server/api/utils.ts'
  },
  // 只输出ESM格式，现代标准
  format: ['esm'],
  // 只为主入口生成类型定义
  dts: {
    entry: {
      index: 'src/index.ts'
    }
  },
  // 禁用代码分割以避免复杂的导入问题
  splitting: false,
  // 生成sourcemap
  sourcemap: true,
  // 构建前清理
  clean: true,
  // 排除外部依赖
  external: ['@nuxt/kit', 'nuxt', 'h3', '#app', '#imports'],
  // 输出目录
  outDir: 'dist',
  // 保留文件结构
  preserveModules: true,
  // 构建成功后复制资源
  onSuccess: 'node scripts/copy-runtime-assets.mjs',
  // 基础配置，避免过多自定义
  minify: false,
  // 禁用打包以避免类型冲突
  bundle: false
})

