import { readFileSync, writeFileSync } from 'fs'
import { defineEventHandler, readBody, createError } from 'h3'
import { resolveFilePath, enhancedTrim, normalizeWhitespace } from '../../utils/server-utils'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { file, line, originalContent, newContent, searchHtml } = body

  if (!file || !line || originalContent === undefined || newContent === undefined) {
    throw createError({
      statusCode: 400,
      message: 'Invalid request parameters'
    })
  }

  const searchHtmlMode = searchHtml === true

  try {
    // 解析文件路径
    const resolvedPath = resolveFilePath(file)

    // 读取文件
    const fileContent = readFileSync(resolvedPath, 'utf-8')
    const lines = fileContent.split('\n')

    // 检查行号是否有效
    if (line < 1 || line > lines.length) {
      throw createError({
        statusCode: 400,
        message: `Invalid line number: ${line}`
      })
    }

    // 获取目标行（索引从0开始）
    const targetLineIndex = line - 1
    const targetLine = lines[targetLineIndex]

    // 替换内容
    let updatedLine = targetLine
    // 使用空白标准化函数进行比较
    const normalizedOriginal = normalizeWhitespace(originalContent)
    const normalizedTarget = normalizeWhitespace(targetLine)
    
    // 如果 searchHtml 为 true，需要处理 HTML 实体匹配
    // 创建匹配变体：原始内容、& 转为 &amp;、&amp; 转为 &
    // 注意：这里使用标准化后的内容作为基准变体
    const matchVariants: string[] = [normalizedOriginal]
    if (searchHtmlMode) {
      if (normalizedOriginal.includes('&amp;')) {
        matchVariants.push(normalizedOriginal.replace(/&amp;/g, '&'))
      }
      if (normalizedOriginal.includes('&') && !normalizedOriginal.includes('&amp;')) {
        // 只转义独立的 &，不转义已经是实体的部分
        matchVariants.push(normalizedOriginal.replace(/(?<!&)(&)(?![a-zA-Z#0-9])/g, '&amp;'))
      }
    }
    
    // 初始化匹配状态
    let matched = false
    
    // 如果是HTML搜索模式，优先检查HTML标签内容
    if (searchHtmlMode && !matched) {
      // 方法3：在 HTML 标签中匹配（改进空格处理）
      const tagMatches = targetLine.matchAll(/(<[^>]+>)([^<]+)(<\/[^>]+>)/g)
      for (const match of tagMatches) {
        const fullTag = match[0]    // 完整标签，如 <p>内容</p>
        const openTag = match[1]    // 开始标签，如 <p>
        const tagContent = match[2] // 标签内的内容
        const closeTag = match[3]   // 结束标签，如 </p>
        const trimmedTagContent = normalizeWhitespace(tagContent)
          
        // 尝试使用标准化的内容进行匹配
        if (trimmedTagContent === normalizedOriginal || trimmedTagContent.includes(normalizedOriginal)) {
          // 只替换标签内的内容，保留完整的标签结构
          const replacement = openTag + newContent + closeTag
          updatedLine = targetLine.replace(fullTag, replacement)
          matched = true
          break
        }
        
        // 如果标准化匹配失败，尝试所有变体
        for (const variant of matchVariants) {
          if (trimmedTagContent === variant || trimmedTagContent.includes(variant)) {
            // 只替换标签内的内容，保留完整的标签结构
            const replacement = openTag + newContent + closeTag
            updatedLine = targetLine.replace(fullTag, replacement)
            matched = true
            break
          }
        }
        if (matched) break
      }
    }
    
    // 方法2：在引号中匹配（改进空格处理）
    if (!matched) {
      const quoteMatches = targetLine.matchAll(/"([^"]*?)"/g)
      for (const match of quoteMatches) {
        const quotedContent = match[1]
            const trimmedQuoted = normalizeWhitespace(quotedContent)
            
            // 尝试使用标准化的内容进行匹配
            if (trimmedQuoted === normalizedOriginal || trimmedQuoted.includes(normalizedOriginal)) {
          const beforeQuote = targetLine.substring(0, match.index! + 1)
          const afterQuote = targetLine.substring(match.index! + match[0].length - 1)
          updatedLine = beforeQuote + newContent + afterQuote
          matched = true
          break
        }
        
        // 如果标准化匹配失败，尝试所有变体
        for (const variant of matchVariants) {
          if (trimmedQuoted === variant || trimmedQuoted.includes(variant)) {
            const beforeQuote = targetLine.substring(0, match.index! + 1)
            const afterQuote = targetLine.substring(match.index! + match[0].length - 1)
            updatedLine = beforeQuote + newContent + afterQuote
            matched = true
            break
          }
        }
        if (matched) break
      }
    }
    
    // 方法1：使用标准化空白后的内容直接匹配
    if (!matched && normalizedTarget.includes(normalizedOriginal)) {
      // 找到标准化内容在原始行中的位置
      const normalizedSearch = normalizedOriginal
      const normalizedLine = normalizeWhitespace(targetLine)
      const matchIndex = normalizedLine.indexOf(normalizedSearch)
      
      // 找到原始行中对应的实际位置
      let charCount = 0
      let startIndex = 0
      for (let i = 0; i < targetLine.length; i++) {
        // 匹配标准空格和非断行空格
          if (!/[\s\u00a0]/.test(targetLine[i])) {
          if (charCount === matchIndex) {
            // 找到开始位置后，往回搜索真正的开始点（可能包含前面的空白）
            while (startIndex > 0 && /\s/.test(targetLine[startIndex - 1])) {
              startIndex--
            }
            break
          }
          charCount++
        } else if (charCount === 0) {
          // 记录前导空白的结束位置，支持非断行空格
          startIndex = i + 1
        }
      }
      
      // 找到结束位置
      let endIndex = targetLine.length
      charCount = 0
      for (let i = targetLine.length - 1; i >= 0; i--) {
        // 匹配标准空格和非断行空格
          if (!/[\s\u00a0]/.test(targetLine[i])) {
          if (charCount === normalizedSearch.length - 1) {
            // 找到结束位置后，往后搜索真正的结束点（可能包含后面的空白）
            while (endIndex < targetLine.length && /\s/.test(targetLine[endIndex])) {
              endIndex++
            }
            break
          }
          charCount++
        } else if (charCount === 0) {
          // 记录尾随空白的开始位置，支持非断行空格
          endIndex = i
        }
      }
      
      updatedLine = targetLine.substring(0, startIndex) + newContent + targetLine.substring(endIndex)
      matched = true
    }
    
    // 如果标准化匹配失败，尝试原始匹配变体
    if (!matched) {
      for (const variant of matchVariants) {
        if (targetLine.includes(variant)) {
          updatedLine = targetLine.replace(variant, newContent)
          matched = true
          break
        }
      }
    }
    
    // 方法2：在引号中匹配（改进空格处理）
    if (!matched) {
      const quoteMatches = targetLine.matchAll(/"([^"]*?)"/g)
      for (const match of quoteMatches) {
        const quotedContent = match[1]
            const trimmedQuoted = normalizeWhitespace(quotedContent)
            
            // 尝试使用标准化的内容进行匹配
            if (trimmedQuoted === normalizedOriginal || trimmedQuoted.includes(normalizedOriginal)) {
          const beforeQuote = targetLine.substring(0, match.index! + 1)
          const afterQuote = targetLine.substring(match.index! + match[0].length - 1)
          updatedLine = beforeQuote + newContent + afterQuote
          matched = true
          break
        }
        
        // 如果标准化匹配失败，尝试所有变体
        for (const variant of matchVariants) {
          if (trimmedQuoted === variant || trimmedQuoted.includes(variant)) {
            const beforeQuote = targetLine.substring(0, match.index! + 1)
            const afterQuote = targetLine.substring(match.index! + match[0].length - 1)
            updatedLine = beforeQuote + newContent + afterQuote
            matched = true
            break
          }
        }
        if (matched) break
      }
      
      // 对于非HTML搜索模式，也提供HTML标签匹配支持，但作为备选方案
      if (!matched) {
        const tagMatches = targetLine.matchAll(/(<[^>]+>)([^<]+)(<\/[^>]+>)/g)
        for (const match of tagMatches) {
          const fullTag = match[0]    // 完整标签，如 <p>内容</p>
          const openTag = match[1]    // 开始标签，如 <p>
          const tagContent = match[2] // 标签内的内容
          const closeTag = match[3]   // 结束标签，如 </p>
          const trimmedTagContent = normalizeWhitespace(tagContent)
            
          // 尝试使用标准化的内容进行匹配
          if (trimmedTagContent === normalizedOriginal || trimmedTagContent.includes(normalizedOriginal)) {
            // 只替换标签内的内容，保留完整的标签结构
            const replacement = openTag + newContent + closeTag
            updatedLine = targetLine.replace(fullTag, replacement)
            matched = true
            break
          }
          
          // 如果标准化匹配失败，尝试所有变体
          for (const variant of matchVariants) {
            if (trimmedTagContent === variant || trimmedTagContent.includes(variant)) {
              // 只替换标签内的内容，保留完整的标签结构
              const replacement = openTag + newContent + closeTag
              updatedLine = targetLine.replace(fullTag, replacement)
              matched = true
              break
            }
          }
          if (matched) break
        }
      }
      
      // 方法4：模糊匹配（忽略空白字符）
      if (!matched) {
        // 使用空白标准化函数
          const normalizedLine = normalizeWhitespace(targetLine)
        for (const variant of matchVariants) {
          // 使用空白标准化函数
            const normalizedSearch = normalizeWhitespace(variant)
          if (normalizedLine.includes(normalizedSearch)) {
            const matchIndex = normalizedLine.indexOf(normalizedSearch)
            // 找到原始位置
            let charCount = 0
            let startIndex = 0
            for (let i = 0; i < targetLine.length; i++) {
              // 直接检查字符是否是非空白字符
              if (!/[\s\u00a0]/.test(targetLine[i])) {
                if (charCount === matchIndex) {
                  startIndex = i
                  break
                }
                charCount++
              }
            }
            
            // 找到结束位置
            let endIndex = startIndex
            let contentLength = 0
            for (let i = startIndex; i < targetLine.length && contentLength < normalizedSearch.length; i++) {
              // 直接检查字符是否是非空白字符
              if (!/[\s\u00a0]/.test(targetLine[i])) {
                contentLength++
                endIndex = i + 1
              } else {
                endIndex = i + 1
              }
            }
            
            updatedLine = targetLine.substring(0, startIndex) + newContent + targetLine.substring(endIndex)
            matched = true
            break
          }
        }
      }
    }
    
    if (!matched) {
      throw createError({
        statusCode: 400,
        message: `Content not found in line ${line}. Original: "${normalizedOriginal}", Line: "${normalizedTarget}"`
      })
    }

    // 更新行
    lines[targetLineIndex] = updatedLine

    // 写回文件
    const updatedContent = lines.join('\n')
    writeFileSync(resolvedPath, updatedContent, 'utf-8')

    return {
      success: true,
      message: 'File updated successfully',
      path: resolvedPath
    }
  } catch (error: any) {
    if (error.statusCode) {
      throw error
    }
    throw createError({
      statusCode: 500,
      message: `Failed to update file: ${error.message}`
    })
  }
})

