import { readFileSync } from 'fs'
import { resolve } from 'path'
import fastGlob from 'fast-glob'
import { defineEventHandler, readBody, createError } from 'h3'

interface CssMatch {
  file: string
  selector: string
  rules: string
  line: number
  context: string
  isScoped?: boolean
}

interface ElementInfo {
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
}

// 展开 glob 模式
async function expandGlobPattern(pattern: string): Promise<string[]> {
  if (pattern.includes('*') || pattern.includes('**')) {
    const files = await fastGlob(pattern, {
      cwd: process.cwd(),
      absolute: true
    })
    return files
  }
  return [pattern]
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { elementSelector, cssFiles } = body

  if (!elementSelector || !cssFiles || !Array.isArray(cssFiles) || cssFiles.length === 0) {
    throw createError({
      statusCode: 400,
      message: 'Invalid request parameters'
    })
  }

  const matches: CssMatch[] = []

  // 解析元素选择器信息
  let elementInfo: ElementInfo
  try {
    elementInfo = typeof elementSelector === 'string' 
      ? JSON.parse(elementSelector) 
      : elementSelector
  } catch {
    throw createError({
      statusCode: 400,
      message: 'Invalid element selector format'
    })
  }

  // 展开所有 glob 模式
  const expandedFiles: string[] = []
  for (const pattern of cssFiles) {
    const files = await expandGlobPattern(pattern)
    expandedFiles.push(...files)
  }

  // 移除重复的文件路径
  const uniqueFiles = [...new Set(expandedFiles)]

  for (const filePath of uniqueFiles) {
    try {
      const resolvedPath = filePath.startsWith('/') || filePath.match(/^[A-Z]:/)
        ? filePath
        : resolve(process.cwd(), filePath)

      const fileContent = readFileSync(resolvedPath, 'utf-8')
      
      // 检查是否是 Vue 文件（包含 <style> 标签）
      if (/\.(vue|jsx|tsx)$/i.test(filePath) || fileContent.includes('<style')) {
        // 解析 Vue 文件中的 <style> 标签
        const vueMatches = parseVueStyles(fileContent, resolvedPath, elementInfo)
        matches.push(...vueMatches)
      } else {
        // 解析纯 CSS 文件
        const cssMatches = parseCSSFile(fileContent, resolvedPath, elementInfo)
        matches.push(...cssMatches)
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error(`[Visual Editor] Error reading file ${filePath}:`, error.message)
      }
    }
  }

  return { matches }
})

// 解析 Vue 文件中的 <style> 标签
function parseVueStyles(content: string, filePath: string, elementInfo: ElementInfo): CssMatch[] {
  const matches: CssMatch[] = []
  
  // 匹配 <style> 标签（支持 scoped）
  const styleRegex = /<style(?:\s+scoped)?(?:\s+lang=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/style>/gi
  let styleMatch
  
  while ((styleMatch = styleRegex.exec(content)) !== null) {
    const isScoped = styleMatch[0].includes('scoped')
    const lang = styleMatch[1] || 'css'
    const styleContent = styleMatch[2]
    
    // 计算 style 标签在文件中的起始行号
    const beforeStyle = content.substring(0, styleMatch.index)
    const styleStartLine = beforeStyle.split('\n').length
    
    // 解析样式内容
    const styleMatches = parseCSSContent(styleContent, filePath, elementInfo, styleStartLine, isScoped)
    matches.push(...styleMatches)
  }
  
  return matches
}

// 解析纯 CSS 文件
function parseCSSFile(content: string, filePath: string, elementInfo: ElementInfo): CssMatch[] {
  return parseCSSContent(content, filePath, elementInfo, 1, false)
}

// 解析 CSS 内容
function parseCSSContent(
  content: string, 
  filePath: string, 
  elementInfo: ElementInfo, 
  startLineOffset: number,
  isScoped: boolean
): CssMatch[] {
  const matches: CssMatch[] = []
  const lines = content.split('\n')
  
  let inRule = false
  let currentSelector = ''
  let currentRules: string[] = []
  let ruleStartLine = 0
  let braceCount = 0
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmedLine = line.trim()
    
    // 跳过注释
    if (trimmedLine.startsWith('/*')) {
      // 多行注释
      if (!trimmedLine.includes('*/')) {
        let j = i + 1
        while (j < lines.length && !lines[j].includes('*/')) {
          j++
        }
        i = j
      }
      continue
    }
    if (trimmedLine.startsWith('//')) {
      continue
    }
    
    // 检查是否是选择器行
    if (trimmedLine.includes('{') && !inRule) {
      // 提取选择器（可能跨多行）
      const selectorMatch = line.match(/^([^{]+)\{/)
      if (selectorMatch) {
        currentSelector = selectorMatch[1].trim()
        ruleStartLine = i + startLineOffset
        inRule = true
        braceCount = 1
        currentRules = [line]
        
        // 检查选择器是否匹配
        if (isSelectorMatch(currentSelector, elementInfo, isScoped)) {
          // 继续读取规则块
          continue
        } else {
          // 不匹配，重置
          inRule = false
          currentSelector = ''
          currentRules = []
        }
      }
    } else if (inRule) {
      currentRules.push(line)
      
      // 计算大括号
      for (const char of line) {
        if (char === '{') braceCount++
        if (char === '}') braceCount--
      }
      
      // 规则块结束
      if (braceCount === 0) {
        const rules = currentRules.join('\n')
        const context = getContext(lines, ruleStartLine - startLineOffset, 5)
        
        matches.push({
          file: filePath,
          selector: currentSelector,
          rules: rules,
          line: ruleStartLine,
          context: context,
          isScoped: isScoped
        })
        
        // 重置
        inRule = false
        currentSelector = ''
        currentRules = []
      }
    }
  }
  
  return matches
}

// 检查选择器是否匹配（智能匹配）
function isSelectorMatch(cssSelector: string, elementInfo: ElementInfo, isScoped: boolean): boolean {
  // 清理选择器（移除 scoped 属性选择器，如 [data-v-xxx]）
  const cleanSelector = cssSelector.replace(/\[data-v-[^\]]+\]/g, '').trim()
  
  // 分割多个选择器（逗号分隔）
  const cssParts = cleanSelector.split(',').map(s => s.trim()).filter(s => s)
  
  for (const cssPart of cssParts) {
    if (matchSelector(cssPart, elementInfo)) {
      return true
    }
  }
  
  return false
}

// 匹配单个选择器
function matchSelector(cssSelector: string, elementInfo: ElementInfo): boolean {
  const { elementInfo: elInfo, parentInfo } = elementInfo
  
  // 解析 CSS 选择器
  // 支持：.class, #id, tag, .parent .child, .parent > child, .parent tag 等
  
  // 1. 直接匹配元素本身
  if (matchElementSelector(cssSelector, elInfo)) {
    return true
  }
  
  // 2. 匹配组合选择器（如 .slogan h3）
  if (cssSelector.includes(' ') || cssSelector.includes('>')) {
    return matchCombinedSelector(cssSelector, elInfo, parentInfo)
  }
  
  return false
}

// 匹配元素选择器
function matchElementSelector(cssSelector: string, elInfo: { tag: string; classes: string[]; id: string | null }): boolean {
  // 类选择器
  const classMatches = cssSelector.match(/\.([a-zA-Z0-9_-]+)/g)
  if (classMatches) {
    const requiredClasses = classMatches.map(m => m.substring(1))
    const hasAllClasses = requiredClasses.every(cls => elInfo.classes.includes(cls))
    if (!hasAllClasses) return false
  }
  
  // ID 选择器
  const idMatch = cssSelector.match(/#([a-zA-Z0-9_-]+)/)
  if (idMatch) {
    const requiredId = idMatch[1]
    if (elInfo.id !== requiredId) return false
  }
  
  // 标签选择器
  const tagMatch = cssSelector.match(/^([a-zA-Z][a-zA-Z0-9]*)/)
  if (tagMatch) {
    const requiredTag = tagMatch[1].toLowerCase()
    if (elInfo.tag !== requiredTag) {
      // 如果没有其他选择器（只有标签），则不匹配
      if (!classMatches && !idMatch) return false
    }
  }
  
  // 如果所有条件都满足，或者没有标签选择器但类/ID匹配，则匹配
  return true
}

// 匹配组合选择器（如 .slogan h3, .parent > .child）
function matchCombinedSelector(
  cssSelector: string, 
  elInfo: { tag: string; classes: string[]; id: string | null },
  parentInfo: Array<{ tag: string; classes: string[]; id: string | null }>
): boolean {
  // 分割选择器（支持空格和 >）
  const parts = cssSelector.split(/\s+|\s*>\s*/).filter(p => p.trim())
  
  if (parts.length < 2) return false
  
  // 最后一个部分应该匹配当前元素
  const lastPart = parts[parts.length - 1].trim()
  if (!matchElementSelector(lastPart, elInfo)) {
    return false
  }
  
  // 前面的部分应该匹配父元素
  // 从最近的父元素开始匹配
  for (let i = 0; i < parentInfo.length && i < parts.length - 1; i++) {
    const parentPart = parts[parts.length - 2 - i]
    if (matchElementSelector(parentPart, parentInfo[i])) {
      return true
    }
  }
  
  // 也检查所有父元素的组合
  // 例如：.slogan h3 应该匹配父元素有 slogan class 的情况
  for (let i = 0; i < parts.length - 1; i++) {
    const parentPart = parts[i]
    for (const parent of parentInfo) {
      if (matchElementSelector(parentPart, parent)) {
        return true
      }
    }
  }
  
  return false
}

// 获取上下文
function getContext(lines: string[], lineIndex: number, contextLines: number): string {
  const start = Math.max(0, lineIndex - contextLines)
  const end = Math.min(lines.length, lineIndex + contextLines + 1)
  return lines.slice(start, end).join('\n')
}
