import { readFileSync } from 'fs'

import { defineEventHandler, readBody, createError } from 'h3'
import { resolveFilePath, expandGlobPattern, enhancedTrim, normalizeWhitespace } from '../../utils/server-utils'

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
      const resolvedPath = resolveFilePath(filePath)

      const fileContent = readFileSync(resolvedPath, 'utf-8')
      const lines = fileContent.split('\n')

      // 搜索匹配的内容，使用标准化空白字符函数处理
  const searchContent = normalizeWhitespace(content)
      
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
          // 如果行中包含 HTML 标签，跳过这一行
          if (line.includes('<') && line.includes('>')) {
            continue // 跳过包含 HTML 标签的行
          }
          // 只搜索纯文本内容，使用标准化空白字符函数
          const trimmedLine = normalizeWhitespace(line)
          const trimmedContent = normalizeWhitespace(searchContent)
          shouldMatch = trimmedLine.includes(trimmedContent)
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
              const normalizedQuoted = normalizeWhitespace(quotedContent)
              const normalizedSearch = normalizeWhitespace(searchContent)
              
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
              const tagContent = normalizeWhitespace(tagMatch[1])
              const normalizedSearch = normalizeWhitespace(searchContent)
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
            context: enhancedTrim(context),
            originalContent: normalizeWhitespace(originalContent)
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

