import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { defineEventHandler, readBody } from 'h3'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const { file, originalContent, newContent } = body
    
    if (!file || !originalContent || !newContent) {
      return { success: false, error: '参数不完整' }
    }
    
    // 确保文件路径在项目根目录内
    const fullPath = join(process.cwd(), file)
    
    // 读取文件内容
    const fileContent = await readFile(fullPath, 'utf8')
    
    // 查找并替换CSS规则
    // 先尝试使用精确匹配
    let updatedContent = fileContent.replace(originalContent, newContent)
    
    // 如果没有找到匹配项，尝试使用正则表达式匹配不同的空格组合
    if (updatedContent === fileContent) {
      const regex = new RegExp(escapeRegExp(originalContent).replace(/\s+/g, '\\s+'), 'gms')
      updatedContent = fileContent.replace(regex, newContent)
    }
    
    if (updatedContent === fileContent) {
      return { success: false, error: '未找到要更新的CSS规则' }
    }
    
    // 写入更新后的内容
    await writeFile(fullPath, updatedContent, 'utf8')
    
    return { success: true }
  } catch (error) {
    console.error('更新CSS失败:', error)
    return { success: false, error: '更新CSS失败' }
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