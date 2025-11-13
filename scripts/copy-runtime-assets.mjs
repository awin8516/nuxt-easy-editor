import { cpSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import fg from 'fast-glob'

const patterns = ['runtime/**/*.{css,vue}']

const files = await fg(patterns, { dot: false })

for (const file of files) {
  const source = resolve(process.cwd(), file)
  const destination = resolve(process.cwd(), 'dist', file)
  mkdirSync(dirname(destination), { recursive: true })
  cpSync(source, destination)
}


