import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineEventHandler, getQuery, createError } from 'h3'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const filePath = query.file as string

  if (!filePath) {
    throw createError({
      statusCode: 400,
      message: 'File path is required'
    })
  }

  try {
    // 解析文件路径
    const resolvedPath = filePath.startsWith('/') || filePath.match(/^[A-Z]:/)
      ? filePath
      : resolve(process.cwd(), filePath)

    const content = readFileSync(resolvedPath, 'utf-8')
    return {
      content,
      path: resolvedPath
    }
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      message: `Failed to read file: ${error.message}`
    })
  }
})

