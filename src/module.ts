import { defineNuxtModule, addPlugin, addServerHandler } from '@nuxt/kit'
import { fileURLToPath } from 'url'
import { resolve, dirname } from 'path'
import { existsSync } from 'fs'

// 获取当前文件所在目录（ESM 模式）
const _dirname = dirname(fileURLToPath(import.meta.url))

const runtimeSearchDirs = [
  // dist build output (e.g. dist/runtime)
  resolve(_dirname, 'runtime'),
  // source runtime directory when using the module locally
  resolve(_dirname, '../runtime')
]

const runtimeExtensions = ['.mjs', '.js', '.ts']

function resolveRuntimeFile(relativePath: string) {
  for (const dir of runtimeSearchDirs) {
    for (const ext of runtimeExtensions) {
      const candidate = resolve(dir, `${relativePath}${ext}`)
      if (existsSync(candidate)) {
        return candidate
      }
    }
  }
  throw new Error(`[nuxt-easy-editor] Runtime file not found: ${relativePath}`)
}

export interface VisualEditorConfig {
  tagKey?: string | string[]
  sourceMap?: Record<string, string[]>
  searchHtml?: boolean
  editCSS?: boolean
}

export default defineNuxtModule<VisualEditorConfig>({
  meta: {
    name: 'nuxt-easy-editor',
    configKey: 'visualEditor'
  },
  defaults: {
    tagKey: 'easy-editor',
    sourceMap: {},
    searchHtml: false,
    editCSS: false
  },
  setup(options, nuxt) {
    // 只在开发环境启用
    if (nuxt.options.dev) {
      // 将配置注入到 runtimeConfig
      nuxt.options.runtimeConfig.public = nuxt.options.runtimeConfig.public || {}
      nuxt.options.runtimeConfig.public.visualEditor = {
        tagKey: options.tagKey || 'easy-editor',
        sourceMap: options.sourceMap || {},
        searchHtml: options.searchHtml ?? false,
        editCSS: options.editCSS ?? false
      }

      // 添加客户端插件
      addPlugin({
        src: resolveRuntimeFile('plugin.client'),
        mode: 'client'
      })

      // 添加服务端 API 路由
      addServerHandler({
        route: '/api/visual-editor/read-file',
        handler: resolveRuntimeFile('server/api/read-file')
      })

      addServerHandler({
        route: '/api/visual-editor/update-file',
        handler: resolveRuntimeFile('server/api/update-file')
      })

      addServerHandler({
        route: '/api/visual-editor/search-content',
        handler: resolveRuntimeFile('server/api/search-content')
      })

      // 添加 CSS 编辑相关的 API 路由（仅在 editCSS 为 true 时）
      if (options.editCSS) {
        addServerHandler({
          route: '/api/visual-editor/search-css',
          handler: resolveRuntimeFile('server/api/search-css')
        })

        addServerHandler({
          route: '/api/visual-editor/update-css',
          handler: resolveRuntimeFile('server/api/update-css')
        })
      }
    }
  }
})

