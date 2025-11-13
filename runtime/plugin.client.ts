import { defineNuxtPlugin, useRuntimeConfig } from '#imports'
import './visual-editor.css'

export default defineNuxtPlugin(() => {
  if (typeof window === 'undefined') return

  const config = useRuntimeConfig()
  const visualEditorConfig = config.public.visualEditor || {}

  // 注入配置到全局
  window.__VISUAL_EDITOR_CONFIG__ = {
    tagKey: visualEditorConfig.tagKey || 'easy-editor',
    sourceMap: visualEditorConfig.sourceMap || {},
    searchHtml: visualEditorConfig.searchHtml ?? false,
    editCSS: visualEditorConfig.editCSS ?? false
  }

  // 初始化编辑器
  import('./visual-editor').then((module) => {
    module.initVisualEditor()
  }).catch((error) => {
    console.error('[Visual Editor] Failed to initialize:', error)
  })
})

declare global {
  interface Window {
    __VISUAL_EDITOR_CONFIG__?: {
      tagKey: string | string[]
      sourceMap: Record<string, string[]>
      searchHtml?: boolean
      editCSS?: boolean
    }
  }
}

