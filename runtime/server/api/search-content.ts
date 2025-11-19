import { readFile } from 'fs/promises'
import { join } from 'path'

interface Match {
  file: string
  line: number
  context: string
  originalContent: string
}

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const { content, sourceFiles } = body
    
    if (!content || !Array.isArray(sourceFiles)) {
      return []
    }
    
    const matches: Match[] = []
    
    // 处理内容变体，按替换前后空格、换行符生成不同的搜索模式
    const contentVariants = generateContentVariants(content)
    
    // 遍历所有源文件
    for (const filePath of sourceFiles) {
      try {
        const fullPath = join(process.cwd(), filePath)
        const fileContent = await readFile(fullPath, 'utf8')
        
        // 遍历内容变体
        for (const variant of contentVariants) {
          if (!variant) continue
          
          // 查找所有匹配项
          const regex = new RegExp(escapeRegExp(variant), 'g')
          let match
          
          while ((match = regex.exec(fileContent)) !== null) {
            // 获取匹配行号
            const lineNumber = fileContent.slice(0, match.index).split('\n').length
            
            // 生成上下文信息
            const contextLines = fileContent.split('\n').slice(
              Math.max(0, lineNumber - 2),
              lineNumber + 2
            )
            const context = contextLines.join('\n')
            
            // 保存匹配信息
            matches.push({
              file: filePath,
              line: lineNumber,
              context,
              originalContent: variant
            })
          }
        }
      } catch (error) {
        console.error(`读取文件 ${filePath} 失败:`, error)
        // 跳过读取失败的文件
      }
    }
    
    // 去重相同的匹配项
    const uniqueMatches = Array.from(new Map(matches.map(match => [JSON.stringify(match), match])).values())
    
    return uniqueMatches
  } catch (error) {
    console.error('搜索内容失败:', error)
    return []
  }
})

/**
 * 生成内容变体，替换空格和换行符
 * @param content 原始内容
 * @returns 内容变体数组
 */
function generateContentVariants(content: string): string[] {
  const variants: string[] = []
  
  // 原始内容
  variants.push(content)
  
  // 替换所有空格和换行符为单个空格
  variants.push(content.replace(/\s+/g, ' '))
  
  // 替换所有换行符为空格，保留单个空格
  variants.push(content.replace(/\n/g, ' '))
  
  // 移除所有空格和换行符
  variants.push(content.replace(/\s/g, ''))
  
  // 保留换行符，移除多余空格
  variants.push(content.replace(/\s+/g, ' ').replace(/ /g, ' '))
  
  // 移除前后空格
  variants.push(content.trim())
  
  // 移除前后空格并替换内部空格为单个空格
  variants.push(content.trim().replace(/\s+/g, ' '))
  
  // 去重
  return Array.from(new Set(variants))
}

/**
 * 转义正则表达式中的特殊字符
 * @param string 输入字符串
 * @returns 转义后的字符串
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}