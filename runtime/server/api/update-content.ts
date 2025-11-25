import { defineEventHandler, readBody } from 'h3'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { resolve, isAbsolute } from 'path'

export default defineEventHandler(async (event) => {
  try {
    // 读取请求体
    const body = await readBody(event)
    const { files, content: { old: oldContent, new: newContent } = {} } = body
    
    // 参数验证
    if (!Array.isArray(files) || files.length === 0) {
      console.log('[update-content] 错误: 未提供文件')
      return { success: false, error: 'No files provided' }
    }
    if (typeof oldContent !== 'string' || typeof newContent !== 'string') {
      console.log('[update-content] 错误: 内容格式无效')
      return { success: false, error: 'Invalid content format' }
    }

    // 处理每个文件
    const updatedFiles = []
    for (const filePath of files) {
      try {
        // 解析文件路径
        const resolvedPath = isAbsolute(filePath) 
          ? filePath 
          : resolve(process.cwd(), filePath)
        
        console.log(`[update-content] 处理文件: ${filePath}`)
        
        // 检查文件是否存在
        if (!existsSync(resolvedPath)) {
          console.error(`[update-content] 错误: 文件不存在 ${resolvedPath}`)
          continue
        }
        
        // 读取文件内容
        const fileContent = readFileSync(resolvedPath, 'utf8')
        
        // 增强的内容替换逻辑，避免错误替换HTML标签
        let updatedContent = fileContent
        
        // 检查是否存在HTML标签
        if (containsHtmlTags(oldContent) && containsHtmlTags(newContent)) {
          // 当旧内容和新内容都包含HTML标签时，尝试更精确地匹配
          // 提取标签结构和文本内容进行匹配
          const oldTagContent = extractTagContent(oldContent)
          const newTagContent = extractTagContent(newContent)
          
          if (oldTagContent && newTagContent) {
            // 尝试匹配标签结构并替换内容
            updatedContent = replaceTagContent(fileContent, oldTagContent, newTagContent)
          } else {
            // 如果无法提取标签内容，使用宽松的匹配方式
            updatedContent = fileContent.replace(new RegExp(escapeRegex(oldContent), 'g'), newContent)
          }
        } else {
          // 普通文本内容，使用更安全的替换方式
          updatedContent = fileContent.replace(new RegExp(escapeRegex(oldContent), 'g'), newContent)
        }
        
        // 如果内容有变化则写入文件
        if (updatedContent !== fileContent) {
          writeFileSync(resolvedPath, updatedContent, 'utf8')
          updatedFiles.push(filePath)
          console.log(`[update-content] 文件更新成功: ${filePath}`)
        } else {
          console.log(`[update-content] 文件内容未变化: ${filePath}`)
        }
      } catch (error) {
        console.error(`更新文件 ${filePath} 时出错:`, error)
        // 继续处理其他文件
      }
    }

    return { success: true, updatedFiles }
  } catch (error) {
    console.error('update-content API 错误:', error)
    return { success: false, error: error.message || 'Failed to update content' }
  }
})

/**
 * 检查字符串是否包含HTML标签
 */
function containsHtmlTags(str: string): boolean {
  return /<[^>]*>/i.test(str)
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 提取HTML标签内容结构
 */
interface TagContent {
  fullTag: string
  tagName: string
  attributes: string
  innerHtml: string
}

function extractTagContent(html: string): TagContent | null {
  // 尝试匹配常见的HTML标签格式
  const match = html.match(/<(\w+)([^>]*)>([\s\S]*?)<\/\1>/i)
  if (!match) return null
  
  return {
    fullTag: match[0],
    tagName: match[1].toLowerCase(),
    attributes: match[2],
    innerHtml: match[3]
  }
}

/**
 * 替换HTML标签内容而保持标签结构
 */
function replaceTagContent(fileContent: string, oldTag: TagContent, newTag: TagContent): string {
  // 创建正则表达式匹配旧标签内容
  const tagRegex = new RegExp(
    `<${oldTag.tagName}${escapeRegex(oldTag.attributes)}>[
\s]*${escapeRegex(oldTag.innerHtml)}[
\s]*<\\/${oldTag.tagName}>`, 
    'gi'
  )
  
  // 保持原有标签名和属性，只替换内部内容
  const replacement = `<${oldTag.tagName}${oldTag.attributes}>${newTag.innerHtml}</${oldTag.tagName}>`
  
  return fileContent.replace(tagRegex, replacement)
}