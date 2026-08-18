import { registerHooks } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const runtimeRoot = dirname(fileURLToPath(import.meta.url))
const runtimeParent = pathToFileURL(join(runtimeRoot, 'node_modules', '__dsh_runtime_resolver__.mjs')).href

function isBareSpecifier(specifier) {
  return !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.includes(':')
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!isBareSpecifier(specifier) || error?.code !== 'ERR_MODULE_NOT_FOUND') throw error
      return nextResolve(specifier, { ...context, parentURL: runtimeParent })
    }
  },
})
