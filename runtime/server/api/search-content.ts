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
    // 支持两种参数名: files(前端发送的) 和 sourceFiles(保持兼容)
    const { content, files, sourceFiles } = body
    const targetFiles = files || sourceFiles

    if (!content || !Array.isArray(targetFiles)) {
      return []
    }

    const matches: Match[] = []

    // 遍历所有源文件
    for (const filePath of targetFiles) {
      try {
        const fullPath = join(process.cwd(), filePath)
        const fileContent = await readFile(fullPath, 'utf8')

        // 查找所有匹配项
        const regex = new RegExp(escapeRegExp(content), 'g')
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
            originalContent: content,
          })
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
 * 转义正则表达式中的特殊字符
 * @param string 输入字符串
 * @returns 转义后的字符串
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}