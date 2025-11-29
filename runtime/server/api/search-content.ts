import { readFile } from 'fs/promises'
import { join, extname } from 'path'
import { defineEventHandler, readBody } from 'h3'

/**
 * 检查文件是否为HTML或Vue文件
 */
function isHtmlOrVueFile(filePath: string): boolean {
  const extension = extname(filePath).toLowerCase()
  return extension === '.html' || extension === '.vue' || extension === '.htm'
}

interface ContentMatch {
  file: string
  line: number
  context: string
  originalContent: string
  matchType: 'id' | 'dom' | 'variant'
  confidence: number
}

interface SearchContentRequest {
  content: string
  files?: string[]
  sourceFiles?: string[]
  elementId?: string
  domPath?: string
}

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody<SearchContentRequest>(event)
    // 支持两种参数名: files(前端发送的) 和 sourceFiles(保持兼容)
    const { content, files, sourceFiles, elementId, domPath } = body
    const targetFiles = files || sourceFiles

    if (!content || !Array.isArray(targetFiles)) {
      return { matches: [] }
    }

    // 存储不同匹配策略的结果
    const idMatches: ContentMatch[] = []
    const domMatches: ContentMatch[] = []
    const variantMatches: ContentMatch[] = []

    // 遍历所有源文件
    for (const filePath of targetFiles) {
      try {
        const fullPath = join(process.cwd(), filePath)
        const fileContent = await readFile(fullPath, 'utf8')
        const isHtmlVueFile = isHtmlOrVueFile(filePath)

        // 1. ID快速匹配（最高优先级）- 仅对HTML和Vue文件执行
        if (elementId && isHtmlVueFile) {
          const idMatchesInFile = findIdMatches(filePath, fileContent, elementId, content)          
          // 如果找到了ID匹配，跳过当前文件的其他匹配策略
          if (idMatchesInFile.length > 0) {
            idMatches.push(...idMatchesInFile)
            continue
          }
        }

        // 2. DOM结构匹配（次优先级）- 仅对HTML和Vue文件执行
        if (domPath && isHtmlVueFile) {
          const domMatchesInFile = findDomStructureMatches(filePath, fileContent, domPath, content)          
          // 如果找到了DOM匹配，跳过当前文件的内容变体匹配
          if (domMatchesInFile.length > 0) {
            domMatches.push(...domMatchesInFile)
            continue
          }
        }

        // 3. 内容变体匹配（兜底策略）
        const variants = generateContentVariants(content)
        const variantMatchesInFile = findVariantMatches(filePath, fileContent, variants, content)
        variantMatches.push(...variantMatchesInFile)
      } catch (error) {
        console.error(`读取文件 ${filePath} 失败:`, error)
        // 跳过读取失败的文件
      }
    }

    // 按优先级合并结果
    let allMatches: ContentMatch[] = []
    
    // 1. 添加ID匹配结果（最高优先级）
    if (idMatches.length > 0) {
      allMatches = [...idMatches]
    }
    // 2. 添加DOM结构匹配结果（次优先级）
    else if (domMatches.length > 0) {
      allMatches = [...domMatches]
    }
    // 3. 添加内容变体匹配结果（兜底）
    else {
      allMatches = [...variantMatches]
    }

    // 去重相同的匹配项 - 增强去重逻辑确保完全去重
    const uniqueMatches = Array.from(new Map(allMatches.map(match => 
      // 使用文件路径、行号、和匹配类型的组合作为唯一键
      [`${match.file}:${match.line}:${match.matchType}`, match]
    )).values())

    return { matches: uniqueMatches }
  } catch (error) {
    console.error('搜索内容失败:', error)
    return { matches: [] }
  }
})

/**
 * 1. ID快速匹配 - 最高优先级
 */
function findIdMatches(filePath: string, fileContent: string, elementId: string, originalContent: string): ContentMatch[] {
  const matches: ContentMatch[] = []
  // 移除全局g标志，因为在HTML中ID应该是唯一的，找到一个匹配就足够了
  const idPattern = new RegExp(`id=["']${escapeRegExp(elementId)}["']`)
  
  // 使用非全局正则表达式，只查找第一个匹配项
  const idMatch = idPattern.exec(fileContent)
  if (idMatch) {
    // 首先找到ID元素的位置
    const idIndex = idMatch.index
    
    // 找到ID元素所在行
    const linesBeforeId = fileContent.slice(0, idIndex).split('\n')
    const idLineNumber = linesBeforeId.length
    
    // 计算ID元素后的内容范围，向前看5行，向后看50行，避免查找范围过大
    const searchStartIndex = Math.max(0, idIndex - 500)
    const searchEndIndex = Math.min(fileContent.length, idIndex + 5000)
    const relevantContent = fileContent.slice(searchStartIndex, searchEndIndex)
    
    // 在相关内容中查找原始内容
    const contentMatchIndex = relevantContent.indexOf(originalContent)
    
    if (contentMatchIndex !== -1) {
      // 计算内容实际所在行号
      const actualContentIndex = searchStartIndex + contentMatchIndex
      const linesBeforeContent = fileContent.slice(0, actualContentIndex).split('\n')
      const contentLineNumber = linesBeforeContent.length
      
      // 使用内容行号而不是ID行号
      const lineNumber = contentLineNumber
      const context = getContext(fileContent, lineNumber)
      
      matches.push({
        file: filePath,
        line: lineNumber,
        context,
        originalContent,
        matchType: 'id',
        confidence: 1.0
      })
    } else {
      // 如果找不到精确内容，回退到使用ID所在行号
      const context = getContext(fileContent, idLineNumber)
      matches.push({
        file: filePath,
        line: idLineNumber,
        context,
        originalContent,
        matchType: 'id',
        confidence: 0.9 // 降低置信度，因为是回退方案
      })
    }
  }
  
  return matches
}

/**
 * 2. DOM结构匹配 - 次优先级
 */
function findDomStructureMatches(filePath: string, fileContent: string, domPath: string, originalContent: string): ContentMatch[] {
  const matches: ContentMatch[] = []
  
  // 简化的DOM路径匹配，匹配标签层次结构
  const pathSegments = domPath.split(' > ')
  const simplifiedPath = pathSegments.map(segment => {
    // 提取标签名，忽略类和ID
    const tagMatch = segment.match(/^([a-zA-Z][a-zA-Z0-9]*)/)
    return tagMatch ? tagMatch[1] : segment
  }).join('.*?')
  
  // 构建正则表达式匹配DOM结构
  const domRegex = new RegExp(`<${simplifiedPath}.*?>.*?<\\/.*?>`, 'sgi')
  
  let match
  while ((match = domRegex.exec(fileContent)) !== null) {
    const matchedContent = match[0]
    const lineNumber = fileContent.slice(0, match.index).split('\n').length
    
    // 如果匹配的DOM结构包含目标内容，则认为是有效匹配
    if (matchedContent.includes(originalContent)) {
      const context = getContext(fileContent, lineNumber)
      matches.push({
        file: filePath,
        line: lineNumber,
        context,
        originalContent,
        matchType: 'dom',
        confidence: 0.8
      })
    }
  }
  
  return matches
}

/**
 * 3. 内容变体匹配 - 兜底策略
 */
function findVariantMatches(filePath: string, fileContent: string, variants: string[], originalContent: string): ContentMatch[] {
  const matches: ContentMatch[] = []
  
  // 对每个变体进行匹配
  variants.forEach((variant, index) => {
    const variantRegex = new RegExp(escapeRegExp(variant), 'g')
    let match
    
    while ((match = variantRegex.exec(fileContent)) !== null) {
      const lineNumber = fileContent.slice(0, match.index).split('\n').length
      const context = getContext(fileContent, lineNumber)
      
      // 计算置信度，原始内容匹配置信度最高
      const confidence = index === 0 ? 0.9 : Math.max(0.3, 0.7 - index * 0.1)
      
      matches.push({
        file: filePath,
        line: lineNumber,
        context,
        originalContent: variant,
        matchType: 'variant',
        confidence
      })
    }
  })
  
  return matches
}

/**
 * 生成内容变体
 */
function generateContentVariants(content: string): string[] {
  const variants: string[] = []
  
  // // 变体1: 原始内容
  // variants.push(content)
  
  // // 变体2: 移除多余空白字符
  // variants.push(content.replace(/\s+/g, ' ').trim())
  
  // // 变体3: 转小写并移除空白
  // variants.push(content.toLowerCase().replace(/\s+/g, ''))
  
  // // 变体4: 仅保留字母数字字符
  // variants.push(content.replace(/[^a-zA-Z0-9]/g, ''))
  
  // // 变体5: 移除HTML标签后的纯文本
  // variants.push(content.replace(/<[^>]*>/g, '').trim())
  
  // return [...new Set(variants)] // 去重


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
 * 获取上下文信息
 */
function getContext(fileContent: string, lineNumber: number): string {
  const lines = fileContent.split('\n')
  const contextLines = lines.slice(
    Math.max(0, lineNumber - 2),
    lineNumber + 2
  )
  return contextLines.join('\n')
}

/**
 * 获取匹配位置周围的内容
 */
function getSurroundingContent(fileContent: string, index: number, radius: number): string {
  const start = Math.max(0, index - radius)
  const end = Math.min(fileContent.length, index + radius)
  return fileContent.substring(start, end)
}

/**
 * 转义正则表达式中的特殊字符
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}