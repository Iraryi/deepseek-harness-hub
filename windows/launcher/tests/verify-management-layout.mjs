import { readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const directory = resolve(process.argv[2])
const { chromium } = await import(pathToFileURL(resolve(process.argv[3])).href)
const browser = await chromium.launch({ executablePath: process.env.DSH_TEST_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const results = []
try {
  const files = readdirSync(directory).filter(name => /^management-.*\.html$/.test(name))
  if (files.length !== 6) throw new Error('Expected six bilingual management fixtures')
  for (const file of files) {
    for (const viewport of [{ width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
      const page = await browser.newPage({ viewport })
      await page.goto(pathToFileURL(join(directory, file)).href)
      const geometry = await page.evaluate(() => {
        const root = document.querySelector('main')
        const buttons = [...root.querySelectorAll('button')].filter(button => button.getBoundingClientRect().height > 0)
        return {
          pageOverflow: document.documentElement.scrollWidth - innerWidth,
          overflow: root.scrollWidth - root.clientWidth,
          clippedButtons: buttons.filter(button => button.scrollWidth > button.clientWidth + 2).map(button => button.textContent),
        }
      })
      if (geometry.pageOverflow > 1 || geometry.overflow > 1 || geometry.clippedButtons.length) throw new Error(JSON.stringify({ file, viewport, geometry }))
      results.push({ file, viewport, geometry })
      await page.screenshot({ path: join(directory, `${file.slice(0, -5)}-${viewport.width}.png`) })
      await page.close()
    }
  }
  writeFileSync(join(directory, 'management-geometry.json'), JSON.stringify(results, null, 2))
  process.stdout.write(`${results.length} management browser layout checks passed\n`)
} finally { await browser.close() }
