import { readFile } from 'fs/promises'
import { join } from 'path'
import { defineEventHandler, getQuery } from 'h3'

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const filePath = query.file as string
    
    if (!filePath) {
      return { error: '文件路径不能为空' }
    }
    
    // 确保文件路径在项目根目录内
    const fullPath = join(process.cwd(), filePath)
    const content = await readFile(fullPath, 'utf8')
    
    return { content }
  } catch (error) {
    console.error('读取文件失败:', error)
    return { error: '读取文件失败' }
  }
})