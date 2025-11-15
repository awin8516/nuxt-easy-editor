export interface Match {
  file: string
  line: number
  context: string
  originalContent: string
}

export interface CssMatch {
  file: string
  selector: string
  rules: string
  line: number
  context: string
  isScoped?: boolean
}

export interface EditorState {
  element: HTMLElement | null
  originalContent: string
  matches: Match[]
  isEditing: boolean
}

export type SourceMap = Record<string, string[]>

export interface VisualEditorRuntimeConfig {
  tagKey: string | string[]
  sourceMap: SourceMap
  searchHtml?: boolean
  editCSS?: boolean
}

declare global {
  interface Window {
    __VISUAL_EDITOR_CONFIG__?: VisualEditorRuntimeConfig
  }
}