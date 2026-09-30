import Module, { registerHooks } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, relative, isAbsolute, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const installRoot = dirname(fileURLToPath(import.meta.url))
const binding = JSON.parse(readFileSync(join(installRoot, 'overlay-binding.json'), 'utf8'))
const inventory = JSON.parse(readFileSync(join(installRoot, 'payload-manifest.json'), 'utf8'))
if (binding.Schema !== 1 || inventory.Schema !== 1 || !inventory.Packages?.length) {
  throw new Error('Overlay resolver requires a bound, nonempty package inventory')
}
const packagesRoot = join(installRoot, 'payload', 'overlay-packages', 'node_modules')
const overlayParent = pathToFileURL(join(packagesRoot, '__overlay__.mjs')).href
const runtimeParent = pathToFileURL(join(binding.Paths.RuntimeRoot, 'node_modules', '__overlay__.mjs')).href
const packages = new Set(inventory.Packages.map(entry => entry.Name))

function packageName(specifier) {
  if (/^[./]|:/.test(specifier)) return null
  const segments = specifier.split('/')
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
}

function redirectResolved(result) {
  if (!result.url.startsWith('file:')) return result
  const resolvedPath = fileURLToPath(result.url)
  for (const entry of inventory.Packages) {
    const baseRoots = [join(binding.Paths.RuntimeRoot, 'node_modules', entry.Name)]
    if (entry.RepositoryDirectory) baseRoots.push(join(binding.Paths.RuntimeRoot, entry.RepositoryDirectory))
    for (const baseRoot of baseRoots) {
      const suffix = relative(baseRoot, resolvedPath)
      if (!suffix || suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) continue
      const replacement = join(packagesRoot, entry.Name, suffix)
      if (!existsSync(replacement)) throw new Error(`Overlay is missing selected package file: ${replacement}`)
      return { ...result, url: pathToFileURL(replacement).href }
    }
  }
  return result
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const selected = packages.has(packageName(specifier))
    if (selected) return nextResolve(specifier, { ...context, parentURL: overlayParent })
    try {
      return redirectResolved(nextResolve(specifier, context))
    } catch (error) {
      if (!packageName(specifier) || error.code !== 'ERR_MODULE_NOT_FOUND') throw error
      return redirectResolved(nextResolve(specifier, { ...context, parentURL: runtimeParent }))
    }
  },
})

const originalResolveFilename = Module._resolveFilename
const overlayModule = new Module(fileURLToPath(overlayParent))
overlayModule.filename = fileURLToPath(overlayParent)
overlayModule.paths = Module._nodeModulePaths(packagesRoot)
Module._resolveFilename = function (request, parent, isMain, options) {
  const selected = packages.has(packageName(request))
  const resolved = originalResolveFilename.call(this, request, selected ? overlayModule : parent, isMain, selected ? undefined : options)
  if (!isAbsolute(resolved)) return resolved
  return fileURLToPath(redirectResolved({ url: pathToFileURL(resolved).href }).url)
}
