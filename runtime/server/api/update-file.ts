import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { defineEventHandler, readBody, createError } from 'h3'

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
    const resolvedPath = file.startsWith('/') || file.match(/^[A-Z]:/)
      ? file
      : resolve(process.cwd(), file)

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
    const normalizedOriginal = originalContent.trim()
    const normalizedTarget = targetLine.trim()
    
    // 如果 searchHtml 为 true，需要处理 HTML 实体匹配
    // 创建匹配变体：原始内容、& 转为 &amp;、&amp; 转为 &
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
    
    // 方法1：直接匹配
    let matched = false
    for (const variant of matchVariants) {
      if (targetLine.includes(variant)) {
        updatedLine = targetLine.replace(variant, newContent)
        matched = true
        break
      }
    }
    
    // 方法2：在引号中匹配
    if (!matched) {
      const quoteMatches = targetLine.matchAll(/"([^"]*?)"/g)
      for (const match of quoteMatches) {
        const quotedContent = match[1]
        // 尝试所有变体
        for (const variant of matchVariants) {
          if (quotedContent.trim() === variant || quotedContent.trim().includes(variant)) {
            const beforeQuote = targetLine.substring(0, match.index! + 1)
            const afterQuote = targetLine.substring(match.index! + match[0].length - 1)
            updatedLine = beforeQuote + newContent + afterQuote
            matched = true
            break
          }
        }
        if (matched) break
      }
      
      // 方法3：在 HTML 标签中匹配
      if (!matched) {
        const tagMatches = targetLine.matchAll(/(>)([^<]+)(<)/g)
        for (const match of tagMatches) {
          const tagContent = match[2]
          // 尝试所有变体
          for (const variant of matchVariants) {
            if (tagContent.trim() === variant || tagContent.trim().includes(variant)) {
              const beforeTag = targetLine.substring(0, match.index! + 1)
              const afterTag = targetLine.substring(match.index! + match[0].length - 1)
              updatedLine = beforeTag + newContent + afterTag
              matched = true
              break
            }
          }
          if (matched) break
        }
      }
      
      // 方法4：模糊匹配（忽略空白字符）
      if (!matched) {
        const normalizedLine = targetLine.replace(/\s+/g, ' ')
        for (const variant of matchVariants) {
          const normalizedSearch = variant.replace(/\s+/g, ' ')
          if (normalizedLine.includes(normalizedSearch)) {
            const matchIndex = normalizedLine.indexOf(normalizedSearch)
            // 找到原始位置
            let charCount = 0
            let startIndex = 0
            for (let i = 0; i < targetLine.length; i++) {
              const normalizedChar = targetLine[i].replace(/\s+/g, ' ')
              if (normalizedChar) {
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
              const normalizedChar = targetLine[i].replace(/\s+/g, ' ')
              if (normalizedChar) {
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

