import { readFile } from 'fs/promises'
import { join } from 'path'
import { defineEventHandler, readBody } from 'h3'

interface Match {
  file: string
  line: number
  context: string
  originalContent: string
}

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const { selector, sourceFiles } = body
    
    if (!selector || !Array.isArray(sourceFiles)) {
      return []
    }
    
    const matches: Match[] = []
    
    // 生成CSS选择器变体
    const selectorVariants = generateSelectorVariants(selector)
    
    // 遍历所有源文件
    for (const filePath of sourceFiles) {
      try {
        const fullPath = join(process.cwd(), filePath)
        const fileContent = await readFile(fullPath, 'utf8')
        
        // 遍历选择器变体
        for (const variant of selectorVariants) {
          if (!variant) continue
          
          // 查找所有匹配的CSS规则
          const regex = new RegExp(`(${variant})\s*\{[^}]*\}`, 'gms')
          let match
          
          while ((match = regex.exec(fileContent)) !== null) {
            // 获取匹配行号
            const lineNumber = fileContent.slice(0, match.index).split('\n').length
            
            // 生成上下文信息
            const contextLines = fileContent.split('\n').slice(
              Math.max(0, lineNumber - 2),
              lineNumber + 5
            )
            const context = contextLines.join('\n')
            
            // 保存匹配信息
            matches.push({
              file: filePath,
              line: lineNumber,
              context,
              originalContent: match[0]
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
    console.error('搜索CSS失败:', error)
    return []
  }
})

/**
 * 生成CSS选择器变体
 * @param selector 原始选择器
 * @returns 选择器变体数组
 */
function generateSelectorVariants(selector: string): string[] {
  const variants: string[] = []
  
  // 原始选择器
  variants.push(selector)
  
  // 移除所有空格
  variants.push(selector.replace(/\s+/g, ''))
  
  // 移除子选择器符号 > 周围的空格
  variants.push(selector.replace(/\s*>\s*/g, '>'))
  
  // 移除类名和标签名之间的空格
  variants.push(selector.replace(/\s+\./g, '.'))
  
  // 移除ID和标签名之间的空格
  variants.push(selector.replace(/\s+#/g, '#'))
  
  // 仅保留直接子选择器，忽略嵌套层次
  const directSelector = selector.split(' > ').pop() || ''
  if (directSelector) {
    variants.push(directSelector)
  }
  
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