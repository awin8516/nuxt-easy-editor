/**
 * 转义正则表达式特殊字符
 * @param str 需要转义的字符串
 * @returns 转义后的字符串
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|\[\]\\]/g, '\\$&')
}

/**
 * 移除 Vue scoped 注入的 data-v-* 属性
 * @param html HTML 内容
 * @returns 移除 scoped 属性后的 HTML
 */
export function removeScopedAttributes(html: string): string {
  if (!html) return html
  return html
    // 移除引号属性值形式 (单引号)
    .replace(/\sdata-v-[a-zA-Z0-9_-]+='[^']*'/g, '')
    // 移除引号属性值形式 (双引号)
    .replace(/\sdata-v-[a-zA-Z0-9_-]+="[^"]*"/g, '')
    // 移除无值属性形式
    .replace(/\sdata-v-[a-zA-Z0-9_-]+(?![=\w-])/g, '')
    // 移除可能在标签内的所有 data-v-* 属性
    .replace(/\sdata-v-[a-zA-Z0-9_-]+/g, '')
}

/**
 * 提取元素的类名（过滤掉 scoped 相关的类）
 * @param element DOM 元素
 * @returns 过滤后的类名数组
 */
export function getElementClasses(element: HTMLElement): string[] {
  if (!element.className) return []
  
  if (typeof element.className === 'string') {
    return element.className
      .split(' ')
      .filter(c => {
        const trimmed = c.trim()
        return trimmed && !trimmed.startsWith('data-v-')
      })
  }
  
  // 处理 classList
  if (element.classList) {
    return Array.from(element.classList).filter(c => !c.startsWith('data-v-'))
  }
  
  return []
}

/**
 * 生成元素的完整选择器路径
 * @param element DOM 元素
 * @returns 选择器路径字符串
 */
export function getElementSelectorPath(element: HTMLElement): string {
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
  return parts.join(' > ')
}

/**
 * 安全的字符串替换函数
 * @param content 原始内容
 * @param search 搜索字符串
 * @param replace 替换字符串
 * @returns 替换后的内容
 */
export function safeReplace(content: string, search: string, replace: string): string {
  if (!search || !content) return content
  const escapedSearch = escapeRegex(search)
  const regex = new RegExp(escapedSearch, 'g')
  return content.replace(regex, replace)
}

/**
 * 清理 HTML 内容
 * @param html HTML 内容
 * @returns 清理后的 HTML
 */
export function cleanHtmlContent(html: string): string {
  let cleaned = html
  // 处理 contenteditable 产生的 <div> 标签
  cleaned = cleaned.replace(/<div>/g, '<br>').replace(/<\/div>/g, '')
  // 合并多个连续的 <br>
  cleaned = cleaned.replace(/(<br\s*\/?>)+/gi, '<br>')
  // 移除首尾的空白字符
  cleaned = cleaned.trim()
  return cleaned
}