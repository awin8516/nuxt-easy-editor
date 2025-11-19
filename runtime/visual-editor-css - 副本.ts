import type { SourceMap, VisualEditorRuntimeConfig } from './visual-editor'
import { normalizePathname, buildPathCandidates, resolveSourceFiles } from './visual-editor'

// 导入共享接口和公共函数
import {
  CssMatch,
  ElementInfo,
  editorComponent,
  hideButtonTimeout,
  currentButton,
  setHighlightedElement,
  showNotification,
  escapeHtml,
  unescapeHtml,
  hideEditButton
} from './visual-editor'

/**
 * 搜索CSS文件中与指定元素相关的样式规则
 * @param element DOM元素
 * @param cssFiles CSS文件路径数组
 * @returns CSS匹配结果Promise数组
 */
async function searchCSS(element: HTMLElement, cssFiles: string[]): Promise<CssMatch[]> {
  try {
    const elementSelector = getElementSelector(element)
    
    const response = await fetch('/api/visual-editor/search-css', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        elementSelector: elementSelector, // 传递对象而不是字符串
        cssFiles: cssFiles
      })
    })

    if (!response.ok) {
      throw new Error('搜索 CSS 失败')
    }

    return await response.json()
  } catch (error) {
    console.error('[Visual Editor] CSS search error:', error)
    return []
  }
}

/**
 * 获取元素的选择器信息
 * @param element DOM元素
 * @returns 元素的选择器信息
 */
function getElementSelector(element: HTMLElement): ElementInfo {
  const tag = element.tagName.toLowerCase()
  const id = element.id || null
  const classes = getClassNames(element)
  
  const parentInfo: Array<{ tag: string; classes: string[]; id: string | null }> = []
  let current = element.parentElement
  
  // 最多向上遍历5层父元素
  for (let i = 0; i < 5 && current; i++) {
    if (current.id || getClassNames(current).length > 0) {
      parentInfo.push({
        tag: current.tagName.toLowerCase(),
        classes: getClassNames(current),
        id: current.id || null
      })
    }
    current = current.parentElement
  }
  
  // 生成完整的选择器路径
  let currentEl = element
  const parts: string[] = []
  
  for (let i = 0; i < 5 && currentEl; i++) {
    let selector = currentEl.tagName.toLowerCase()
    if (currentEl.id) {
      selector += `#${currentEl.id}`
      parts.unshift(selector)
      break
    }
    
    const classes = getClassNames(currentEl)
    if (classes.length > 0) {
      selector += '.' + classes.join('.')
      parts.unshift(selector)
    } else if (currentEl.parentElement) {
      // 如果没有ID和class，使用标签名和nth-of-type
      const siblings = Array.from(currentEl.parentElement.children)
      const index = siblings.indexOf(currentEl) + 1
      selector += `:nth-of-type(${index})`
      parts.unshift(selector)
    } else {
      parts.unshift(selector)
      break
    }
    
    currentEl = currentEl.parentElement as HTMLElement
  }
  
  const selectorPath = parts.join(' > ')
  
  return {
    tag,
    classes,
    id,
    parentInfo,
    selectorPath
  }
}

/**
 * 获取元素的类名数组
 * @param element DOM元素
 * @returns 类名数组
 */
function getClassNames(element: HTMLElement): string[] {
  if (!element.className) return []
  
  if (typeof element.className === 'string') {
    return element.className
      .split(/\s+/)
      .filter(className => className.trim() !== '')
  }
  
  return Array.from(element.classList)
}

/**
 * 开始编辑CSS样式
 * @param element 要编辑样式的DOM元素
 */
export async function startEditCSS(element: HTMLElement) {
  hideEditButton()
  if (highlightedElement) {
    highlightedElement.classList.remove('visual-editor-highlight')
    setHighlightedElement(null)
  }
  
  // 获取元素信息
  const elementInfo = getElementSelector(element)
  const selector = elementInfo.selectorPath
  
  // 搜索CSS匹配
  const matches = await searchCSS(element)
  
  if (matches.length === 0) {
    showNotification('未找到匹配的CSS规则', 'error')
    return
  }
  
  // 显示CSS编辑抽屉
  showCSSDrawer(element, matches)
}

/**
 * 显示 CSS 编辑抽屉
 * @param element DOM元素
 * @param matches CSS匹配结果数组
 */
function showCSSDrawer(element: HTMLElement, matches: CssMatch[]) {
  // 创建遮罩层
  const overlay = document.createElement('div')
  overlay.id = 'visual-editor-css-drawer-overlay'
  overlay.className = 'visual-editor-overlay'
  
  // 创建抽屉容器
  const drawer = document.createElement('div')
  drawer.id = 'visual-editor-css-drawer'
  drawer.className = 'visual-editor-drawer'
  
  // 创建抽屉头部
  const header = document.createElement('div')
  header.className = 'visual-editor-drawer__header'
  
  const title = document.createElement('h3')
  title.textContent = '编辑 CSS 样式'
  title.className = 'visual-editor-drawer__title'
  
  const closeBtn = document.createElement('button')
  closeBtn.className = 'visual-editor-drawer__close'
  closeBtn.innerHTML = '&times;'
  closeBtn.addEventListener('click', () => {
    document.body.removeChild(overlay)
  })
  
  header.appendChild(title)
  header.appendChild(closeBtn)
  drawer.appendChild(header)
  
  // 创建抽屉内容
  const content = document.createElement('div')
  content.className = 'visual-editor-drawer__content'
  
  // 显示选择器信息
  const selectorInfo = document.createElement('div')
  selectorInfo.className = 'visual-editor-match-info'
  selectorInfo.textContent = `找到 ${matches.length} 处匹配的 CSS 规则，请选择要编辑的规则：`
  content.appendChild(selectorInfo)
  
  // 显示 CSS 规则列表
  matches.forEach((match, index) => {
    const matchItem = document.createElement('div')
    matchItem.className = 'visual-editor-match-item'
    
    const filePath = document.createElement('div')
    filePath.textContent = match.file
    filePath.className = 'visual-editor-match-item__file'
    matchItem.appendChild(filePath)
    
    const selector = document.createElement('div')
    selector.textContent = match.selector
    selector.className = 'visual-editor-css-selector'
    matchItem.appendChild(selector)
    
    // CSS 代码编辑器
    const textarea = document.createElement('textarea')
    textarea.className = 'visual-editor-css-textarea'
    textarea.value = match.rules
    textarea.placeholder = '编辑 CSS 规则...'
    matchItem.appendChild(textarea)
    
    // 保存按钮
    const saveBtn = document.createElement('button')
    saveBtn.className = 'visual-editor-css-save'
    saveBtn.textContent = '保存'
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true
      saveBtn.textContent = '保存中...'
      
      try {
        const newRules = textarea.value
        await saveCSS(match, newRules)
        showNotification('CSS 样式已保存', 'success')
        document.body.removeChild(overlay)
        window.location.reload()
      } catch (error) {
        console.error('[Visual Editor] CSS save error:', error)
        showNotification('保存 CSS 样式失败', 'error')
      } finally {
        saveBtn.disabled = false
        saveBtn.textContent = '保存'
      }
    })
    matchItem.appendChild(saveBtn)
    
    content.appendChild(matchItem)
  })
  
  drawer.appendChild(content)
  overlay.appendChild(drawer)
  document.body.appendChild(overlay)
}

/**
 * 保存CSS样式规则到源文件
 * @param match CSS匹配结果
 * @param newRules 新的CSS规则
 */
async function saveCSS(match: CssMatch, newRules: string) {
  try {
    const response = await fetch('/api/visual-editor/update-css', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        file: match.file,
        selector: match.selector,
        originalRules: match.rules,
        newRules: newRules,
        line: match.line,
        isScoped: match.isScoped
      })
    })

    if (!response.ok) {
      throw new Error('保存 CSS 失败')
    }
  } catch (error) {
    console.error('[Visual Editor] CSS save error:', error)
    throw error
  }
}







/**
 * 构建通配符正则表达式
 * @param pattern 通配符模式
 * @returns 正则表达式
 */
function buildWildcardRegex(pattern: string): RegExp {
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