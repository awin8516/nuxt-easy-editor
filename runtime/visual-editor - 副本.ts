// 共享接口定义
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

export interface ElementInfo {
  tag: string
  classes: string[]
  id: string | null
  parentInfo: Array<{ tag: string; classes: string[]; id: string | null }>
  selectorPath: string
}

export interface EditorState {
  element: HTMLElement | null
  originalContent: string
  matches: Match[]
  isEditing: boolean
}

export interface VisualEditorRuntimeConfig {
  sourceMap: SourceMap
  tagKey?: string
  searchHtml?: boolean
  editCSS?: boolean
}

export interface SourceMap {
  [key: string]: string[]
}

// 全局状态管理
let editorState: EditorState = {
  element: null,
  originalContent: '',
  matches: [],
  isEditing: false
}

// 全局变量
export let editorComponent: any = null
export let hideButtonTimeout: number | null = null
export let currentButton: HTMLElement | null = null
let highlightedElement: HTMLElement | null = null

// Setter函数用于修改highlightedElement
export function setHighlightedElement(element: HTMLElement | null) {
  highlightedElement = element;
}

// Setter函数用于修改editorState
export function setEditorState(state: Partial<EditorState>) {
  editorState = { ...editorState, ...state };
}

// Getter函数用于获取editorState
export function getEditorState(): EditorState {
  return editorState;
}

export type SourceMap = Record<string, string[]>

const wildcardRegexCache = new Map<string, RegExp>()

export interface VisualEditorRuntimeConfig {
  tagKey: string | string[]
  sourceMap: SourceMap
  editCSS?: boolean
}

declare const window: Window & typeof globalThis & {
  __VISUAL_EDITOR_CONFIG__?: VisualEditorRuntimeConfig
}

// 仅导入当前文件需要使用的函数，避免重复导入
import { enableInlineEdit, generateContentVariants, startEdit } from './visual-editor-content'

/**
 * 规范化路径名，处理各种路径格式转换和标准化
 * @param pathname 原始路径名
 * @returns 规范化后的路径名
 */
export function normalizePathname(pathname: string): string {
  if (!pathname) return '/'

  try {
    pathname = decodeURIComponent(pathname)
  } catch {
    // ignore decoding errors and use original pathname
  }

  let normalized = pathname
    .split('#')[0]
    .split('?')[0]
    .replace(/\\/g, '/')

  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`
  }

  if (normalized.endsWith('.html')) {
    normalized = normalized.slice(0, -5)
  }

  if (normalized !== '/' && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }

  if (normalized === '' || normalized === '/') {
    return '/'
  }

  if (normalized.endsWith('/index')) {
    const trimmed = normalized.slice(0, -6)
    return trimmed === '' ? '/' : trimmed
  }

  if (normalized === '/index') {
    return '/'
  }

  return normalized || '/'
}

/**
 * 构建路径候选列表，生成可能的路径变体
 * @param pathname 原始路径名
 * @returns 路径候选数组
 */
export function buildPathCandidates(pathname: string): string[] {
  const normalized = normalizePathname(pathname)
  const candidates = new Set<string>()

  candidates.add(normalized)

  if (normalized !== '/' && !normalized.endsWith('/')) {
    candidates.add(`${normalized}/`)
  }

  if (normalized !== '/') {
    const withoutIndex = normalized.replace(/\/index$/i, '') || '/'
    candidates.add(withoutIndex === '' ? '/' : withoutIndex)
  }

  const segments = normalized.split('/').filter(Boolean)
  if (segments.length > 0) {
    const withoutLocale = `/${segments.slice(1).join('/')}`
    candidates.add(withoutLocale === '//' ? '/' : withoutLocale || '/')
    
    // 添加路径前缀的通配符候选，用于更好地匹配配置中的通配符路径
    // 例如对于/works/11，会生成/work/*这样的候选
    if (segments.length > 1) {
      for (let i = 1; i < segments.length; i++) {
        // 生成前缀路径（不包括最后一个段）并添加通配符
        const prefixPath = `/${segments.slice(0, i).join('/')}/*`
        candidates.add(prefixPath)
      }
    }
  }

  candidates.add('/')

  return Array.from(candidates)
}

/**
 * 判断一个键是否为路径模式（包含通配符或动态段）
 * @param key 要检查的键
 * @returns 是否为路径模式
 */
export function isPatternKey(key: string): boolean {
  if (!key.startsWith('/')) return false
  return key.includes('*') || key.includes('[') || key.includes(':')
}

/**
 * 将路径模式转换为正则表达式
 * @param pattern 路径模式
 * @returns 对应的正则表达式或null
 */
export function patternToRegex(pattern: string): RegExp | null {
  if (!isPatternKey(pattern)) {
    return null
  }

  if (wildcardRegexCache.has(pattern)) {
    return wildcardRegexCache.get(pattern) || null
  }

  const tokens: Array<{ placeholder: string; regex: string }> = []
  let transformed = pattern

  const replacers: Array<[RegExp, string]> = [
    [/\[\.{3}([^\]/]+)\]/g, '__NUXT_CATCHALL__'],
    [/\[\[\.{3}([^\]/]+)\]\]/g, '__NUXT_OPTIONAL_CATCHALL__'],
    [/\[([^\]/]+)\]/g, '__NUXT_SEGMENT__'],
    [/:([A-Za-z0-9_]+)/g, '__NUXT_DYNAMIC__']
  ]

  replacers.forEach(([regex, placeholder]) => {
    transformed = transformed.replace(regex, (_, name) => {
      let target = placeholder
      if (placeholder === '__NUXT_CATCHALL__') {
        target += '_CATCHALL'
      } else if (placeholder === '__NUXT_OPTIONAL_CATCHALL__') {
        target += '_OPTIONAL'
      }
      tokens.push({
        placeholder: target,
        regex:
          placeholder === '__NUXT_CATCHALL__'
            ? '(.+)'
            : placeholder === '__NUXT_OPTIONAL_CATCHALL__'
              ? '(?:.+)?'
              : '([^/]+)'
      })
      return target
    })
  })

  let escaped = escapeRegex(transformed)
  // 修复通配符替换逻辑：将转义后的*（即\*）替换为.*
  // 使用正确的正则表达式匹配转义后的星号
  escaped = escaped.replace(/\\\*/g, '.*')

  tokens.forEach(({ placeholder, regex }) => {
    escaped = escaped.replace(new RegExp(escapeRegex(placeholder), 'g'), regex)
  })

  const finalRegex = new RegExp(`^${escaped}$`)
  wildcardRegexCache.set(pattern, finalRegex)
  return finalRegex
}

/**
 * 根据当前路径解析对应的源文件列表
 * @param pathname 当前页面路径
 * @param sourceMap 源文件映射配置
 * @returns 匹配的源文件路径数组
 */
export function resolveSourceFiles(pathname: string, sourceMap: SourceMap): string[] {
  let res: any[] = []
  if (!sourceMap || typeof sourceMap !== 'object') {
    console.log('【未在nuxt.config.ts中查询到有效源文件映射配置】:', sourceMap)
    return res
  }

  const candidates = buildPathCandidates(pathname)

  console.log('【***】:', pathname, candidates)
  // 1. 尝试直接匹配路径
  for (const candidate of candidates) {
    const directMatch = sourceMap[candidate]
    if (Array.isArray(directMatch) && directMatch.length > 0) {
      // 打印查找到的本地文件列表
      console.log('【尝试直接匹配路径】:', '"'+candidate+'" : ', "["+directMatch.join(", ")+"]")
      res = res.concat(directMatch)
    }
  }

  // 2. 尝试模式匹配
  for (const key of Object.keys(sourceMap)) {
    // 跳过default配置，留到最后处理
    if (key === 'default') continue;
    
    const pattern = patternToRegex(key)
    
    if (pattern && candidates.some(candidate => pattern.test(candidate))) {
      const files = sourceMap[key]
      if (Array.isArray(files) && files.length > 0) {
        // 打印查找到的本地文件列表
        console.log('【尝试通配模式匹配】:', '"'+key+'" : ', "["+files.join(", ")+"]")
        res = res.concat(files)
      }
    }
  }

  // 3. 如果没有找到匹配项，检查是否有default配置
  const defaultFiles = sourceMap['default']
  if (Array.isArray(defaultFiles) && defaultFiles.length > 0) {
    // 打印查找到的本地文件列表
    console.log('【default配置】:', '"default" : ', "["+defaultFiles.join(", ")+"]")
    res = res.concat(defaultFiles)
  }

  // 数组元素删除前后空格后，再去重
  return [...new Set(res.map(item => item.trim()))]
}

/**
 * 检查元素是否可编辑
 * @param element 要检查的DOM元素
 * @param tagKey 可编辑标识（字符串或字符串数组）
 * @returns 元素是否可编辑
 */
function isEditableElement(element: HTMLElement, tagKey: string | string[]): boolean {
  // 排除位于抽屉弹窗内的元素
  if (element.closest('.visual-editor-drawer')) {
    return false
  }
  
  const tagKeys = Array.isArray(tagKey) ? tagKey : [tagKey]
  
  for (const key of tagKeys) {
    // 检查是否有指定属性
    if (element.hasAttribute(key)) {
      return true
    }
    
    // 检查标签名是否匹配（支持 h1, h2, p 等 HTML 标签）
    const tagName = element.tagName.toLowerCase()
    if (tagName === key.toLowerCase()) {
      return true
    }
  }
  
  return false
}

/**
 * 查找可编辑的父元素
 * @param element 起始DOM元素
 * @param tagKey 可编辑标识（字符串或字符串数组）
 * @returns 找到的可编辑元素或null
 */
function findEditableElement(element: HTMLElement, tagKey: string | string[]): HTMLElement | null {
  let current: HTMLElement | null = element
  
  while (current) {
    if (isEditableElement(current, tagKey)) {
      return current
    }
    current = current.parentElement
  }
  
  return null
}

/**
 * 初始化可视化编辑器
 */
export function initVisualEditor() {
  if (typeof window === 'undefined') return

  const config = window.__VISUAL_EDITOR_CONFIG__
  if (!config) {
    console.warn('[Visual Editor] Config not found')
    return
  }

  const tagKey = config.tagKey || 'easy-editor' // 支持字符串或字符串数组
  const sourceMap = config.sourceMap || {}

  // 创建编辑器容器


  // 监听鼠标事件 - 使用事件委托
  document.addEventListener('mouseover', (e) => {
    const currentState = getEditorState();
    if (currentState.isEditing) return

    const target = e.target as HTMLElement
    
    // 如果鼠标移到按钮容器或其子元素上，取消隐藏
    if (target.closest('.visual-editor-btn-container')) {
      clearHideButtonTimeout()
      return
    }

    // 查找可编辑元素（支持属性和标签名）
    const editableElement = findEditableElement(target, tagKey)
    if (editableElement) {
      clearHideButtonTimeout()
      showEditButton(editableElement)
    } else {
      // 延迟隐藏，给用户时间移到按钮上
      scheduleHideButton()
    }
  })

  document.addEventListener('mouseout', (e) => {
    const currentState = getEditorState();
    if (currentState.isEditing) return

    const target = e.target as HTMLElement
    const relatedTarget = e.relatedTarget as HTMLElement

    // 如果鼠标移到按钮容器上，不隐藏
    if (relatedTarget && relatedTarget.closest('.visual-editor-btn-container')) {
      return
    }

    // 如果鼠标移出可编辑元素，立即移除高亮并延迟隐藏按钮
    const editableElement = findEditableElement(target, tagKey)
    if (editableElement) {
      // 检查是否移到了按钮容器上或元素的其他部分
      if (!relatedTarget || !relatedTarget.closest('.visual-editor-btn-container') && !editableElement.contains(relatedTarget)) {
        // 立即移除高亮效果
        removeHighlight(editableElement)
        // 延迟隐藏按钮
        scheduleHideButton()
      }
    }
  })

  console.log('[Visual Editor] Initialized')
}



/**
 * 在可编辑元素旁显示编辑按钮
 * @param element 可编辑的DOM元素
 */
function showEditButton(element: HTMLElement) {
  clearHideButtonTimeout()
  hideEditButton()
  removeHighlight()

  // 添加高亮效果
  highlightElement(element)
  
  // 添加双击编辑事件
  const handleDoubleClick = (e: MouseEvent) => {
    e.stopPropagation()
    if (!editorState.isEditing) {
      clearHideButtonTimeout()
      startEdit(element)
    }
  }
  element.addEventListener('dblclick', handleDoubleClick)
  
  // 保存事件处理器引用，以便后续移除
  ;(element as any).__doubleClickHandler = handleDoubleClick

  const config = window.__VISUAL_EDITOR_CONFIG__
  const editCSS = config?.editCSS || false
  const rawTagKey = config?.tagKey
  const tagKeysArray = Array.isArray(rawTagKey)
    ? rawTagKey
    : rawTagKey
      ? [rawTagKey]
      : ['easy-editor']
  const normalizedTagKeys = tagKeysArray
    .filter((key): key is string => typeof key === 'string' && key.length > 0)
    .map((key) => key.toLowerCase())
  const elementTag = element.tagName.toLowerCase()
  const mediaTags = ['img', 'video', 'audio']
  const shouldHideContentButton = mediaTags.includes(elementTag) && normalizedTagKeys.includes(elementTag)

  const rect = element.getBoundingClientRect()
  
  // 创建按钮容器
  const buttonContainer = document.createElement('div')
  buttonContainer.className = 'visual-editor-btn-container'
  // 利用position: fixed特性，直接设置相对于视口的位置
  buttonContainer.style.top = `${rect.top}px`
  buttonContainer.style.left = `${rect.right - 5}px`

  if (!shouldHideContentButton) {
    // 内容编辑按钮
    const contentButton = document.createElement('button')
    contentButton.className = 'visual-editor-btn'
    contentButton.textContent = '编辑内容'

    contentButton.addEventListener('mouseenter', () => {
      clearHideButtonTimeout()
    })

    contentButton.addEventListener('click', (e) => {
      e.stopPropagation()
      clearHideButtonTimeout()
      startEdit(element)
    })

    buttonContainer.appendChild(contentButton)
  }

  // CSS 编辑按钮（仅在 editCSS 为 true 时显示）
  if (editCSS) {
    const cssButton = document.createElement('button')
    cssButton.className = 'visual-editor-btn visual-editor-btn--css'
    cssButton.textContent = '编辑CSS'

    cssButton.addEventListener('mouseenter', () => {
      clearHideButtonTimeout()
    })

    cssButton.addEventListener('click', (e) => {
      e.stopPropagation()
      clearHideButtonTimeout()
      startEditCSS(element)
    })

    buttonContainer.appendChild(cssButton)
  }

  // 鼠标进入容器时，取消隐藏
  buttonContainer.addEventListener('mouseenter', (e) => {
    clearHideButtonTimeout()
  })

  // 鼠标离开容器时，延迟隐藏
  buttonContainer.addEventListener('mouseleave', (e) => {
    const relatedTarget = e.relatedTarget as HTMLElement
    // 如果鼠标移到了容器内的其他元素（如按钮），不隐藏
    if (relatedTarget && buttonContainer.contains(relatedTarget)) {
      return
    }
    scheduleHideButton()
  })

  document.body.appendChild(buttonContainer)
  currentButton = buttonContainer
  setEditorState({ element });
}

/**
 * 清除编辑按钮的隐藏计时器
 */
function clearHideButtonTimeout() {
  if (hideButtonTimeout !== null) {
    clearTimeout(hideButtonTimeout)
    hideButtonTimeout = null
  }
}

/**
 * 安排编辑按钮的隐藏
 */
function scheduleHideButton() {
  clearHideButtonTimeout()
  hideButtonTimeout = window.setTimeout(() => {
    hideEditButton()
  }, 20) // 200ms 延迟，给用户时间移到按钮上
}





/**
 * 隐藏编辑按钮
 */
export function hideEditButton() {
  clearHideButtonTimeout()
  removeHighlight()
  
  // 移除按钮容器（现在统一使用容器）
  if (currentButton) {
    currentButton.remove()
    currentButton = null
  }

  // 也移除可能遗留的按钮容器（确保清理干净）
  const containers = document.querySelectorAll('.visual-editor-btn-container')
  containers.forEach(container => container.remove())

  const currentState = getEditorState();
  if (!currentState.isEditing) {
    setEditorState({ element: null });
  }
}

/**
 * 开始编辑元素内容
 * @param element 要编辑的DOM元素
 */
async function startEdit(element: HTMLElement) {
  hideEditButton()
  removeHighlight()

  const config = window.__VISUAL_EDITOR_CONFIG__
  if (!config) {
    showNotification('配置未找到', 'error')
    return
  }

  // 获取原始内容
  const rawHtmlContent = element.innerHTML
  const sanitizedHtmlContent = removeScopedAttributes(rawHtmlContent)

  // 生成rawHtmlContent的内容变体数组
  function generateContentVariants(content: string): string[] {
    const variants: string[] = []
    
    // 变体1: 默认原始不变
    variants.push(content)
    
    // 变体2: 替换前后空格或特殊字符
    variants.push(content.replace(/^[\s\u00a0]+|[\s\u00a0]+$/g, ''))
    
    // 变体3: 浏览器页面中换行，替换成<br>
    variants.push(content.replace(/\n/g, '<br>'))
    
    // 变体4: 浏览器页面中换行，替换成<br />
    variants.push(content.replace(/\n/g, '<br />'))
    
    // 变体5: 浏览器页面中换行，保持为\n（不做转换）
    variants.push(content.replace(/\n/g, '\\n'))
    
    // 数组去重
    return [...new Set(variants)]
  }

  // 生成内容变体
  const contentVariants = generateContentVariants(sanitizedHtmlContent)
  
  // 默认使用第一个变体（原始内容）
  let originalContent = contentVariants[0]

  ;(element as any).__domOriginalContent = rawHtmlContent

  // 获取当前页面路径
  const currentPath = window.location.pathname
  const sourceFiles = resolveSourceFiles(currentPath, config.sourceMap)
  
  // 打印查找到的本地文件列表
  console.log('【Easy Editor】查找到的本地文件列表:', sourceFiles)

  // 只有在完全找不到任何文件（包括default路径）时才显示错误通知
  if (sourceFiles.length === 0) {
    showNotification('未找到该页面对应的源文件配置，请在 nuxt.config.ts 中配置 sourceMap', 'warning')
    return
  }

  // 搜索内容 - 使用更全面的空白字符处理，包括移除U+00a0非断空格字符
  // 打印originalContent到控制台便于调试
  console.log('Original Content:', "["+originalContent+"]");
    
  // 遍历内容变体数组进行查找
  let matches: Match[] = []
  let aaa:string = ""
  for (let i = 0; i < contentVariants.length; i++) {
    const variant = contentVariants[i]
    // console.log(`【查找中】原始内容变体 ${i+1}/${contentVariants.length}, ${variant}`);
    const variantMatches = await searchContent(variant, sourceFiles)
    
    if (variantMatches.length > 0) {
      console.log(`【查找成功】原始内容变体 ${i+1}/${contentVariants.length}, ${variant} 找到匹配`);
      matches = variantMatches
      aaa = variant
      console.log('【matches】',matches);
      break  // 找到匹配后停止遍历
    } else {
      console.log(`【查找中】原始内容变体 ${i+1}/${contentVariants.length}, ${variant} 未查询到`);
    }
  }

  // 由于resolveSourceFiles函数已修改，default配置已自动包含在sourceFiles中，不再需要单独处理
  // 原有的default路径查找逻辑已被删除，因为default配置已自动包含在sourceFiles中

  setEditorState({
    originalContent,
    matches,
    isEditing: true
  });

  // 如果有多处匹配，先显示选择器
  if (matches.length > 1) {
    showMatchSelector(element, matches)
  } else {
    // 直接启用内联编辑
    enableInlineEdit(element, originalContent, matches)
  }
}

// 定义服务器日志接口
interface ServerLog {
  type: 'log' | 'warn' | 'error'
  message: string
  data?: any
}

/**
 * 在源代码中搜索特定内容（默认支持HTML搜索）
 * @param content 要搜索的内容
 * @param sourceFiles 源文件路径数组
 * @returns 匹配结果Promise数组
 */
async function searchContent(content: string, sourceFiles: string[]): Promise<Match[]> {
  try {
    const response = await fetch('/api/visual-editor/search-content', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: content.trim(),
        files: sourceFiles
      })
    })

    if (!response.ok) {
      // 使用中文错误消息
      throw new Error('搜索内容失败，请检查源文件配置')
    }

    const data = await response.json()
    
    // 打印服务器返回的日志到浏览器控制台
    if (data.serverLogs && Array.isArray(data.serverLogs)) {
      data.serverLogs.forEach((log: ServerLog) => {
        // 在浏览器控制台中使用不同颜色标识不同类型的日志
        const consoleColor = log.type === 'error' ? 'color: red' : log.type === 'warn' ? 'color: orange' : 'color: blue'
        console.groupCollapsed(`%c[Server ${log.type.toUpperCase()}] ${log.message}`, consoleColor)
        if (log.data !== undefined) {
          if (typeof log.data === 'string' || typeof log.data === 'number') {
            console.log(`%c${log.data}`, consoleColor)
          } else {
            console.log(log.data)
          }
        }
        console.groupEnd()
      })
    }
    
    // 如果有错误消息，显示通知
    if (data.errMsg) {
      console.error('[Visual Editor] 搜索错误:', data.errMsg)
      showNotification(data.errMsg, 'error')
    }
    
    return data.matches || []
  } catch (error) {
    console.error('[Visual Editor] Search error:', error)
    return []
  }
}

/**
 * HTML转义函数
 * @param html 要转义的HTML内容
 * @returns 转义后的字符串
 */
export function escapeHtml(html: string): string {
  const div = document.createElement('div')
  div.textContent = html
  return div.innerHTML
}

/**
 * HTML反转义函数
 * @param escaped 已转义的HTML内容
 * @returns 反转义后的HTML字符串
 */
export function unescapeHtml(escaped: string): string {
  const textarea = document.createElement('textarea')
  textarea.innerHTML = escaped
  return textarea.value
}

/**
 * 移除Vue scoped注入的data-v-*属性
 * @param html HTML内容
 * @returns 移除scoped属性后的HTML
 */
export function removeScopedAttributes(html: string): string {
  if (!html) return html
  return html
    .replace(/\sdata-v-[a-zA-Z0-9_-]+="[^"]*"/g, '')
    .replace(/\sdata-v-[a-zA-Z0-9_-]+='[^']*'/g, '')
    .replace(/\sdata-v-[a-zA-Z0-9_-]+(?![=a-zA-Z0-9_-])/g, '')
}

/**
 * 启用内联编辑功能
 * @param element 要编辑的DOM元素
 * @param originalContent 原始内容
 * @param matches 匹配结果数组
 */
function enableInlineEdit(element: HTMLElement, originalContent: string, matches: Match[]) {
  const config = window.__VISUAL_EDITOR_CONFIG__
  // 默认支持HTML搜索，不再需要searchHtml配置
  
  // 保存原始内容
  const savedContent = originalContent
  
  // 如果 searchHtml 为 true，需要将 HTML 标签转义显示（但保留已转义的实体）
  // 总是使用HTML模式
    // 只转义 HTML 标签（<tag>），不转义 HTML 实体（如 &amp;）
    // 使用正则匹配 HTML 标签并转义，保留实体不变
    const escapedContent = originalContent.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)(\s[^>]*)?>/g, '&lt;$1$2$3&gt;')
    element.innerHTML = escapedContent
  // 不再需要else分支，默认使用HTML模式
  
  // 设置元素为可编辑
  element.setAttribute('contenteditable', 'plaintext-only')
  element.classList.add('visual-editor-inline-editing')
  
  // 创建保存按钮
  const saveBtn = createSaveButton(element, matches)
  const rect = element.getBoundingClientRect()
  saveBtn.style.top = `${rect.bottom + 10}px`
  saveBtn.style.left = `${rect.left}px`
  document.body.appendChild(saveBtn)
  
  // 保存按钮引用
  ;(element as any).__saveButton = saveBtn
  ;(element as any).__originalContent = savedContent
  ;(element as any).__matches = matches
  // 不再需要存储searchHtml标志
  
  // 聚焦到元素
  element.focus()
  
  // 选中所有文本
  const range = document.createRange()
  range.selectNodeContents(element)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  
  // 监听键盘事件
  const handleKeyDown = (e: KeyboardEvent) => {
    // Ctrl+S 或 Cmd+S 保存
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      handleSave(element)
    }
    // ESC 取消
    if (e.key === 'Escape') {
      cancelEdit(element)
    }
  }
  
  // 监听键盘事件
  element.addEventListener('keydown', handleKeyDown)
  ;(element as any).__keydownHandler = handleKeyDown
  
  // 监听失焦事件，实现与ESC键相同的取消编辑功能
  const handleBlur = () => {
    cancelEdit(element)
  }
  element.addEventListener('blur', handleBlur)
  ;(element as any).__blurHandler = handleBlur
}

/**
 * 创建保存按钮
 * @param element 编辑的DOM元素
 * @param matches 匹配结果数组
 * @returns 创建的保存按钮容器元素
 */
function createSaveButton(element: HTMLElement, matches: Match[]): HTMLElement {
  const btn = document.createElement('div')
  btn.className = 'visual-editor-save-btn'
  btn.innerHTML = `
    <button class="visual-editor-save-btn__save">💾 保存 (Ctrl+S)</button>
    <button class="visual-editor-save-btn__cancel">✕ 取消 (ESC)</button>
  `
  
  const saveBtn = btn.querySelector('.visual-editor-save-btn__save') as HTMLElement
  const cancelBtn = btn.querySelector('.visual-editor-save-btn__cancel') as HTMLElement
  
  // 使用mousedown事件代替click事件，确保在blur触发前执行保存操作
  saveBtn.onmousedown = () => handleSave(element)
  cancelBtn.onmousedown = () => cancelEdit(element)
  
  return btn
}

/**
 * 处理内容保存
 * @param element 编辑的DOM元素
 */
async function handleSave(element: HTMLElement) {
  const matches = (element as any).__matches as Match[]
  // 不再需要searchHtml变量
  const originalContent = (element as any).__originalContent as string
  
  // 获取编辑后的内容
  let newContent: string
    // 如果 searchHtml 为 true，获取 innerHTML
    // 用户编辑的是转义后的文本（如 &lt;br&gt;），需要还原为 HTML（<br>）
    const escapedContent = element.innerHTML
    
    // 将转义的 HTML 标签还原（如 &lt;br&gt; 还原为 <br>）
    newContent = escapedContent.replace(/&lt;(\/?)([a-zA-Z][a-zA-Z0-9]*)(\s[^&]*?)?&gt;/g, '<$1$2$3>')
    
    // 将 &amp; 还原为 &（因为文件中的 & 不需要转义）
    newContent = newContent.replace(/&amp;/g, '&')
    
    // 将 &nbsp; 转换为普通空格，确保空格不被转义
    newContent = newContent.replace(/&nbsp;/g, ' ')
    
    // 将实际的换行符（\n）转换为 <br> 标签
    newContent = newContent.replace(/\n/g, '<br>')
    // 处理 contenteditable 产生的 <div> 标签（按 Enter 时）
    newContent = newContent.replace(/<div>/g, '<br>').replace(/<\/div>/g, '')
    // 处理多个连续的 <br>，合并为一个
    newContent = newContent.replace(/(<br\s*\/?>)+/gi, '<br>')
  // 总是使用HTML模式
  
  if (newContent.trim() === originalContent.trim()) {
    cancelEdit(element)
    return
  }
  
  if (matches.length === 0) {
    showNotification('未找到对应的源文件，无法保存', 'error')
    return
  }
  
  // 调用saveContent保存内容，传递正确的参数顺序
  await saveContent(element, newContent)
}

/**
 * 取消编辑，恢复原始内容
 * @param element 编辑的DOM元素
 */
function cancelEdit(element: HTMLElement) {
  const originalContent = (element as any).__originalContent as string
  // 不再需要searchHtml变量
  const domOriginalContent = (element as any).__domOriginalContent as string | undefined
  
  // 恢复原始内容，总是使用HTML模式
  if (typeof domOriginalContent === 'string') {
    element.innerHTML = domOriginalContent
  } else {
    element.innerHTML = originalContent
  }
  
  element.removeAttribute('contenteditable')
  element.classList.remove('visual-editor-inline-editing')
  
  const saveBtn = (element as any).__saveButton
  if (saveBtn) {
    saveBtn.remove()
  }
  
  // 移除键盘事件监听器
  const keydownHandler = (element as any).__keydownHandler
  if (keydownHandler) {
    element.removeEventListener('keydown', keydownHandler)
  }
  
  // 移除失焦事件监听器
  const blurHandler = (element as any).__blurHandler
  if (blurHandler) {
    element.removeEventListener('blur', blurHandler)
  }
  
  delete (element as any).__saveButton
  delete (element as any).__originalContent
  delete (element as any).__matches
  delete (element as any).__keydownHandler
  delete (element as any).__blurHandler
  delete (element as any).__selectedMatchIndex
  // 不再需要删除__searchHtml属性
  delete (element as any).__domOriginalContent
  
  setEditorState({ isEditing: false });
  removeHighlight()
}

/**
 * 高亮显示搜索内容
 * @param text 原始文本
 * @param searchText 要高亮的搜索文本
 * @returns 带高亮标记的HTML字符串
 */
function highlightContent(text: string, searchText: string): string {
  if (!searchText || !text) return text || ''
  
  // 转义 HTML 特殊字符，避免 XSS
  const escapeHtml = (str: string) => {
    const div = document.createElement('div')
    div.textContent = str
    return div.innerHTML
  }
  
  // 转义文本中的 HTML
  const escapedText = escapeHtml(text)
  
  // 转义搜索文本中的正则特殊字符
  const escapedSearch = escapeRegex(searchText)
  
  // 创建高亮正则（不区分大小写，全局匹配）
  const regex = new RegExp(`(${escapedSearch})`, 'gi')
  
  // 高亮匹配的内容
  return escapedText.replace(regex, '<mark class="visual-editor-highlight-text">$1</mark>')
}

/**
 * 转义正则表达式特殊字符
 * @param str 要转义的字符串
 * @returns 转义后的字符串
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 构建通配符正则表达式
 * @param pattern 通配符模式
 * @returns 正则表达式
 */
export function buildWildcardRegex(pattern: string): RegExp {
  const wildcardRegexCache = new Map<string, RegExp>()
  
  if (wildcardRegexCache.has(pattern)) {
    return wildcardRegexCache.get(pattern)! as RegExp
  }

  let regexString = '^'

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]

    if (char === '*') {
      if (i + 1 < pattern.length && pattern[i + 1] === '*') {
        // 匹配任意数量的字符和路径分隔符
        regexString += '.*'
        i++
      } else {
        // 匹配除路径分隔符外的任意字符
        regexString += '[^/]*'
      }
    } else if (char === '?') {
      // 匹配单个字符
      regexString += '.?'
    } else if (/[\\.\\+\\[\\]\\(\\)\\{\\}\\^\\$\\|]/.test(char)) {
      // 转义正则表达式特殊字符
      regexString += '\\' + char
    } else {
      regexString += char
    }
  }

  regexString += '$'

  const regex = new RegExp(regexString)
  wildcardRegexCache.set(pattern, regex)
  return regex
}

/**
 * 显示匹配选择器（右侧抽屉式）
 * @param element 当前编辑的元素
 * @param matches 匹配结果数组
 */
function showMatchSelector(element: HTMLElement, matches: Match[]) {
  // 创建遮罩层
  const overlay = document.createElement('div')
  overlay.id = 'visual-editor-drawer-overlay'
  overlay.className = 'visual-editor-overlay'
  
  // 创建抽屉容器
  const drawer = document.createElement('div')
  drawer.id = 'visual-editor-match-drawer'
  drawer.className = 'visual-editor-drawer'
  
  // 创建头部
  const header = document.createElement('div')
  header.className = 'visual-editor-drawer__header'
  
  const title = document.createElement('h3')
  title.textContent = '找到多处匹配'
  title.className = 'visual-editor-drawer__title'
  
  const closeBtn = document.createElement('button')
  closeBtn.innerHTML = '×'
  closeBtn.className = 'visual-editor-drawer__close'
  closeBtn.onclick = () => {
    overlay.remove()
    drawer.remove()
    editorState.isEditing = false
  }
  
  header.appendChild(title)
  header.appendChild(closeBtn)
  drawer.appendChild(header)
  
  // 创建列表容器
  const listContainer = document.createElement('div')
  listContainer.className = 'visual-editor-drawer__content'
  
  // 创建列表
  const matchList = document.createElement('div')
  matchList.className = 'visual-editor-match-list'
  
  matches.forEach((match, index) => {
    const matchItem = document.createElement('div')
    matchItem.className = 'visual-editor-match-item'
    
    // 文件路径和文件名
    const fileInfo = document.createElement('div')
    fileInfo.className = 'visual-editor-match-item__meta'
    
    const filePath = document.createElement('div')
    filePath.textContent = match.file
    filePath.className = 'visual-editor-match-item__file'
    
    const lineInfo = document.createElement('div')
    lineInfo.textContent = `第 ${match.line} 行`
    lineInfo.className = 'visual-editor-match-item__line'
    
    fileInfo.appendChild(filePath)
    fileInfo.appendChild(lineInfo)
    matchItem.appendChild(fileInfo)
    
    // 内容片段（高亮显示，包含更多上下文）
    const contentPreview = document.createElement('div')
    const searchText = editorState.originalContent.trim()
    
    // 使用 context 显示更多上下文，如果 context 不存在则使用 originalContent
    const displayContent = match.context || match.originalContent || ''
    
    // 添加行号显示（如果 context 包含多行）
    const lines = displayContent.split('\n')
    let contentHtml = ''
    
    if (lines.length > 1) {
      // 计算起始行号
      // context 包含前后各5行，匹配行在 match.line
      // 我们需要找到匹配行在 context 中的位置
      // 由于 context 可能因为文件开头/结尾而少于11行，我们需要计算实际起始行号
      
      // 尝试在 context 中找到包含匹配内容的行
      let matchLineIndex = -1
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(match.originalContent.trim()) || 
            lines[i].replace(/&amp;/g, '&').includes(match.originalContent.trim().replace(/&amp;/g, '&'))) {
          matchLineIndex = i
          break
        }
      }
      
      // 如果找不到，假设匹配行在中间
      if (matchLineIndex === -1) {
        matchLineIndex = Math.floor(lines.length / 2)
      }
      
      // 计算起始行号
      const startLineNum = match.line - matchLineIndex
      
      // 为每行添加行号显示并高亮
      const lineNumberedContent = lines.map((line, idx) => {
        const lineNum = Math.max(1, startLineNum + idx)
        const highlightedLine = highlightContent(line, searchText)
        const isMatchLine = lineNum === match.line
        const wrapperClass = ['visual-editor-line-number']
        if (isMatchLine) wrapperClass.push('visual-editor-line-number--match')
        const indexClass = ['visual-editor-line-number__index']
        if (isMatchLine) indexClass.push('visual-editor-line-number__index--match')
        const contentClass = ['visual-editor-line-number__content']
        if (isMatchLine) contentClass.push('visual-editor-line-number__content--match')
        return `<div class="${wrapperClass.join(' ')}">
          <span class="${indexClass.join(' ')}">${lineNum}</span>
          <span class="${contentClass.join(' ')}">${highlightedLine || '&nbsp;'}</span>
        </div>`
      }).join('')
      contentHtml = lineNumberedContent
    } else {
      // 单行内容，直接高亮
      contentHtml = highlightContent(displayContent, searchText)
    }
    
    contentPreview.innerHTML = contentHtml
    contentPreview.className = 'visual-editor-match-item__preview'
    matchItem.appendChild(contentPreview)
    
    // 【修改此处】按钮（右侧悬浮）
    const editBtn = document.createElement('button')
    editBtn.textContent = '修改此处'
    editBtn.className = 'visual-editor-match-item__action'
    editBtn.onclick = (e) => {
      e.stopPropagation()
      ;(element as any).__selectedMatchIndex = index
      overlay.remove()
      drawer.remove()
      enableInlineEdit(element, editorState.originalContent, matches)
    }
    
    matchItem.appendChild(editBtn)
    matchList.appendChild(matchItem)
  })
  
  listContainer.appendChild(matchList)
  drawer.appendChild(listContainer)
  
  // 点击遮罩层关闭
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      overlay.remove()
      drawer.remove()
      editorState.isEditing = false
    }
  }
  
  document.body.appendChild(overlay)
  document.body.appendChild(drawer)
}

/**
 * 显示通知消息
 * @param message 通知内容
 * @param type 通知类型（success、error或warning，默认success）
 */
export function showNotification(message: string, type: 'success' | 'error' | 'warning' = 'success') {
  const notification = document.createElement('div')
  notification.className = `visual-editor-notification visual-editor-notification--${type}`
  notification.textContent = message
  document.body.appendChild(notification)
  
  setTimeout(() => {
    notification.classList.add('is-leaving')
    setTimeout(() => notification.remove(), 300)
  }, 3000)
}

/**
 * 创建原生编辑器模态框
 */
function createNativeEditorModal() {
  // 移除已存在的模态框
  const existingModal = document.getElementById('visual-editor-modal')
  if (existingModal) {
    existingModal.remove()
  }

  // 创建遮罩层
  const overlay = document.createElement('div')
  overlay.id = 'visual-editor-modal'
  overlay.className = 'visual-editor-modal-overlay'

  // 创建模态框
  const modal = document.createElement('div')
  modal.className = 'visual-editor-modal'

  // 创建头部
  const header = document.createElement('div')
  header.className = 'visual-editor-modal__header'
  const title = document.createElement('h3')
  title.textContent = '编辑内容'
  title.className = 'visual-editor-modal__title'
  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.textContent = '×'
  closeBtn.className = 'visual-editor-modal__close'
  closeBtn.onclick = () => {
    overlay.remove()
    editorState.isEditing = false
  }
  header.appendChild(title)
  header.appendChild(closeBtn)

  // 创建内容区
  const body = document.createElement('div')
  body.className = 'visual-editor-modal__body'

  // 如果有多处匹配，显示选择器
  let selectedMatchIndex = 0
  if (editorState.matches.length > 1) {
    const selector = document.createElement('div')
    selector.className = 'visual-editor-match-selector'
    const info = document.createElement('p')
    info.textContent = `找到 ${editorState.matches.length} 处匹配，请选择要修改的位置：`
    info.className = 'visual-editor-match-selector__info'
    selector.appendChild(info)

    const matchList = document.createElement('div')
    matchList.className = 'visual-editor-match-selector__list'

    editorState.matches.forEach((match, index) => {
      const matchItem = document.createElement('div')
      matchItem.className = 'visual-editor-match-selector__item'
      if (selectedMatchIndex === index) {
        matchItem.classList.add('visual-editor-match-selector__item--active')
      }
      matchItem.onclick = () => {
        selectedMatchIndex = index
        Array.from(matchList.children).forEach((child, childIndex) => {
          const element = child as HTMLElement
          element.classList.toggle('visual-editor-match-selector__item--active', childIndex === index)
        })
      }

      const matchInfo = document.createElement('div')
      matchInfo.className = 'visual-editor-match-selector__header'
      const fileName = document.createElement('strong')
      fileName.textContent = match.file
      fileName.className = 'visual-editor-match-selector__file'
      const location = document.createElement('span')
      location.textContent = `第 ${match.line} 行`
      location.className = 'visual-editor-match-selector__line'
      matchInfo.appendChild(fileName)
      matchInfo.appendChild(location)

      const preview = document.createElement('div')
      preview.textContent = match.context.substring(0, 100) + (match.context.length > 100 ? '...' : '')
      preview.className = 'visual-editor-match-selector__preview'

      matchItem.appendChild(matchInfo)
      matchItem.appendChild(preview)
      matchList.appendChild(matchItem)
    })

    selector.appendChild(matchList)
    body.appendChild(selector)
  }

  // 创建编辑器
  const editorWrapper = document.createElement('div')
  editorWrapper.className = 'visual-editor-modal__editor'
  const label = document.createElement('label')
  label.textContent = '内容：'
  label.className = 'visual-editor-modal__label'
  const textarea = document.createElement('textarea')
  textarea.value = editorState.originalContent
  textarea.className = 'visual-editor-modal__textarea'
  textarea.rows = 6
  editorWrapper.appendChild(label)
  editorWrapper.appendChild(textarea)
  body.appendChild(editorWrapper)

  // 创建底部
  const footer = document.createElement('div')
  footer.className = 'visual-editor-modal__footer'

  const cancelBtn = document.createElement('button')
  cancelBtn.type = 'button'
  cancelBtn.textContent = '取消'
  cancelBtn.className = 'visual-editor-modal__button visual-editor-modal__button--cancel'
  cancelBtn.onclick = () => {
    overlay.remove()
    editorState.isEditing = false
  }

  let saving = false
  const saveBtn = document.createElement('button')
  saveBtn.type = 'button'
  saveBtn.textContent = '保存'
  saveBtn.className = 'visual-editor-modal__button visual-editor-modal__button--save'
  saveBtn.onclick = async () => {
    if (saving) return
    saving = true
    saveBtn.textContent = '保存中...'
    saveBtn.disabled = true
    saveBtn.classList.add('is-loading')

    try {
      await saveContent(textarea.value, selectedMatchIndex)
      overlay.remove()
      editorState.isEditing = false
    } catch (error) {
      saving = false
      saveBtn.textContent = '保存'
      saveBtn.disabled = false
      saveBtn.classList.remove('is-loading')
    }
  }

  footer.appendChild(cancelBtn)
  footer.appendChild(saveBtn)

  modal.appendChild(header)
  modal.appendChild(body)
  modal.appendChild(footer)
  overlay.appendChild(modal)
  document.body.appendChild(overlay)

  // 点击遮罩层关闭
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      overlay.remove()
      editorState.isEditing = false
    }
  }

  // 聚焦到文本域
  setTimeout(() => textarea.focus(), 100)
}



// ========== 导出公共函数 ==========

// 导入content编辑相关函数
import { startEditContent } from './visual-editor-content'

// 导入CSS编辑相关函数
import { startEditCSS } from './visual-editor-css'

// 导出函数
export {
  startEditContent,
  highlightElement,
  removeHighlight,
  saveContent,
  startEditCSS
}

