import { readFileSync, writeFileSync } from 'fs'
import { defineEventHandler, readBody, createError } from 'h3'
import { resolveFilePath } from '../../utils/server-utils'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { file, selector, originalRules, newRules, line, isScoped } = body

  if (!file || !selector || originalRules === undefined || newRules === undefined) {
    throw createError({
      statusCode: 400,
      message: 'Invalid request parameters'
    })
  }

  try {
    // 解析文件路径
    const resolvedPath = resolveFilePath(file)

    // 读取文件
    let fileContent = readFileSync(resolvedPath, 'utf-8')
    
    // 检查是否是 Vue 文件
    const isVueFile = /\.(vue|jsx|tsx)$/i.test(resolvedPath) || fileContent.includes('<style')
    
    if (isVueFile) {
      // 更新 Vue 文件中的 <style> 标签
      fileContent = updateVueStyle(fileContent, selector, originalRules, newRules, isScoped)
    } else {
      // 更新纯 CSS 文件
      fileContent = updateCSSFile(fileContent, selector, originalRules, newRules, line)
    }

    // 写回文件
    writeFileSync(resolvedPath, fileContent, 'utf-8')

    return {
      success: true,
      message: 'CSS file updated successfully',
      path: resolvedPath
    }
  } catch (error: any) {
    if (error.statusCode) {
      throw error
    }
    throw createError({
      statusCode: 500,
      message: `Failed to update CSS file: ${error.message}`
    })
  }
})

// 更新 Vue 文件中的 <style> 标签
function updateVueStyle(
  content: string, 
  selector: string, 
  originalRules: string, 
  newRules: string,
  isScoped?: boolean
): string {
  const styleRegex = /<style(?:\s+scoped)?(?:\s+lang=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/style>/gi
  let styleMatch
  let lastIndex = 0
  let result = ''

  while ((styleMatch = styleRegex.exec(content)) !== null) {
    const styleIsScoped = styleMatch[0].includes('scoped')
    
    // 只更新匹配的 scoped 样式
    if (isScoped && !styleIsScoped) {
      result += content.substring(lastIndex, styleMatch.index + styleMatch[0].length)
      lastIndex = styleRegex.lastIndex
      continue
    }
    if (!isScoped && styleIsScoped) {
      result += content.substring(lastIndex, styleMatch.index + styleMatch[0].length)
      lastIndex = styleRegex.lastIndex
      continue
    }

    // 计算 style 标签在文件中的起始行号
    const beforeStyle = content.substring(0, styleMatch.index)
    const styleStartLine = beforeStyle.split('\n').length
    
    const styleContent = styleMatch[2]
    const updatedStyle = updateCSSContent(styleContent, selector, originalRules, newRules, styleStartLine)
    
    result += content.substring(lastIndex, styleMatch.index)
    result += styleMatch[0].replace(styleContent, updatedStyle)
    lastIndex = styleRegex.lastIndex
  }

  result += content.substring(lastIndex)
  return result
}

// 更新纯 CSS 文件
function updateCSSFile(
  content: string, 
  selector: string, 
  originalRules: string, 
  newRules: string,
  line?: number
): string {
  return updateCSSContent(content, selector, originalRules, newRules, line)
}

// 更新 CSS 内容
function updateCSSContent(
  content: string, 
  selector: string, 
  originalRules: string, 
  newRules: string,
  line?: number
): string {
  const normalizedOriginal = originalRules.trim()
  const normalizedNew = newRules.trim()

  // 方法1：直接匹配原始规则
  if (content.includes(normalizedOriginal)) {
    return content.replace(normalizedOriginal, normalizedNew)
  }

  // 方法2：通过选择器和行号定位
  if (line) {
    const lines = content.split('\n')
    const targetLineIndex = line - 1
    
    if (targetLineIndex >= 0 && targetLineIndex < lines.length) {
      const targetLine = lines[targetLineIndex]
      
      if (targetLine.includes(selector)) {
        // 查找规则块的开始和结束
        let ruleStart = targetLineIndex
        let ruleEnd = targetLineIndex
        let braceCount = 0
        let foundStart = false

        // 向前查找选择器行
        for (let i = targetLineIndex; i >= 0; i--) {
          if (lines[i].includes(selector) && lines[i].includes('{')) {
            ruleStart = i
            foundStart = true
            break
          }
        }

        if (foundStart) {
          // 向后查找规则块结束
          for (let i = ruleStart; i < lines.length; i++) {
            for (const char of lines[i]) {
              if (char === '{') braceCount++
              if (char === '}') braceCount--
            }
            if (braceCount === 0 && i > ruleStart) {
              ruleEnd = i
              break
            }
          }

          // 提取原始规则块
          const originalBlock = lines.slice(ruleStart, ruleEnd + 1).join('\n')
          
          // 替换
          if (originalBlock.includes(normalizedOriginal) || originalBlock.trim() === normalizedOriginal.trim()) {
            const beforeBlock = lines.slice(0, ruleStart).join('\n')
            const afterBlock = lines.slice(ruleEnd + 1).join('\n')
            return beforeBlock + (beforeBlock ? '\n' : '') + normalizedNew + (afterBlock ? '\n' : '') + afterBlock
          }
        }
      }
    }
  }

  // 方法3：模糊匹配
  const regex = new RegExp(escapeRegex(normalizedOriginal), 'g')
  if (regex.test(content)) {
    return content.replace(regex, normalizedNew)
  }

  throw createError({
    statusCode: 400,
    message: `CSS rules not found in file. Selector: "${selector}", Line: ${line || 'N/A'}`
  })
}

// 转义正则表达式特殊字符
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
