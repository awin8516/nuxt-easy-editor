interface Match {
  file: string
  line: number
  context: string
  originalContent: string
}

interface CssMatch {
  file: string
  selector: string
  rules: string
  line: number
  context: string
  isScoped?: boolean
}

interface EditorState {
  element: HTMLElement | null
  originalContent: string
  matches: Match[]
  isEditing: boolean
}

let editorState: EditorState = {
  element: null,
  originalContent: '',
  matches: [],
  isEditing: false
}

let editorComponent: any = null
let hideButtonTimeout: number | null = null
let currentButton: HTMLElement | null = null
let highlightedElement: HTMLElement | null = null

type SourceMap = Record<string, string[]>

const wildcardRegexCache = new Map<string, RegExp>()

interface VisualEditorRuntimeConfig {
  tagKey: string | string[]
  sourceMap: SourceMap
  searchHtml?: boolean
  editCSS?: boolean
}

declare const window: Window & typeof globalThis & {
  __VISUAL_EDITOR_CONFIG__?: VisualEditorRuntimeConfig
}

function normalizePathname(pathname: string): string {
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

function buildPathCandidates(pathname: string): string[] {
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
  }

  candidates.add('/')

  return Array.from(candidates)
}

function isPatternKey(key: string): boolean {
  if (!key.startsWith('/')) return false
  return key.includes('*') || key.includes('[') || key.includes(':')
}

function patternToRegex(pattern: string): RegExp | null {
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
  escaped = escaped.replace(/\\\*/g, '.*')

  tokens.forEach(({ placeholder, regex }) => {
    escaped = escaped.replace(new RegExp(escapeRegex(placeholder), 'g'), regex)
  })

  const finalRegex = new RegExp(`^${escaped}$`)
  wildcardRegexCache.set(pattern, finalRegex)
  return finalRegex
}

function resolveSourceFiles(pathname: string, sourceMap: SourceMap): string[] {
  if (!sourceMap || typeof sourceMap !== 'object') {
    return []
  }

  const candidates = buildPathCandidates(pathname)

  for (const candidate of candidates) {
    const directMatch = sourceMap[candidate]
    if (Array.isArray(directMatch) && directMatch.length > 0) {
      return directMatch
    }
  }

  for (const key of Object.keys(sourceMap)) {
    const pattern = patternToRegex(key)
    if (pattern && candidates.some(candidate => pattern.test(candidate))) {
      const files = sourceMap[key]
      if (Array.isArray(files) && files.length > 0) {
        return files
      }
    }
  }

  return []
}

// 检查元素是否可编辑（支持单个标识或数组）
function isEditableElement(element: HTMLElement, tagKey: string | string[]): boolean {
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

// 查找可编辑的父元素（支持单个标识或数组）
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
    if (editorState.isEditing) return

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
    if (editorState.isEditing) return

    const target = e.target as HTMLElement
    const relatedTarget = e.relatedTarget as HTMLElement

    // 如果鼠标移到按钮容器上，不隐藏
    if (relatedTarget && relatedTarget.closest('.visual-editor-btn-container')) {
      return
    }

    // 如果鼠标移出可编辑元素，延迟隐藏
    const editableElement = findEditableElement(target, tagKey)
    if (editableElement) {
      // 检查是否移到了按钮容器上
      if (!relatedTarget || !relatedTarget.closest('.visual-editor-btn-container')) {
        scheduleHideButton()
      }
    }
  })

  console.log('[Visual Editor] Initialized')
}



function showEditButton(element: HTMLElement) {
  clearHideButtonTimeout()
  hideEditButton()
  removeHighlight()

  // 添加高亮效果
  highlightElement(element)

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
  buttonContainer.style.top = `${rect.top + window.scrollY}px`
  buttonContainer.style.left = `${rect.right + window.scrollX - 5}px`

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
  editorState.element = element
}

function clearHideButtonTimeout() {
  if (hideButtonTimeout !== null) {
    clearTimeout(hideButtonTimeout)
    hideButtonTimeout = null
  }
}

function scheduleHideButton() {
  clearHideButtonTimeout()
  hideButtonTimeout = window.setTimeout(() => {
    hideEditButton()
  }, 200) // 200ms 延迟，给用户时间移到按钮上
}

// 添加高亮效果
function highlightElement(element: HTMLElement) {
  removeHighlight()
  element.classList.add('visual-editor-highlight')
  highlightedElement = element
}

// 移除高亮效果
function removeHighlight() {
  if (highlightedElement) {
    highlightedElement.classList.remove('visual-editor-highlight')
    highlightedElement = null
  }
}

function hideEditButton() {
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

  if (!editorState.isEditing) {
    editorState.element = null
  }
}

async function startEdit(element: HTMLElement) {
  hideEditButton()
  removeHighlight()

  const config = window.__VISUAL_EDITOR_CONFIG__
  if (!config) {
    showNotification('配置未找到', 'error')
    return
  }

  const searchHtml = config.searchHtml || false
  
  // 获取原始内容
  const textContent = element.textContent || element.innerText || ''
  const rawHtmlContent = element.innerHTML
  const sanitizedHtmlContent = removeScopedAttributes(rawHtmlContent)

  // 如果 searchHtml 为 false，检查是否包含 HTML 标签
  // 更准确的HTML标签检测：不仅比较字符串，还要检查是否真正包含HTML标签
  if (!searchHtml) {
    // 尝试更精确地检测HTML标签
    const hasActualHtmlTags = /<[^>]+>/g.test(sanitizedHtmlContent)
    
    // 只在确实包含HTML标签时才提示警告
    // 避免因为特殊字符（如U+00a0非断行空格）导致的误判
    if (hasActualHtmlTags) {
      showNotification('内容包含 HTML 标签，请设置 searchHtml: true 来搜索', 'warning')
      return
    }
  }

  // 根据 searchHtml 配置获取内容
  let originalContent: string
  if (searchHtml) {
    // 使用移除 scoped 属性后的 HTML，并将换行符转换为 <br> 标签
    originalContent = sanitizedHtmlContent.replace(/\n/g, '<br>')
  } else {
    originalContent = textContent
  }

  ;(element as any).__domOriginalContent = rawHtmlContent

  // 获取当前页面路径
  const currentPath = window.location.pathname
  const sourceFiles = resolveSourceFiles(currentPath, config.sourceMap)

  if (sourceFiles.length === 0) {
    showNotification('未找到该页面对应的源文件配置，请在 nuxt.config.ts 中配置 sourceMap', 'warning')
    return
  }

  // 搜索内容 - 使用更全面的空白字符处理，包括移除U+00a0非断空格字符
  // 打印originalContent到控制台便于调试
  console.log('Original Content:', "["+originalContent+"]");
  
  // 更全面的空白字符处理：
  // 1. 首先移除HTML实体形式的非断空格
  // 2. 然后移除各种空白字符（包括普通空格和U+00a0非断空格）
  const processedContent = originalContent
    .replace(/&nbsp;/g, '')  // 移除HTML实体形式的非断空格
    .replace(/[\s\u00a0]+$/g, '')  // 移除结尾的所有空白字符
    .replace(/^[\s\u00a0]+/g, '');  // 移除开头的所有空白字符
  
  console.log('Processed Content:', "["+processedContent+"]");
  const matches = await searchContent(processedContent, sourceFiles, searchHtml)

  if (matches.length === 0) {
    showNotification('未在源文件中找到该内容，无法保存到本地文件', 'warning')
    // 即使找不到文件，也允许编辑（只是不能保存）
    enableInlineEdit(element, originalContent, [])
    return
  }

  editorState.originalContent = originalContent
  editorState.matches = matches
  editorState.isEditing = true

  // 如果有多处匹配，先显示选择器
  if (matches.length > 1) {
    showMatchSelector(element, matches)
  } else {
    // 直接启用内联编辑
    enableInlineEdit(element, originalContent, matches)
  }
}

async function searchContent(content: string, sourceFiles: string[], searchHtml: boolean = false): Promise<Match[]> {
  try {
    const response = await fetch('/api/visual-editor/search-content', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: content.trim(),
        files: sourceFiles,
        searchHtml: searchHtml
      })
    })

    if (!response.ok) {
      throw new Error('搜索失败')
    }

    const data = await response.json()
    return data.matches || []
  } catch (error) {
    console.error('[Visual Editor] Search error:', error)
    return []
  }
}

// HTML 转义函数
function escapeHtml(html: string): string {
  const div = document.createElement('div')
  div.textContent = html
  return div.innerHTML
}

// HTML 反转义函数（将转义的文本还原为 HTML，如 &lt;br&gt; 转为 <br>）
function unescapeHtml(escaped: string): string {
  const textarea = document.createElement('textarea')
  textarea.innerHTML = escaped
  return textarea.value
}

// 移除 Vue scoped 注入的 data-v-* 属性，仅用于文件搜索与保存
function removeScopedAttributes(html: string): string {
  if (!html) return html
  return html
    .replace(/\sdata-v-[a-zA-Z0-9_-]+="[^"]*"/g, '')
    .replace(/\sdata-v-[a-zA-Z0-9_-]+='[^']*'/g, '')
    .replace(/\sdata-v-[a-zA-Z0-9_-]+(?![=a-zA-Z0-9_-])/g, '')
}

// 启用内联编辑
function enableInlineEdit(element: HTMLElement, originalContent: string, matches: Match[]) {
  const config = window.__VISUAL_EDITOR_CONFIG__
  const searchHtml = config?.searchHtml || false
  
  // 保存原始内容
  const savedContent = originalContent
  
  // 如果 searchHtml 为 true，需要将 HTML 标签转义显示（但保留已转义的实体）
  if (searchHtml) {
    // 只转义 HTML 标签（<tag>），不转义 HTML 实体（如 &amp;）
    // 使用正则匹配 HTML 标签并转义，保留实体不变
    const escapedContent = originalContent.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)(\s[^>]*)?>/g, '&lt;$1$2$3&gt;')
    element.innerHTML = escapedContent
  } else {
    // searchHtml 为 false 时，直接使用文本内容
    element.textContent = originalContent
  }
  
  // 设置元素为可编辑
  element.setAttribute('contenteditable', 'plaintext-only')
  element.classList.add('visual-editor-inline-editing')
  
  // 创建保存按钮
  const saveBtn = createSaveButton(element, matches)
  const rect = element.getBoundingClientRect()
  saveBtn.style.top = `${rect.bottom + window.scrollY + 10}px`
  saveBtn.style.left = `${rect.left + window.scrollX}px`
  document.body.appendChild(saveBtn)
  
  // 保存按钮引用
  ;(element as any).__saveButton = saveBtn
  ;(element as any).__originalContent = savedContent
  ;(element as any).__matches = matches
  ;(element as any).__searchHtml = searchHtml
  
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
  
  element.addEventListener('keydown', handleKeyDown)
  ;(element as any).__keydownHandler = handleKeyDown
}

// 创建保存按钮
function createSaveButton(element: HTMLElement, matches: Match[]): HTMLElement {
  const btn = document.createElement('div')
  btn.className = 'visual-editor-save-btn'
  btn.innerHTML = `
    <button class="visual-editor-save-btn__save">💾 保存 (Ctrl+S)</button>
    <button class="visual-editor-save-btn__cancel">✕ 取消 (ESC)</button>
  `
  
  const saveBtn = btn.querySelector('.visual-editor-save-btn__save') as HTMLElement
  const cancelBtn = btn.querySelector('.visual-editor-save-btn__cancel') as HTMLElement
  
  saveBtn.onclick = () => handleSave(element)
  cancelBtn.onclick = () => cancelEdit(element)
  
  return btn
}

// 处理保存
async function handleSave(element: HTMLElement) {
  const matches = (element as any).__matches as Match[]
  const searchHtml = (element as any).__searchHtml as boolean
  const originalContent = (element as any).__originalContent as string
  
  // 获取编辑后的内容
  let newContent: string
  if (searchHtml) {
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
  } else {
    newContent = element.textContent || element.innerText || ''
  }
  
  if (newContent.trim() === originalContent.trim()) {
    cancelEdit(element)
    return
  }
  
  if (matches.length === 0) {
    showNotification('未找到对应的源文件，无法保存', 'error')
    return
  }
  
  // 如果有多处匹配，使用第一个（或之前选择的）
  const matchIndex = (element as any).__selectedMatchIndex || 0
  await saveContent(newContent, matchIndex, searchHtml)
}

// 取消编辑
function cancelEdit(element: HTMLElement) {
  const originalContent = (element as any).__originalContent as string
  const searchHtml = (element as any).__searchHtml as boolean
  const domOriginalContent = (element as any).__domOriginalContent as string | undefined
  
  // 恢复原始内容
  if (searchHtml) {
    if (typeof domOriginalContent === 'string') {
      element.innerHTML = domOriginalContent
    } else {
      element.innerHTML = originalContent
    }
  } else {
    element.textContent = originalContent
  }
  
  element.removeAttribute('contenteditable')
  element.classList.remove('visual-editor-inline-editing')
  
  const saveBtn = (element as any).__saveButton
  if (saveBtn) {
    saveBtn.remove()
  }
  
  const keydownHandler = (element as any).__keydownHandler
  if (keydownHandler) {
    element.removeEventListener('keydown', keydownHandler)
  }
  
  delete (element as any).__saveButton
  delete (element as any).__originalContent
  delete (element as any).__matches
  delete (element as any).__keydownHandler
  delete (element as any).__selectedMatchIndex
  delete (element as any).__searchHtml
  delete (element as any).__domOriginalContent
  
  editorState.isEditing = false
  removeHighlight()
}

// 高亮显示搜索内容
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

// 转义正则表达式特殊字符
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 显示匹配选择器（右侧抽屉式）
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

// 显示通知
function showNotification(message: string, type: 'success' | 'error' | 'warning' = 'success') {
  const notification = document.createElement('div')
  notification.className = `visual-editor-notification visual-editor-notification--${type}`
  notification.textContent = message
  document.body.appendChild(notification)
  
  setTimeout(() => {
    notification.classList.add('is-leaving')
    setTimeout(() => notification.remove(), 300)
  }, 3000)
}

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

async function saveContent(newContent: string, matchIndex: number, searchHtml: boolean = false) {
  const match = editorState.matches[matchIndex]
  if (!match) return

  try {
    const response = await fetch('/api/visual-editor/update-file', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        file: match.file,
        line: match.line,
        originalContent: match.originalContent,
        newContent: newContent,
        searchHtml: searchHtml
      })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || '保存失败')
    }

    // 取消编辑状态
    if (editorState.element) {
      cancelEdit(editorState.element)
    }

    showNotification('保存成功！页面将自动刷新。', 'success')
    setTimeout(() => {
      window.location.reload()
    }, 1000)
  } catch (error: any) {
    console.error('[Visual Editor] Save error:', error)
    alert('保存失败：' + error.message)
  }
}

// ========== CSS 编辑功能 ==========

// 搜索 CSS 文件
async function searchCSS(element: HTMLElement, cssFiles: string[]): Promise<CssMatch[]> {
  try {
    // 获取元素的完整选择器信息（包含元素和父元素信息）
    const elementSelector = getElementSelector(element)
    
    const response = await fetch('/api/visual-editor/search-css', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        elementSelector: elementSelector, // 传递对象而不是字符串
        cssFiles: cssFiles
      })
    })

    if (!response.ok) {
      throw new Error('搜索 CSS 失败')
    }

    const data = await response.json()
    return data.matches || []
  } catch (error) {
    console.error('[Visual Editor] CSS search error:', error)
    return []
  }
}

// 获取元素的完整选择器信息（用于 CSS 匹配）
function getElementSelector(element: HTMLElement): {
  elementInfo: {
    tag: string
    classes: string[]
    id: string | null
  }
  parentInfo: Array<{
    tag: string
    classes: string[]
    id: string | null
  }>
  selectorPath: string
} {
  const elementInfo = {
    tag: element.tagName.toLowerCase(),
    classes: getElementClasses(element),
    id: element.id || null
  }

  const parentInfo: Array<{ tag: string; classes: string[]; id: string | null }> = []
  let current: HTMLElement | null = element.parentElement

  // 收集父元素信息（最多向上查找 5 层）
  let depth = 0
  while (current && current !== document.body && depth < 5) {
    const classes = getElementClasses(current)
    if (current.id || classes.length > 0) {
      parentInfo.push({
        tag: current.tagName.toLowerCase(),
        classes: classes,
        id: current.id || null
      })
    }
    current = current.parentElement
    depth++
  }

  // 生成选择器路径（用于调试）
  const parts: string[] = []
  let currentEl: HTMLElement | null = element
  while (currentEl && currentEl !== document.body) {
    let selector = currentEl.tagName.toLowerCase()
    if (currentEl.id) {
      selector += `#${currentEl.id}`
    }
    const classes = getElementClasses(currentEl)
    if (classes.length > 0) {
      selector += '.' + classes.join('.')
    }
    parts.unshift(selector)
    currentEl = currentEl.parentElement
  }
  const selectorPath = parts.join(' > ')

  return {
    elementInfo,
    parentInfo,
    selectorPath
  }
}

// 获取元素的类名（过滤掉 scoped 相关的类）
function getElementClasses(element: HTMLElement): string[] {
  if (!element.className) return []
  
  if (typeof element.className === 'string') {
    return element.className
      .split(' ')
      .filter(c => {
        const trimmed = c.trim()
        // 过滤掉 scoped 相关的类（如 data-v-xxx）
        return trimmed && !trimmed.startsWith('data-v-')
      })
  }
  
  // 处理 classList
  if (element.classList) {
    return Array.from(element.classList).filter(c => !c.startsWith('data-v-'))
  }
  
  return []
}

// 开始编辑 CSS
async function startEditCSS(element: HTMLElement) {
  hideEditButton()
  removeHighlight()

  const config = window.__VISUAL_EDITOR_CONFIG__
  if (!config) {
    showNotification('配置未找到', 'error')
    return
  }

  // 获取当前页面路径
  const currentPath = window.location.pathname
  const sourceFiles = resolveSourceFiles(currentPath, config.sourceMap)

  if (sourceFiles.length === 0) {
    showNotification('未找到该页面对应的源文件配置，请在 nuxt.config.ts 中配置 sourceMap', 'warning')
    return
  }

  // 搜索所有可能的文件（包括 Vue 文件中的 <style> 标签）
  // 不再过滤，让后端处理所有文件类型
  const allFiles = sourceFiles

  if (allFiles.length === 0) {
    showNotification('未找到该页面对应的源文件配置，请在 nuxt.config.ts 中配置 sourceMap', 'warning')
    return
  }

  // 搜索 CSS（包括 Vue 文件中的 <style> 标签）
  const matches = await searchCSS(element, allFiles)

  if (matches.length === 0) {
    showNotification('未在 CSS 文件中找到该元素的样式规则', 'warning')
    return
  }

  // 显示 CSS 编辑抽屉
  showCSSDrawer(element, matches)
}

// 显示 CSS 编辑抽屉
function showCSSDrawer(element: HTMLElement, matches: CssMatch[]) {
  // 创建遮罩层
  const overlay = document.createElement('div')
  overlay.id = 'visual-editor-css-drawer-overlay'
  overlay.className = 'visual-editor-overlay'

  // 创建抽屉容器
  const drawer = document.createElement('div')
  drawer.id = 'visual-editor-css-drawer'
  drawer.className = 'visual-editor-drawer'

  // 创建头部
  const header = document.createElement('div')
  header.className = 'visual-editor-drawer__header'

  const title = document.createElement('h3')
  title.textContent = '编辑 CSS 样式'
  title.className = 'visual-editor-drawer__title'

  const closeBtn = document.createElement('button')
  closeBtn.innerHTML = '×'
  closeBtn.className = 'visual-editor-drawer__close'
  closeBtn.onclick = () => {
    overlay.remove()
    drawer.remove()
  }

  header.appendChild(title)
  header.appendChild(closeBtn)
  drawer.appendChild(header)

  // 创建内容区
  const content = document.createElement('div')
  content.className = 'visual-editor-drawer__content'

  // 如果有多处匹配，显示选择器
  if (matches.length > 1) {
    const selectorInfo = document.createElement('div')
    selectorInfo.className = 'visual-editor-match-info'
    selectorInfo.textContent = `找到 ${matches.length} 处匹配的 CSS 规则，请选择要编辑的规则：`
    content.appendChild(selectorInfo)
  }

  // 显示 CSS 规则列表
  matches.forEach((match, index) => {
    const matchItem = document.createElement('div')
    matchItem.className = 'visual-editor-match-item'

    // 文件路径
    const filePath = document.createElement('div')
    filePath.textContent = match.file
    filePath.className = 'visual-editor-match-item__file'

    // 选择器
    const selector = document.createElement('div')
    selector.textContent = match.selector
    selector.className = 'visual-editor-css-selector'

    // CSS 代码编辑器
    const textarea = document.createElement('textarea')
    textarea.value = match.rules
    textarea.className = 'visual-editor-css-textarea'

    // 保存按钮
    const saveBtn = document.createElement('button')
    saveBtn.textContent = '保存'
    saveBtn.className = 'visual-editor-css-save'
    saveBtn.onclick = async () => {
      const newRules = textarea.value.trim()
      if (newRules === match.rules.trim()) {
        showNotification('未修改内容', 'warning')
        return
      }

      saveBtn.disabled = true
      saveBtn.textContent = '保存中...'

      try {
        await saveCSS(match, newRules)
        showNotification('保存成功！页面将自动刷新。', 'success')
        setTimeout(() => {
          window.location.reload()
        }, 1000)
      } catch (error: any) {
        console.error('[Visual Editor] CSS save error:', error)
        alert('保存失败：' + error.message)
        saveBtn.disabled = false
        saveBtn.textContent = '保存'
      }
    }

    matchItem.appendChild(filePath)
    matchItem.appendChild(selector)
    matchItem.appendChild(textarea)
    matchItem.appendChild(saveBtn)
    content.appendChild(matchItem)
  })

  drawer.appendChild(content)

  // 点击遮罩层关闭
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      overlay.remove()
      drawer.remove()
    }
  }

  document.body.appendChild(overlay)
  document.body.appendChild(drawer)
}

// 保存 CSS
async function saveCSS(match: CssMatch, newRules: string) {
  try {
    const response = await fetch('/api/visual-editor/update-css', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file: match.file,
        selector: match.selector,
        originalRules: match.rules,
        newRules: newRules,
        line: match.line,
        isScoped: match.isScoped || false
      })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || '保存失败')
    }

    const data = await response.json()
    return data
  } catch (error: any) {
    console.error('[Visual Editor] CSS save error:', error)
    throw error
  }
}

