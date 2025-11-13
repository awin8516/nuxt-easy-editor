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
let editorContainer: HTMLElement | null = null
let hideButtonTimeout: number | null = null
let currentButton: HTMLElement | null = null
let highlightedElement: HTMLElement | null = null

type SourceMap = Record<string, string[]>

const wildcardRegexCache = new Map<string, RegExp>()

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
  createEditorContainer()

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

function createEditorContainer() {
  editorContainer = document.createElement('div')
  editorContainer.id = 'visual-editor-container'
  document.body.appendChild(editorContainer)
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
  buttonContainer.style.cssText = `
    position: fixed;
    top: ${rect.top + window.scrollY }px;
    left: ${rect.right + window.scrollX - 5 }px;
    z-index: 999998;
    display: flex;
    gap: 4px;
    transform: translate(-100%, 5px);
  
  `

  if (!shouldHideContentButton) {
    // 内容编辑按钮
    const contentButton = document.createElement('button')
    contentButton.className = 'visual-editor-btn'
    contentButton.textContent = '编辑内容'
    contentButton.style.cssText = `
      padding: 6px 12px;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 400;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      transition: all 0.2s;
      white-space: nowrap;
    `

    contentButton.addEventListener('mouseenter', () => {
      clearHideButtonTimeout()
      contentButton.style.background = '#2563eb'
      contentButton.style.transform = 'scale(1.05)'
    })

    contentButton.addEventListener('mouseleave', () => {
      contentButton.style.background = '#3b82f6'
      contentButton.style.transform = 'scale(1)'
      // 不在这里调用 scheduleHideButton，由容器统一处理
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
    cssButton.className = 'visual-editor-btn-css'
    cssButton.textContent = '编辑CSS'
    cssButton.style.cssText = `
      padding: 6px 12px;
      background: #10b981;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 400;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      transition: all 0.2s;
      white-space: nowrap;
    `

    cssButton.addEventListener('mouseenter', () => {
      clearHideButtonTimeout()
      cssButton.style.background = '#059669'
      cssButton.style.transform = 'scale(1.05)'
    })

    cssButton.addEventListener('mouseleave', () => {
      cssButton.style.background = '#10b981'
      cssButton.style.transform = 'scale(1)'
      // 不在这里调用 scheduleHideButton，由容器统一处理
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
  
  // 保存原始样式
  const originalOutline = element.style.outline
  const originalOutlineOffset = element.style.outlineOffset
  
  // 添加虚线高亮
  element.style.outline = '2px dashed rgba(255, 208, 0, 1)'
  element.style.outlineOffset = '-2px'
  element.style.background = 'rgba(255, 208, 0, 0.6)'
//   element.style.transition = 'outline 0.2s ease'
  
  highlightedElement = element
}

// 移除高亮效果
function removeHighlight() {
  if (highlightedElement) {
    highlightedElement.style.outline = ''
    highlightedElement.style.outlineOffset = ''
    highlightedElement.style.background = ''
    highlightedElement.style.transition = ''
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
  if (!searchHtml && sanitizedHtmlContent !== textContent) {
    // 内容中包含 HTML 标签，但 searchHtml 为 false，提示用户
    showNotification('内容包含 HTML 标签，请设置 searchHtml: true 来搜索', 'warning')
    return
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

  // 搜索内容
  const matches = await searchContent(originalContent.trim(), sourceFiles, searchHtml)

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
  element.style.outline = '2px solid #ffd000'
  element.style.outlineOffset = '-2px'
  element.style.minHeight = '1em'
  element.style.cursor = 'text'
  
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
    <button class="save-btn">💾 保存 (Ctrl+S)</button>
    <button class="cancel-btn">✕ 取消 (ESC)</button>
  `
  btn.style.cssText = `
    position: fixed;
    z-index: 999999;
    display: flex;
    gap: 8px;
    padding: 8px;
    background: white;
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  `
  
  const saveBtn = btn.querySelector('.save-btn') as HTMLElement
  const cancelBtn = btn.querySelector('.cancel-btn') as HTMLElement
  
  saveBtn.style.cssText = `
    padding: 6px 12px;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  `
  
  cancelBtn.style.cssText = `
    padding: 6px 12px;
    background: #f3f4f6;
    color: #374151;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  `
  
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
    // 但保留其他 HTML 实体（如 &lt;、&gt; 等，但这些应该已经被上面的正则处理了）
    newContent = newContent.replace(/&amp;/g, '&')
    
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
  element.style.outline = ''
  element.style.outlineOffset = ''
  element.style.minHeight = ''
  element.style.cursor = ''
  
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
  return escapedText.replace(regex, '<mark style="background: #fef08a; padding: 2px 4px; border-radius: 2px; font-weight: 500;">$1</mark>')
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
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.3);
    z-index: 999998;
    animation: fadeIn 0.2s ease-out;
  `
  
  // 添加动画样式（如果还没有）
  if (!document.getElementById('visual-editor-drawer-styles')) {
    const style = document.createElement('style')
    style.id = 'visual-editor-drawer-styles'
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes slideInRight {
        from { transform: translateX(100%); }
        to { transform: translateX(0); }
      }
    `
    document.head.appendChild(style)
  }
  
  // 创建抽屉容器
  const drawer = document.createElement('div')
  drawer.id = 'visual-editor-match-drawer'
  drawer.style.cssText = `
    position: fixed;
    top: 0;
    right: 0;
    width: 600px;
    max-width: 90vw;
    height: 100vh;
    background: white;
    box-shadow: -2px 0 10px rgba(0,0,0,0.1);
    z-index: 999999;
    display: flex;
    flex-direction: column;
    animation: slideInRight 0.3s ease-out;
    overflow: hidden;
  `
  
  // 创建头部
  const header = document.createElement('div')
  header.style.cssText = `
    padding: 20px;
    border-bottom: 1px solid #e5e7eb;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
  `
  
  const title = document.createElement('h3')
  title.textContent = '找到多处匹配'
  title.style.cssText = 'margin: 0; font-size: 18px; font-weight: 600; color: #111827;'
  
  const closeBtn = document.createElement('button')
  closeBtn.innerHTML = '×'
  closeBtn.style.cssText = `
    background: none;
    border: none;
    font-size: 28px;
    line-height: 1;
    cursor: pointer;
    color: #6b7280;
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: background 0.2s;
  `
  closeBtn.onmouseenter = () => {
    closeBtn.style.background = '#f3f4f6'
  }
  closeBtn.onmouseleave = () => {
    closeBtn.style.background = 'none'
  }
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
  listContainer.style.cssText = `
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  `
  
  // 创建列表
  const matchList = document.createElement('div')
  matchList.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 12px;
  `
  
  matches.forEach((match, index) => {
    const matchItem = document.createElement('div')
    matchItem.style.cssText = `
      position: relative;
      padding: 16px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: white;
      transition: all 0.2s;
      cursor: pointer;
    `
    
    matchItem.onmouseenter = () => {
      matchItem.style.borderColor = '#3b82f6'
      matchItem.style.boxShadow = '0 2px 8px rgba(59, 130, 246, 0.1)'
    }
    matchItem.onmouseleave = () => {
      matchItem.style.borderColor = '#e5e7eb'
      matchItem.style.boxShadow = 'none'
    }
    
    // 文件路径和文件名
    const fileInfo = document.createElement('div')
    fileInfo.style.cssText = 'margin-bottom: 8px;'
    
    const filePath = document.createElement('div')
    filePath.textContent = match.file
    filePath.style.cssText = `
      font-weight: 600;
      font-size: 14px;
      color: #111827;
      margin-bottom: 4px;
      word-break: break-all;
    `
    
    const lineInfo = document.createElement('div')
    lineInfo.textContent = `第 ${match.line} 行`
    lineInfo.style.cssText = `
      font-size: 12px;
      color: #6b7280;
    `
    
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
        return `<div style="display: flex; margin-bottom: 2px; ${isMatchLine ? 'background: #fef3c7; padding: 4px; border-radius: 2px;' : ''}">
          <span style="color: #9ca3af; font-size: 11px; min-width: 50px; padding-right: 12px; user-select: none; text-align: right; ${isMatchLine ? 'font-weight: 600; color: #f59e0b;' : ''}">${lineNum}</span>
          <span style="flex: 1; ${isMatchLine ? 'font-weight: 500;' : ''}">${highlightedLine || ' '}</span>
        </div>`
      }).join('')
      contentHtml = lineNumberedContent
    } else {
      // 单行内容，直接高亮
      contentHtml = highlightContent(displayContent, searchText)
    }
    
    contentPreview.innerHTML = contentHtml
    
    contentPreview.style.cssText = `
      font-size: 13px;
      color: #374151;
      line-height: 1.6;
      background: #f9fafb;
      padding: 12px;
      border-radius: 4px;
      margin-bottom: 8px;
      word-break: break-word;
      max-height: 300px;
      overflow-y: auto;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', 'source-code-pro', monospace;
      white-space: pre-wrap;
      border: 1px solid #e5e7eb;
    `
    matchItem.appendChild(contentPreview)
    
    // 【修改此处】按钮（右侧悬浮）
    const editBtn = document.createElement('button')
    editBtn.textContent = '修改此处'
    editBtn.style.cssText = `
      position: absolute;
      top: 16px;
      right: 16px;
      padding: 6px 12px;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      transition: background 0.2s;
      z-index: 10;
    `
    editBtn.onmouseenter = () => {
      editBtn.style.background = '#2563eb'
    }
    editBtn.onmouseleave = () => {
      editBtn.style.background = '#3b82f6'
    }
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
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#3b82f6'};
    color: white;
    padding: 12px 20px;
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 999999;
    max-width: 400px;
    font-size: 14px;
  `
  notification.textContent = message
  document.body.appendChild(notification)
  
  setTimeout(() => {
    notification.style.opacity = '0'
    notification.style.transition = 'opacity 0.3s'
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
  overlay.className = 'visual-editor-overlay'
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 999999;
  `

  // 创建模态框
  const modal = document.createElement('div')
  modal.className = 'visual-editor-modal'
  modal.style.cssText = `
    background: white;
    border-radius: 8px;
    width: 90%;
    max-width: 600px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  `

  // 创建头部
  const header = document.createElement('div')
  header.style.cssText = `
    padding: 16px 20px;
    border-bottom: 1px solid #e5e7eb;
    display: flex;
    justify-content: space-between;
    align-items: center;
  `
  const title = document.createElement('h3')
  title.textContent = '编辑内容'
  title.style.cssText = 'margin: 0; font-size: 18px; font-weight: 600;'
  const closeBtn = document.createElement('button')
  closeBtn.textContent = '×'
  closeBtn.style.cssText = `
    background: none;
    border: none;
    font-size: 24px;
    cursor: pointer;
    color: #6b7280;
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
  `
  closeBtn.onmouseenter = () => {
    closeBtn.style.background = '#f3f4f6'
    closeBtn.style.color = '#374151'
  }
  closeBtn.onmouseleave = () => {
    closeBtn.style.background = 'none'
    closeBtn.style.color = '#6b7280'
  }
  closeBtn.onclick = () => {
    overlay.remove()
    editorState.isEditing = false
  }
  header.appendChild(title)
  header.appendChild(closeBtn)

  // 创建内容区
  const body = document.createElement('div')
  body.style.cssText = `
    padding: 20px;
    overflow-y: auto;
    flex: 1;
  `

  // 如果有多处匹配，显示选择器
  let selectedMatchIndex = 0
  if (editorState.matches.length > 1) {
    const selector = document.createElement('div')
    selector.style.cssText = 'margin-bottom: 20px;'
    const info = document.createElement('p')
    info.textContent = `找到 ${editorState.matches.length} 处匹配，请选择要修改的位置：`
    info.style.cssText = 'margin: 0 0 12px 0; color: #6b7280; font-size: 14px;'
    selector.appendChild(info)

    const matchList = document.createElement('div')
    matchList.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 200px;
      overflow-y: auto;
    `

    editorState.matches.forEach((match, index) => {
      const matchItem = document.createElement('div')
      matchItem.style.cssText = `
        padding: 12px;
        border: 2px solid ${selectedMatchIndex === index ? '#3b82f6' : '#e5e7eb'};
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s;
        background: ${selectedMatchIndex === index ? '#dbeafe' : 'white'};
      `
      matchItem.onmouseenter = () => {
        if (selectedMatchIndex !== index) {
          matchItem.style.borderColor = '#3b82f6'
          matchItem.style.background = '#eff6ff'
        }
      }
      matchItem.onmouseleave = () => {
        if (selectedMatchIndex !== index) {
          matchItem.style.borderColor = '#e5e7eb'
          matchItem.style.background = 'white'
        }
      }
      matchItem.onclick = () => {
        selectedMatchIndex = index
        editorState.matches.forEach((_, i) => {
          const item = matchList.children[i] as HTMLElement
          if (i === index) {
            item.style.borderColor = '#3b82f6'
            item.style.background = '#dbeafe'
          } else {
            item.style.borderColor = '#e5e7eb'
            item.style.background = 'white'
          }
        })
      }

      const matchInfo = document.createElement('div')
      matchInfo.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 6px;
      `
      const fileName = document.createElement('strong')
      fileName.textContent = match.file
      fileName.style.cssText = 'color: #111827; font-size: 14px;'
      const location = document.createElement('span')
      location.textContent = `第 ${match.line} 行`
      location.style.cssText = 'color: #6b7280; font-size: 12px;'
      matchInfo.appendChild(fileName)
      matchInfo.appendChild(location)

      const preview = document.createElement('div')
      preview.textContent = match.context.substring(0, 100) + (match.context.length > 100 ? '...' : '')
      preview.style.cssText = `
        color: #6b7280;
        font-size: 12px;
        font-family: monospace;
        white-space: pre-wrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-height: 40px;
      `

      matchItem.appendChild(matchInfo)
      matchItem.appendChild(preview)
      matchList.appendChild(matchItem)
    })

    selector.appendChild(matchList)
    body.appendChild(selector)
  }

  // 创建编辑器
  const editorWrapper = document.createElement('div')
  editorWrapper.style.cssText = 'display: flex; flex-direction: column; gap: 8px;'
  const label = document.createElement('label')
  label.textContent = '内容：'
  label.style.cssText = 'font-size: 14px; font-weight: 500; color: #374151;'
  const textarea = document.createElement('textarea')
  textarea.value = editorState.originalContent
  textarea.style.cssText = `
    width: 100%;
    padding: 12px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    font-size: 14px;
    font-family: inherit;
    resize: vertical;
    outline: none;
    box-sizing: border-box;
  `
  textarea.rows = 6
  textarea.onfocus = () => {
    textarea.style.borderColor = '#3b82f6'
    textarea.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.1)'
  }
  textarea.onblur = () => {
    textarea.style.borderColor = '#d1d5db'
    textarea.style.boxShadow = 'none'
  }
  editorWrapper.appendChild(label)
  editorWrapper.appendChild(textarea)
  body.appendChild(editorWrapper)

  // 创建底部
  const footer = document.createElement('div')
  footer.style.cssText = `
    padding: 16px 20px;
    border-top: 1px solid #e5e7eb;
    display: flex;
    justify-content: flex-end;
    gap: 12px;
  `

  const cancelBtn = document.createElement('button')
  cancelBtn.textContent = '取消'
  cancelBtn.style.cssText = `
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    background: #f3f4f6;
    color: #374151;
    transition: all 0.2s;
  `
  cancelBtn.onmouseenter = () => {
    cancelBtn.style.background = '#e5e7eb'
  }
  cancelBtn.onmouseleave = () => {
    cancelBtn.style.background = '#f3f4f6'
  }
  cancelBtn.onclick = () => {
    overlay.remove()
    editorState.isEditing = false
  }

  let saving = false
  const saveBtn = document.createElement('button')
  saveBtn.textContent = '保存'
  saveBtn.style.cssText = `
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    background: #3b82f6;
    color: white;
    transition: all 0.2s;
  `
  saveBtn.onmouseenter = () => {
    if (!saving) {
      saveBtn.style.background = '#2563eb'
    }
  }
  saveBtn.onmouseleave = () => {
    if (!saving) {
      saveBtn.style.background = '#3b82f6'
    }
  }
  saveBtn.onclick = async () => {
    if (saving) return
    saving = true
    saveBtn.textContent = '保存中...'
    saveBtn.style.opacity = '0.6'
    saveBtn.style.cursor = 'not-allowed'

    try {
      await saveContent(textarea.value, selectedMatchIndex)
      overlay.remove()
      editorState.isEditing = false
    } catch (error) {
      saving = false
      saveBtn.textContent = '保存'
      saveBtn.style.opacity = '1'
      saveBtn.style.cursor = 'pointer'
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
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.3);
    z-index: 999998;
    animation: fadeIn 0.2s ease-out;
  `

  // 创建抽屉容器
  const drawer = document.createElement('div')
  drawer.id = 'visual-editor-css-drawer'
  drawer.style.cssText = `
    position: fixed;
    top: 0;
    right: 0;
    width: 600px;
    max-width: 90vw;
    height: 100vh;
    background: white;
    box-shadow: -2px 0 10px rgba(0,0,0,0.1);
    z-index: 999999;
    display: flex;
    flex-direction: column;
    animation: slideInRight 0.3s ease-out;
    overflow: hidden;
  `

  // 创建头部
  const header = document.createElement('div')
  header.style.cssText = `
    padding: 20px;
    border-bottom: 1px solid #e5e7eb;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
  `

  const title = document.createElement('h3')
  title.textContent = '编辑 CSS 样式'
  title.style.cssText = 'margin: 0; font-size: 18px; font-weight: 600; color: #111827;'

  const closeBtn = document.createElement('button')
  closeBtn.innerHTML = '×'
  closeBtn.style.cssText = `
    background: none;
    border: none;
    font-size: 28px;
    line-height: 1;
    cursor: pointer;
    color: #6b7280;
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: background 0.2s;
  `
  closeBtn.onmouseenter = () => {
    closeBtn.style.background = '#f3f4f6'
  }
  closeBtn.onmouseleave = () => {
    closeBtn.style.background = 'none'
  }
  closeBtn.onclick = () => {
    overlay.remove()
    drawer.remove()
  }

  header.appendChild(title)
  header.appendChild(closeBtn)
  drawer.appendChild(header)

  // 创建内容区
  const content = document.createElement('div')
  content.style.cssText = `
    flex: 1;
    overflow-y: auto;
    padding: 20px;
  `

  // 如果有多处匹配，显示选择器
  if (matches.length > 1) {
    const selectorInfo = document.createElement('div')
    selectorInfo.style.cssText = `
      margin-bottom: 16px;
      padding: 12px;
      background: #fef3c7;
      border-radius: 6px;
      font-size: 14px;
      color: #92400e;
    `
    selectorInfo.textContent = `找到 ${matches.length} 处匹配的 CSS 规则，请选择要编辑的规则：`
    content.appendChild(selectorInfo)
  }

  // 显示 CSS 规则列表
  matches.forEach((match, index) => {
    const matchItem = document.createElement('div')
    matchItem.style.cssText = `
      margin-bottom: 16px;
      padding: 16px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: #f9fafb;
    `

    // 文件路径
    const filePath = document.createElement('div')
    filePath.textContent = match.file
    filePath.style.cssText = `
      font-weight: 600;
      font-size: 13px;
      color: #111827;
      margin-bottom: 8px;
      word-break: break-all;
    `

    // 选择器
    const selector = document.createElement('div')
    selector.textContent = match.selector
    selector.style.cssText = `
      font-size: 12px;
      color: #6b7280;
      margin-bottom: 12px;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', monospace;
    `

    // CSS 代码编辑器
    const textarea = document.createElement('textarea')
    textarea.value = match.rules
    textarea.style.cssText = `
      width: 100%;
      min-height: 150px;
      padding: 12px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', monospace;
      font-size: 13px;
      line-height: 1.6;
      resize: vertical;
      background: white;
    `

    // 保存按钮
    const saveBtn = document.createElement('button')
    saveBtn.textContent = '保存'
    saveBtn.style.cssText = `
      margin-top: 8px;
      padding: 8px 16px;
      background: #10b981;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: background 0.2s;
    `
    saveBtn.onmouseenter = () => {
      saveBtn.style.background = '#059669'
    }
    saveBtn.onmouseleave = () => {
      saveBtn.style.background = '#10b981'
    }
    saveBtn.onclick = async () => {
      const newRules = textarea.value.trim()
      if (newRules === match.rules.trim()) {
        showNotification('未修改内容', 'warning')
        return
      }

      saveBtn.disabled = true
      saveBtn.textContent = '保存中...'
      saveBtn.style.opacity = '0.6'
      saveBtn.style.cursor = 'not-allowed'

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
        saveBtn.style.opacity = '1'
        saveBtn.style.cursor = 'pointer'
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

