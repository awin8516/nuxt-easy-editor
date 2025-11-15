import { escapeRegex } from './utils/shared-utils'

export function normalizePathname(pathname: string): string {
  // 确保以 / 开头
  let normalized = pathname.startsWith('/') ? pathname : `/${pathname}`
  // 移除尾部 / (如果不是根路径)
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }
  return normalized
}

export function isPatternKey(key: string): boolean {
  return key.includes('*') || key.includes('[...') || key.includes('[') || key.includes(':')
}

export function buildPathCandidates(pathname: string): string[] {
  const candidates: string[] = [pathname]
  const segments = pathname.split('/').filter(Boolean)

  for (let i = 0; i < segments.length; i++) {
    // 创建可选参数形式
    const optionalSegments = segments.map((seg, idx) => idx > i ? `[...${seg}]` : seg)
    candidates.push(`/${optionalSegments.join('/')}`)

    // 创建带参数形式
    const paramSegments = segments.map((seg, idx) => idx === i ? `:${seg}` : seg)
    candidates.push(`/${paramSegments.join('/')}`)
  }

  return candidates
}

export function patternToRegex(pattern: string): RegExp | null {
  if (!isPatternKey(pattern)) {
    return null
  }

  if (wildcardRegexCache.has(pattern)) {
    return wildcardRegexCache.get(pattern) || null
  }

  const tokens: Array<{ placeholder: string; regex: string }> = []
  let transformed = pattern

  const replacers: Array<[RegExp, string]> = [
    [/\[\.{3}([^\]/]+)\]/g, '__NUXT_CATCHALL__'],
    [/\[\[\.{3}([^\]/]+)\]\]/g, '__NUXT_OPTIONAL_CATCHALL__'],
    [/\[([^\]/]+)\]/g, '__NUXT_SEGMENT__'],
    [/:([A-Za-z0-9_]+)/g, '__NUXT_DYNAMIC__']
  ]

  replacers.forEach(([regex, placeholder]) => {
    transformed = transformed.replace(regex, (_, name) => {
      let target = placeholder
      if (placeholder === '__NUXT_CATCHALL__') {
        target += '_CATCHALL'
      } else if (placeholder === '__NUXT_OPTIONAL_CATCHALL__') {
        target += '_OPTIONAL'
      }
      tokens.push({
        placeholder: target,
        regex:
          placeholder === '__NUXT_CATCHALL__'
            ? '(.+)'
            : placeholder === '__NUXT_OPTIONAL_CATCHALL__'
              ? '(?:.+)?'
              : '([^/]+)'
      })
      return target
    })
  })

  let escaped = escapeRegex(transformed)
  escaped = escaped.replace(/\\\*/g, '.*')

  tokens.forEach(({ placeholder, regex }) => {
    escaped = escaped.replace(new RegExp(escapeRegex(placeholder), 'g'), regex)
  })

  const finalRegex = new RegExp(`^${escaped}$`)
  wildcardRegexCache.set(pattern, finalRegex)
  return finalRegex
}

export function resolveSourceFiles(pathname: string, sourceMap: Record<string, string[]>): string[] {
  if (!sourceMap || typeof sourceMap !== 'object') {
    return []
  }

  const candidates = buildPathCandidates(pathname)

  for (const candidate of candidates) {
    const directMatch = sourceMap[candidate]
    if (Array.isArray(directMatch) && directMatch.length > 0) {
      return directMatch
    }
  }

  for (const key of Object.keys(sourceMap)) {
    const pattern = patternToRegex(key)
    if (pattern && candidates.some(candidate => pattern.test(candidate))) {
      const files = sourceMap[key]
      if (Array.isArray(files) && files.length > 0) {
        return files
      }
    }
  }

  return []
}

const wildcardRegexCache = new Map<string, RegExp>()