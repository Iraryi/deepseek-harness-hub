#!/usr/bin/env node

import { execFileSync } from 'node:child_process'

const staged = execFileSync('git', ['diff', '--cached', '--name-only', '-z'])
  .toString('utf8')
  .split('\0')
  .filter(Boolean)

const vendorSourceChanges = staged.filter(path => /^vendor\/[^/]+\/(?:src\/|bin\.js$)/u.test(path))
const manifestChanged = staged.includes('vendor/README.md')

if (vendorSourceChanges.length > 0 && !manifestChanged) {
  console.error('vendor manifest guard: vendored SOURCE changed without updating vendor/README.md:')
  for (const path of vendorSourceChanges) console.error(`  ${path}`)
  console.error('Log the modification in vendor/README.md ("Local modifications") and stage it.')
  process.exit(1)
}
