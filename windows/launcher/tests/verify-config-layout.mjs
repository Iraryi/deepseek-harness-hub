import { readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const directory = resolve(process.argv[2])
const { chromium } = await import(pathToFileURL(resolve(process.argv[3])).href)
const browser = await chromium.launch({ executablePath: process.env.DSH_TEST_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const results = []
try {
  const files = readdirSync(directory).filter(name => name.endsWith('-draft.html'))
  if (files.length !== 4) throw new Error('Expected four bilingual DSH/HUB fixtures')
  for (const file of files) {
    for (const viewport of [{ width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
      const page = await browser.newPage({ viewport })
      await page.goto(pathToFileURL(join(directory, file)).href)
      for (const end of [false, true]) {
        const result = await page.evaluate(atEnd => {
          const root = document.querySelector('[data-config-editor]')
          const scroller = root.firstElementChild
          scroller.scrollTop = atEnd ? scroller.scrollHeight : 0
          let parent = root.parentElement
          while (parent.getBoundingClientRect().height === 0) parent = parent.parentElement
          const footer = root.querySelector('footer').getBoundingClientRect()
          return {
            bottomGap: parent.getBoundingClientRect().bottom - footer.bottom,
            overlap: scroller.getBoundingClientRect().bottom - footer.top,
            horizontalOverflow: root.scrollWidth - root.clientWidth,
            bottom: footer.bottom,
            scrollable: scroller.scrollHeight > scroller.clientHeight,
          }
        }, end)
        if (Math.abs(result.bottomGap) > 1 || Math.abs(result.overlap) > 1 || result.horizontalOverflow > 1 || result.bottom > viewport.height || (file.includes('-dsh-') && !result.scrollable)) {
          throw new Error(JSON.stringify({ file, viewport, end, result }))
        }
        results.push({ file, viewport, end, ...result })
      }
      await page.screenshot({ path: join(directory, file.replace('.html', `-${viewport.width}.png`)) })
      await page.close()
    }
  }
  writeFileSync(join(directory, 'geometry-results.json'), JSON.stringify(results, null, 2))
  console.log(`${results.length} real-browser scroll/layout checks passed`)
} finally { await browser.close() }
