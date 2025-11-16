import { readFileSync } from 'fs'
import { resolve } from 'path'
import fastGlob from 'fast-glob'
import { defineEventHandler, readBody, createError } from 'h3'

// 展开通配符路径
async function expandGlobPattern(pattern: string): Promise<string[]> {
  // 检查是否包含通配符
  if (!pattern.includes('*') && !pattern.includes('?')) {
    // 没有通配符，直接返回原路径
    return [pattern]
  }

  try {
    // 使用 fast-glob 展开通配符
    // 如果路径是绝对路径，直接使用；否则相对于 cwd
    const matchedFiles = await fastGlob(pattern, {
      cwd: process.cwd(),
      absolute: true,
      onlyFiles: true,
      ignore: ['node_modules/**']
    })
    return matchedFiles.length > 0 ? matchedFiles : []
  } catch (error) {
    // 如果 glob 失败，返回空数组（不匹配任何文件）
    console.warn(`[Visual Editor] Glob pattern failed: ${pattern}`, error)
    return []
  }
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { content, files, searchHtml } = body

  if (!content || !files || !Array.isArray(files)) {
    throw createError({
      statusCode: 400,
      message: 'Invalid request'
    })
  }

  const searchHtmlMode = searchHtml === true

  const matches: Array<{
    file: string
    line: number
    context: string
    originalContent: string
  }> = []

  // 展开所有文件路径（包括通配符）
  const expandedFiles: string[] = []
  for (const filePath of files) {
    const expanded = await expandGlobPattern(filePath)
    expandedFiles.push(...expanded)
  }

  for (const filePath of expandedFiles) {
    try {
      // 解析文件路径（支持绝对路径和相对路径）
      const resolvedPath = filePath.startsWith('/') || filePath.match(/^[A-Z]:/)
        ? filePath
        : resolve(process.cwd(), filePath)

      const fileContent = readFileSync(resolvedPath, 'utf-8')
      const lines = fileContent.split('\n')

      // 搜索匹配的内容
      const searchContent = content.trim()
      
      // 按行搜索
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const lineNumber = i + 1

        // 如果 searchHtml 为 true，搜索包含 HTML 的内容
        // 如果 searchHtml 为 false，只搜索纯文本（如果行中包含 HTML 标签则跳过）
        let shouldMatch = false
        
        if (searchHtmlMode) {
          // 搜索 HTML 内容，保留 HTML 标签
          // 将换行符转换为 <br> 进行匹配
          const normalizedLine = line.replace(/\n/g, '<br>')
          
          // 处理 HTML 实体：同时匹配转义和未转义的版本
          // 例如：& 和 &amp; 都应该匹配
          const searchVariants = new Set<string>()
          searchVariants.add(searchContent) // 原始搜索内容
          
          // 如果包含 &amp;，添加未转义版本（&）
          if (searchContent.includes('&amp;')) {
            searchVariants.add(searchContent.replace(/&amp;/g, '&'))
          }
          
          // 如果包含独立的 &（不是 &amp; 的一部分），添加转义版本（&amp;）
          // 使用负向前瞻和回顾，确保 & 不是实体的一部分
          if (searchContent.match(/(?<!&)(&)(?![a-zA-Z#0-9])/)) {
            searchVariants.add(searchContent.replace(/(?<!&)(&)(?![a-zA-Z#0-9])/g, '&amp;'))
          }
          
          shouldMatch = Array.from(searchVariants).some(variant => normalizedLine.includes(variant))
        } else {
          // 只搜索纯文本
          // 更智能地检测真正的HTML标签，而不是简单跳过包含<>的行
          // 提取行中的纯文本内容（去除可能的HTML标签）
          let textOnly = line
          
          // 如果行看起来包含HTML标签，尝试提取纯文本
          if (line.includes('<') && line.includes('>')) {
            // 尝试从引号中提取文本内容（可能是模板字符串中的文本）
            const quoteMatch = line.match(/'([^']*?)'/g) || line.match(/"([^"]*?)"/g)
            if (quoteMatch) {
              for (const quoted of quoteMatch) {
                const quotedContent = quoted.slice(1, -1) // 移除引号
                const normalizedQuoted = quotedContent.replace(/[\s\u00a0]+/g, ' ').trim()
                const normalizedSearch = searchContent.replace(/[\s\u00a0]+/g, ' ').trim()
                if (normalizedQuoted.includes(normalizedSearch)) {
                  shouldMatch = true
                  // 尝试从引号中提取原始内容
                  originalContent = quotedContent
                  break
                }
              }
            }
          }
          
          // 如果没有在引号中找到，执行普通的文本搜索
          if (!shouldMatch) {
            const normalizedLine = line.replace(/[\s\u00a0]+/g, ' ').trim()
            const normalizedContent = searchContent.replace(/[\s\u00a0]+/g, ' ').trim()
            shouldMatch = normalizedLine.includes(normalizedContent)
          }
        }
        
        if (shouldMatch) {
          // 提取上下文（前后各5行，便于用户识别）
          const start = Math.max(0, i - 5)
          const end = Math.min(lines.length, i + 6)
          const context = lines.slice(start, end).join('\n')

          // 尝试提取原始内容（使用文件中实际的内容）
          let originalContent = searchContent
          
          // 尝试从引号中提取
          const quoteMatch = line.match(/"([^"]*?)"/g)
          if (quoteMatch) {
            for (const quoted of quoteMatch) {
              const quotedContent = quoted.slice(1, -1) // 移除引号
              // 检查是否包含搜索内容（考虑 HTML 实体变体）
              const normalizedQuoted = quotedContent.replace(/[\s\u00a0]+/g, ' ').trim()
              const normalizedSearch = searchContent.replace(/[\s\u00a0]+/g, ' ').trim()
              
              // 同时检查转义和未转义的版本
              if (normalizedQuoted.includes(normalizedSearch) || 
                  normalizedQuoted.includes(normalizedSearch.replace(/&amp;/g, '&')) ||
                  normalizedQuoted.includes(normalizedSearch.replace(/&/g, '&amp;'))) {
                // 使用文件中实际的内容（未转义的）
                originalContent = normalizedQuoted
                break
              }
            }
          }
          
          // 尝试从 HTML 标签中提取
          if (originalContent === searchContent) {
            const tagMatch = line.match(/>([^<]+)</)
            if (tagMatch) {
              const tagContent = tagMatch[1].trim()
              const normalizedSearch = searchContent.trim()
              if (tagContent.includes(normalizedSearch) || 
                  tagContent.includes(normalizedSearch.replace(/&amp;/g, '&')) ||
                  tagContent.includes(normalizedSearch.replace(/&/g, '&amp;'))) {
                originalContent = tagContent
              }
            }
          }
          
          // 如果 searchHtml 为 true，确保 originalContent 使用文件中实际的格式
          // 文件中的 & 应该保持为 &，而不是 &amp;
          if (searchHtmlMode && originalContent.includes('&amp;')) {
            // 检查文件中是否实际使用的是 &（未转义）
            // 如果行中包含 & 而不是 &amp;，使用 & 版本
            if (line.includes('&') && !line.includes('&amp;')) {
              originalContent = originalContent.replace(/&amp;/g, '&')
            }
          }

          matches.push({
            file: filePath,
            line: lineNumber,
            context: context.trim(),
            originalContent: originalContent.trim()
          })
        }
      }
    } catch (error: any) {
      // 如果是文件不存在错误，静默跳过（可能是通配符匹配到的路径不存在）
      if (error.code !== 'ENOENT') {
        console.error(`[Visual Editor] Error reading file ${filePath}:`, error.message)
      }
      // 继续处理其他文件
    }
  }

  return {
    matches
  }
})

