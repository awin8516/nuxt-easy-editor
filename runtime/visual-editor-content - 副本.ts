import type { SourceMap, VisualEditorRuntimeConfig } from './visual-editor'
import { normalizePathname, buildPathCandidates, resolveSourceFiles } from './visual-editor'

// 导入共享接口和公共函数
import {
  Match,
  EditorState,
  getEditorState,
  setEditorState,
  editorComponent,
  hideButtonTimeout,
  currentButton,
  setHighlightedElement,
  escapeHtml,
  unescapeHtml,
  removeScopedAttributes,
  showNotification,
  buildWildcardRegex
} from './visual-editor'

/**
 * 生成内容变体数组
 * @param content 原始内容
 * @returns 内容变体数组
 */
export function generateContentVariants(content: string): string[] {
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



/**
 * 搜索匹配的内容
 * @param content 要搜索的内容
 * @param pathname 当前路径名
 * @returns 搜索结果
 */
async function searchContent(content: string, pathname: string): Promise<Match[]> {
  const config = window.__VISUAL_EDITOR_CONFIG__ as VisualEditorRuntimeConfig
  if (!config) {
    console.warn('[Visual Editor] Configuration not available')
    return []
  }

  const sourceMap = config.sourceMap
  const files = resolveSourceFiles(pathname, sourceMap)
  
  // 确保content不为空且files是有效的数组
  if (!content || content.trim() === '' || !Array.isArray(files) || files.length === 0) {
    console.warn('[Visual Editor] Invalid search parameters:', { content, files })
    return []
  }

  try {
    const response = await fetch('/api/visual-editor/search-content', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: content.trim(),
        files
      })
    })

    if (!response.ok) {
      // 获取更多错误信息
      const errorData = await response.json().catch(() => ({}))
      const errorMessage = errorData.message || `Search failed with status ${response.status}`
      throw new Error(errorMessage)
    }

    const result = await response.json()
    // 返回result.matches或整个结果，取决于API的实际返回格式
    return result.matches || result
  } catch (error) {
    console.error('[Visual Editor] Search error:', error)
    // 显示用户友好的错误通知
    showNotification('搜索内容时出错，请检查控制台获取详情', 'error')
    return []
  }
}

/**
 * 显示匹配选择器
 * @param element DOM元素
 * @param matches 匹配结果
 */
function showMatchSelector(element: HTMLElement, matches: Match[]) {
  // 创建遮罩层
  const overlay = document.createElement('div')
  overlay.id = 'visual-editor-drawer-overlay'
  overlay.className = 'visual-editor-overlay'

  // 创建抽屉
  const drawer = document.createElement('div')
  drawer.id = 'visual-editor-match-drawer'
  drawer.className = 'visual-editor-drawer'

  // 创建抽屉头部
  const header = document.createElement('div')
  header.className = 'visual-editor-drawer__header'

  const title = document.createElement('h3')
  title.className = 'visual-editor-drawer__title'
  title.textContent = '选择要更新的内容'

  const closeBtn = document.createElement('button')
  closeBtn.className = 'visual-editor-drawer__close'
  closeBtn.innerHTML = '&times;'
  closeBtn.addEventListener('click', () => {
    if (overlay.parentElement) {
      overlay.parentElement.removeChild(overlay)
    }
  })

  header.appendChild(title)
  header.appendChild(closeBtn)
  drawer.appendChild(header)

  // 创建抽屉内容
  const content = document.createElement('div')
  content.className = 'visual-editor-drawer__content'

  const info = document.createElement('p')
  info.textContent = `找到 ${matches.length} 处匹配的内容。请选择要更新的位置：`
  content.appendChild(info)

  // 创建匹配列表
  const matchList = document.createElement('div')
  matchList.className = 'visual-editor-match-list'

  matches.forEach((match, index) => {
    const matchItem = document.createElement('div')
    matchItem.className = 'visual-editor-match-item'

    // 文件路径
    const filePath = document.createElement('div')
    filePath.className = 'visual-editor-match-item__file'
    filePath.textContent = match.file
    matchItem.appendChild(filePath)

    // 行号信息
    const lineInfo = document.createElement('div')
    lineInfo.className = 'visual-editor-match-item__line'
    lineInfo.textContent = `第 ${match.line} 行`
    matchItem.appendChild(lineInfo)

    // 上下文预览
    const contentPreview = document.createElement('div')
    contentPreview.className = 'visual-editor-match-item__preview'
    contentPreview.innerHTML = match.context
    matchItem.appendChild(contentPreview)

    // 编辑按钮
    const editBtn = document.createElement('button')
    editBtn.className = 'visual-editor-match-item__action'
    editBtn.textContent = '编辑此处'
    editBtn.addEventListener('click', async () => {
      await enableInlineEdit(element, match)
      if (overlay.parentElement) {
        overlay.parentElement.removeChild(overlay)
      }
    })
    matchItem.appendChild(editBtn)

    matchList.appendChild(matchItem)
  })

  content.appendChild(matchList)
  drawer.appendChild(content)
  overlay.appendChild(drawer)

  document.body.appendChild(overlay)
}

/**
 * 启用内联编辑
 * @param element DOM元素
 * @param matches 匹配结果数组
 */
async function enableInlineEdit(element: HTMLElement, matches: Match[]) {
  const currentEditorState = getEditorState();
  if (currentEditorState.isEditing) {
    return
  }

  const config = window.__VISUAL_EDITOR_CONFIG__ as VisualEditorRuntimeConfig
  if (!config) return

  const originalContent = getElementContent(element)
  if (matches.length === 0) {
    showNotification('未找到匹配的内容', 'error')
    return
  }

  // 进入编辑状态
  setEditorState({
    element,
    originalContent,
    matches: match ? [match] : matches,
    isEditing: true
  })

  // 设置元素为可编辑
  element.setAttribute('contenteditable', 'true')
  element.classList.add('visual-editor-editing')

  // 聚焦到元素
  const range = document.createRange()
  const selection = window.getSelection()
  range.selectNodeContents(element)
  range.collapse(false)
  selection?.removeAllRanges()
  selection?.addRange(range)

  // 添加保存按钮
  const rect = element.getBoundingClientRect()
  const saveBtn = createSaveButton(element)

  // 计算按钮位置
  const buttonTop = rect.bottom + 10
  const buttonLeft = rect.left
  
  saveBtn.style.top = `${buttonTop}px`
  saveBtn.style.left = `${buttonLeft}px`

  document.body.appendChild(saveBtn)

  // 监听编辑状态
  element.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      cancelEdit()
    }
  })

  // 监听点击事件，如果点击外部则取消编辑
  document.addEventListener('click', (e) => {
    if (saveBtn.contains(e.target as Node) || element.contains(e.target as Node)) {
      return
    }
    cancelEdit()
  })
}

/**
 * 获取元素内容
 * @param element DOM元素
 * @returns 元素内容
 */
function getElementContent(element: HTMLElement): string {
  let content = element.textContent?.trim() || ''
  content = content.replace(/\s+/g, ' ') // 将多个连续空格替换为单个空格
  content = content.replace(/\n+/g, '\n') // 将多个连续换行替换为单个换行
  return content
}

/**
 * 创建保存按钮
 * @param element DOM元素
 * @returns 保存按钮元素
 */
function createSaveButton(element: HTMLElement): HTMLElement {
  const btn = document.createElement('div')
  btn.className = 'visual-editor-save-btn'
  btn.style.position = 'fixed'
  btn.style.zIndex = '9999'

  const saveBtn = document.createElement('button')
  saveBtn.className = 'visual-editor-save-btn__save'
  saveBtn.textContent = '保存'
  saveBtn.addEventListener('click', handleSave)
  btn.appendChild(saveBtn)

  const cancelBtn = document.createElement('button')
  cancelBtn.className = 'visual-editor-save-btn__cancel'
  cancelBtn.textContent = '取消'
  cancelBtn.addEventListener('click', cancelEdit)
  btn.appendChild(cancelBtn)

  return btn
}

/**
 * 处理保存操作
 */
async function handleSave() {
  const { element, originalContent, matches } = getEditorState()
  if (!element || !matches || matches.length === 0) return

  const newContent = element.textContent?.trim() || ''

  if (newContent === originalContent) {
    cancelEdit()
    return
  }

  try {
    const match = matches[0]
    
    // 更新源文件
    const response = await fetch('/api/visual-editor/update-file', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        file: match.file,
        content: newContent,
        originalContent: match.originalContent
      })
    })

    if (!response.ok) {
      throw new Error('Update failed')
    }

    // 更新成功
    showNotification('内容已保存', 'success')
    
    // 退出编辑状态
    cancelEdit()
    
    // 自动刷新页面
    window.location.reload()
  } catch (error) {
    console.error('[Visual Editor] Save error:', error)
    showNotification('保存失败', 'error')
    cancelEdit()
  }
}

/**
 * 取消编辑
 */
function cancelEdit() {
  const { element } = getEditorState()
  if (!element) return

  // 恢复元素内容
  setElementContent(element, editorState.originalContent)

  // 移除可编辑属性
  element.removeAttribute('contenteditable')
  element.classList.remove('visual-editor-editing')

  // 移除保存按钮
  const saveBtns = document.querySelectorAll('.visual-editor-save-btn')
  saveBtns.forEach(btn => {
    if (btn.parentElement) {
      btn.parentElement.removeChild(btn)
    }
  })

  // 重置编辑状态
  setEditorState({
    element: null,
    originalContent: '',
    matches: [],
    isEditing: false
  })
}

/**
 * 设置元素内容
 * @param element DOM元素
 * @param content 要设置的内容
 */
function setElementContent(element: HTMLElement, content: string) {
  element.textContent = content
}







// 异步版本的generateContentVariants已删除，保留顶部的非异步版本

/**
 * 高亮显示元素
 * @param element 要高亮的元素
 */
export function highlightElement(element: HTMLElement) {
  element.classList.add('visual-editor-highlight')
  setHighlightedElement(element)
}

/**
 * 移除元素高亮
 * @param element 要移除高亮的元素
 */
export function removeHighlight(element?: HTMLElement) {
  if (element) {
    element.classList.remove('visual-editor-highlight')
    setHighlightedElement(null)
  }
}

/**
 * 保存内容到源文件
 * @param element DOM元素
 * @param newContent 新内容
 * @returns Promise<boolean> 保存是否成功
 */
export async function saveContent(element: HTMLElement, newContent: string): Promise<boolean> {
  const config = window.__VISUAL_EDITOR_CONFIG__ as VisualEditorRuntimeConfig
  if (!config) {
    console.warn('[Visual Editor] Configuration not available')
    showNotification('编辑器配置不可用', 'error')
    return false
  }

  try {
    const pathname = normalizePathname(window.location.pathname)
    const originalContent = getElementContent(element)
    
    // 验证内容
    if (!originalContent || !newContent || originalContent === newContent) {
      if (originalContent === newContent) {
        showNotification('内容未发生变化', 'info')
      } else {
        showNotification('无效的内容', 'error')
      }
      return false
    }
    
    const matches = await searchContent(originalContent, pathname)

    if (matches.length > 0) {
      const match = matches[0]
      
      // 验证文件信息
      if (!match.file || !match.originalContent) {
        showNotification('找不到有效的文件信息', 'error')
        return false
      }
      
      const response = await fetch('/api/visual-editor/update-file', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          file: match.file,
          content: newContent,
          originalContent: match.originalContent
        })
      })
      
      if (!response.ok) {
        // 获取更多错误信息
        const errorData = await response.json().catch(() => ({}))
        const errorMessage = errorData.message || `保存失败: ${response.status}`
        throw new Error(errorMessage)
      }

      showNotification('内容已保存', 'success')
      return true
    } else {
      showNotification('未找到匹配的内容', 'error')
      return false
    }
  } catch (error) {
    console.error('[Visual Editor] Save error:', error)
    showNotification('保存失败: ' + (error instanceof Error ? error.message : String(error)), 'error')
    return false
  }
}

/**
 * 开始编辑内容
 * @param element 要编辑的DOM元素
 */
export async function startEditContent(element: HTMLElement) {
  hideEditButton()
  removeHighlight()

  const config = window.__VISUAL_EDITOR_CONFIG__ as VisualEditorRuntimeConfig
  if (!config) {
    showNotification('配置未找到', 'error')
    return
  }

  // 获取原始内容
  const rawHtmlContent = element.innerHTML
  const sanitizedHtmlContent = removeScopedAttributes(rawHtmlContent)

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
  for (let i = 0; i < contentVariants.length; i++) {
    const variant = contentVariants[i]
    const variantMatches = await searchContent(variant, currentPath)
    
    if (variantMatches.length > 0) {
      console.log(`【查找成功】原始内容变体 ${i+1}/${contentVariants.length}, ${variant} 找到匹配`);
      matches = variantMatches
      break  // 找到匹配后停止遍历
    }
  }

  const currentState = getEditorState();
  setEditorState({
    ...currentState,
    element,
    originalContent,
    matches,
    isEditing: true
  })

  // 如果有多处匹配，先显示选择器
  if (matches.length > 1) {
    showMatchSelector(element, matches)
  } else if (matches.length === 1) {
    // 直接启用内联编辑
    await enableInlineEdit(element, [matches[0]])
  } else {
    showNotification('未找到匹配的源代码文件', 'error')
  }
}

export { enableInlineEdit, startEdit }