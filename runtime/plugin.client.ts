import { defineNuxtPlugin, useRuntimeConfig } from '#imports'
import './css/style.css'

export default defineNuxtPlugin(() => {
  if (typeof window === 'undefined') return

  const config = useRuntimeConfig()
  // 使用模块的configKey从public配置中获取，与module.ts保持一致
  const easyEditorConfig = config.public.easyEditor || {}

  // 注入配置到全局
  window.__VISUAL_EDITOR_CONFIG__ = {
    tagKey: easyEditorConfig.tagKey || 'easy-editor',
    sourceMap: easyEditorConfig.sourceMap || {},
    editCSS: easyEditorConfig.editCSS ?? false,
    debug: easyEditorConfig.debug ?? false
  }

  // 初始化编辑器
  import('./index').then((module) => {
    module.initVisualEditor(window.__VISUAL_EDITOR_CONFIG__)
  }).catch((error) => {
    console.error('[Visual Editor] Failed to initialize:', error)
  })
})

declare global {
  interface Window {
    __VISUAL_EDITOR_CONFIG__?: {
      tagKey: string | string[]
      sourceMap: Record<string, string[]>
      editCSS?: boolean
      debug?: boolean
    }
  }
}

