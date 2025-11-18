import { readFileSync } from 'fs'
import { resolve } from 'path'
import fastGlob from 'fast-glob'
import { defineEventHandler, readBody, createError } from 'h3'

// 用于收集服务器端日志信息
interface ServerLog {
  type: 'log' | 'warn' | 'error'
  message: string
  data?: any
}

/**
 * 展开通配符路径，将包含通配符的路径转换为匹配的具体文件路径列表
 * @param pattern 文件路径模式，可能包含通配符
 * @param logs 日志收集数组，用于记录处理过程
 * @returns 匹配的文件路径数组
 */
async function expandGlobPattern(pattern: string, logs: ServerLog[]): Promise<string[]> {
  // 检查是否包含通配符
  if (!pattern.includes('*') && !pattern.includes('?')) {
    // 没有通配符，直接返回原路径
    logs.push({
      type: 'log',
      message: '【没有通配符，直接返回原路径】',
      data: pattern
    })
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
    logs.push({
      type: 'log',
      message: '【matchedFiles】',
      data: matchedFiles
    })
    return matchedFiles.length > 0 ? matchedFiles : []
  } catch (error) {
    // 如果 glob 失败，返回空数组（不匹配任何文件）
    logs.push({
      type: 'warn',
      message: `[Visual Editor] Glob pattern failed: ${pattern}`,
      data: error
    })
    return []
  }
}

/**
 * API事件处理函数，处理内容搜索请求
 * @param event H3事件对象，包含请求信息
 * @returns 包含匹配结果和服务器日志的响应对象
 */
export default defineEventHandler(async (event) => {
  // 创建日志数组
  const logs: ServerLog[] = []
  
  logs.push({
    type: 'log',
    message: '【event】',
    data: event
  })
  
  const body = await readBody(event)
  const { content, files } = body

  if (!content || !files || !Array.isArray(files)) {
    throw createError({
      statusCode: 400,
      message: 'Invalid request'
    })
  }

  // 默认使用HTML搜索模式

  const matches: Array<{
    file: string
    line: number
    context: string
    originalContent: string
  }> = []

  // 展开所有文件路径（包括通配符）
  const expandedFiles: string[] = []
  for (const filePath of files) {
    const expanded = await expandGlobPattern(filePath, logs)
    expandedFiles.push(...expanded)
  }

  logs.push({
    type: 'log',
    message: '【expandedFiles】',
    data: expandedFiles
  })
  
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
      logs.push({
        type: 'log',
        message: '【searchContent】',
        data: searchContent
      })
      // 按行搜索
      for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          const lineNumber = i + 1

          // 默认搜索HTML内容，保留HTML标签
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
          
          // 检查是否匹配任何变体
          const shouldMatch = Array.from(searchVariants).some(variant => normalizedLine.includes(variant))
          
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
          
          // 确保 originalContent 使用文件中实际的格式
          // 文件中的 & 应该保持为 &，而不是 &amp;
          if (originalContent.includes('&amp;')) {
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
        logs.push({
          type: 'error',
          message: `[Visual Editor] Error reading file ${filePath}:`,
          data: error.message
        })
      }
      // 继续处理其他文件
    }
  }

  // 检查是否有错误日志
  const errorLogs = logs.filter(log => log.type === 'error')
  const errMsg = errorLogs.length > 0 ? errorLogs[0].message : ''
  
  return {
    matches,
    serverLogs: logs,
    errMsg: errMsg // 增加errMsg字段，包含中文错误消息
  }
})

