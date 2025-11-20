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
  editCSS?: boolean
  debug?: boolean
}

export default defineNuxtModule<VisualEditorConfig>({
  meta: {
    name: 'nuxt-easy-editor',
    configKey: 'easyEditor'
  },
  defaults: {
    tagKey: 'easy-editor',
    sourceMap: {},
    editCSS: false,
    debug: false
  },
  setup(options, nuxt) {
    // 只在开发环境启用（第一要求）
    if (nuxt.options.dev) {
      // 将配置注入到 runtimeConfig
      nuxt.options.runtimeConfig.public = nuxt.options.runtimeConfig.public || {}
      // 使用模块的configKey作为public配置属性名，确保配置正确传递
      nuxt.options.runtimeConfig.public.easyEditor = {
        tagKey: options.tagKey || 'easy-editor',
        sourceMap: options.sourceMap || {},
        // 默认支持HTML搜索，不再需要searchHtml配置
        editCSS: options.editCSS ?? false,
        debug: options.debug ?? false
      }

      // 添加客户端插件
      addPlugin({
        src: resolveRuntimeFile('plugin.client'),
        mode: 'client'
      })

      // 添加服务端 API 路由
      addServerHandler({
        route: '/api/easy-editor/read-file',
        handler: resolveRuntimeFile('server/api/read-file')
      })

      addServerHandler({
        route: '/api/easy-editor/search-content',
        handler: resolveRuntimeFile('server/api/search-content')
      })

      addServerHandler({
        route: '/api/easy-editor/update-content',
        handler: resolveRuntimeFile('server/api/update-content')
      })

      // 添加 CSS 编辑相关的 API 路由（仅在 editCSS 为 true 时）
      if (options.editCSS) {
        addServerHandler({
          route: '/api/easy-editor/search-css',
          handler: resolveRuntimeFile('server/api/search-css')
        })

        addServerHandler({
          route: '/api/easy-editor/update-css',
          handler: resolveRuntimeFile('server/api/update-css')
        })
      }
    }
  }
})

