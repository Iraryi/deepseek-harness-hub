// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { Context } from '@deepseek-ai/cordis'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComposerContentEditable } from '../../ui-conversation/src/client/input/editor/ComposerContentEditable.tsx'
import { registerComposerKeymap } from '../../ui-conversation/src/client/input/editor/keymap.ts'
import { SessionInputShell } from '../../ui-conversation/src/client/input/facade.ts'

const script = readFileSync(resolve(process.cwd(), 'windows/launcher/assets/enhancements.js'), 'utf8')

interface Settings {
  enabled: boolean
  conversationWidth: number
  plainTextPaste: boolean
  showSessionIds: boolean
}

const desktop = window as typeof window & {
  __dshEnhancements?: Settings
  __dshEnhancementsCleanup?: () => void
}

class Clipboard {
  files: File[] = []
  items: { kind: string; getAsFile: () => File | null }[] = []
  private values = new Map<string, string>()
  get types(): string[] { return [...this.values.keys()] }
  setData(type: string, value: string): void { this.values.set(type, value) }
  getData(type: string): string { return this.values.get(type) ?? '' }
}

function activate(settings: Partial<Settings> = {}): void {
  desktop.__dshEnhancements = {
    enabled: true, conversationWidth: 1000, plainTextPaste: true, showSessionIds: false, ...settings,
  }
  window.eval(script)
}

function richClipboard(): Clipboard {
  const clipboard = new Clipboard()
  clipboard.setData('text/plain', 'plain <text>\nnext')
  clipboard.setData('text/html', '<b>rich</b>')
  return clipboard
}

function paste(target: Element, clipboard = richClipboard(), locked = false): ClipboardEvent {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', { configurable: !locked, value: clipboard })
  target.dispatchEvent(event)
  return event
}

function element(selector: string): HTMLElement {
  const match = document.querySelector<HTMLElement>(selector)
  if (!match) throw new Error(`Missing fixture: ${selector}`)
  return match
}

function injectedStyle(): HTMLStyleElement | null {
  return document.querySelector('style[data-dsh-enhancements]')
}

beforeEach(() => {
  vi.stubGlobal('DataTransfer', Clipboard)
  document.body.innerHTML = `
    <aside><div role="tree"><div role="treeitem" aria-selected="true">
      <span>status</span><span data-session-id="01234567-89ab-cdef">Session title</span>
    </div><div role="treeitem"><span>No ID</span></div></div></aside>
    <main><div data-phase="active"><div><div data-conversation-scroll>
      <div data-slot="conversation.session"><div><div><div data-chat-flow>Transcript</div></div></div></div>
      <div data-composer-seat><div><div data-composer-card><div data-input-scroll>
        <div data-composer-input contenteditable="true" role="textbox" aria-multiline="true"><p>Draft</p></div>
      </div></div></div></div>
    </div></div></div></main>
    <div id="unrelated" role="textbox" contenteditable="true">Unrelated</div>
    <textarea>Settings</textarea>`
})

afterEach(() => {
  desktop.__dshEnhancementsCleanup?.()
  delete desktop.__dshEnhancements
  cleanup()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('native DSH enhancement script', () => {
  it('is inert when disabled or unconfigured', () => {
    const observe = vi.spyOn(MutationObserver.prototype, 'observe')
    const listeners = vi.spyOn(document, 'addEventListener')
    const original = document.body.innerHTML
    window.eval(script)
    activate({ enabled: false, showSessionIds: true })
    const clipboard = richClipboard()
    expect(paste(element('[data-composer-input]'), clipboard).clipboardData).toBe(clipboard)
    expect(document.body.innerHTML).toBe(original)
    expect(injectedStyle()).toBeNull()
    expect(desktop.__dshEnhancementsCleanup).toBeUndefined()
    expect(observe).not.toHaveBeenCalled()
    expect(listeners).not.toHaveBeenCalledWith('paste', expect.anything(), true)
  })

  it('changes only existing conversation width variables, including after DOM replacement', () => {
    const observe = vi.spyOn(MutationObserver.prototype, 'observe')
    activate()
    const style = injectedStyle()!
    expect(style.sheet!.cssRules).toHaveLength(1)
    const rule = style.sheet!.cssRules[0] as CSSStyleRule
    expect(rule.selectorText).toBe('[data-conversation-scroll]')
    expect(rule.style.getPropertyValue('--dsh-chat-content-width')).toBe('1000px')
    expect(rule.style.getPropertyValue('--dsh-composer-card-max-width')).toBe('calc(1000px + 32px)')
    expect(getComputedStyle(element('aside')).getPropertyValue('--dsh-chat-content-width')).toBe('')
    const scroll = element('[data-conversation-scroll]')
    scroll.replaceWith(scroll.cloneNode(true))
    expect(getComputedStyle(element('[data-conversation-scroll]')).getPropertyValue('--dsh-chat-content-width')).toBe('1000px')
    expect(style.textContent).not.toMatch(/overflow|position|height|transform/)
    expect(observe).not.toHaveBeenCalled()
  })

  it.each([0, 639, 2001, 1000.5, Number.NaN])('leaves native width unchanged for %s', (width) => {
    activate({ conversationWidth: width, plainTextPaste: false })
    expect(injectedStyle()).toBeNull()
  })

  it.each([640, 2000])('accepts the width endpoint %s', (width) => {
    activate({ conversationWidth: width })
    expect(injectedStyle()!.textContent).toContain(`--dsh-chat-content-width: ${width}px`)
  })

  it('uses real owner-provided IDs only, without touching row content or drag-marker pseudo-elements', () => {
    activate({ conversationWidth: 0, showSessionIds: true })
    const rule = injectedStyle()!.sheet!.cssRules[0] as CSSStyleRule
    expect(rule.selectorText).toBe('[role="tree"] [role="treeitem"] > span[data-session-id]:not([data-session-id=""])::before')
    expect(injectedStyle()!.textContent).toContain('content: attr(data-session-id);')
    expect(rule.style.getPropertyValue('max-width')).toBe('8ch')
    const target = rule.selectorText.replace('::before', '')
    expect(document.querySelectorAll(target)).toHaveLength(1)
    element('[data-session-id]').setAttribute('data-session-id', 'updated-id')
    expect(element(target).dataset.sessionId).toBe('updated-id')
    element('[data-session-id]').removeAttribute('data-session-id')
    expect(document.querySelectorAll(target)).toHaveLength(0)
    expect(element('[role="treeitem"]').textContent).toContain('Session title')
  })

  it('strips rich formats only inside the enabled composer and leaves insertion to its editor', () => {
    activate()
    const editor = element('[data-composer-input]')
    const event = paste(element('[data-composer-input] p'))
    expect(Array.from(event.clipboardData!.types)).toEqual(['text/plain'])
    expect(event.clipboardData!.getData('text/plain')).toBe('plain <text>\nnext')
    expect(event.defaultPrevented).toBe(false)
    expect(editor.textContent).toBe('Draft')
    for (const selector of ['#unrelated', 'textarea']) {
      const clipboard = richClipboard()
      expect(paste(element(selector), clipboard).clipboardData).toBe(clipboard)
    }
    editor.setAttribute('contenteditable', 'false')
    const clipboard = richClipboard()
    expect(paste(editor, clipboard).clipboardData).toBe(clipboard)
  })

  it('does not intercept nested editors, read-only editors, or detached composer lookalikes', () => {
    activate()
    const editor = element('[data-composer-input]')
    editor.innerHTML = '<span contenteditable="true">Nested</span>'
    const clipboard = richClipboard()
    expect(paste(editor.firstElementChild!, clipboard).clipboardData).toBe(clipboard)
    editor.setAttribute('aria-readonly', 'true')
    expect(paste(editor, clipboard).clipboardData).toBe(clipboard)
    editor.removeAttribute('aria-readonly')
    document.body.append(editor)
    expect(paste(editor, clipboard).clipboardData).toBe(clipboard)
  })

  it.each(['file-list', 'file-item', 'file-type'])('preserves mixed rich text and file paste detected by %s', (source) => {
    activate()
    const clipboard = richClipboard()
    const file = new File(['image'], 'image.png', { type: 'image/png' })
    if (source === 'file-list') clipboard.files.push(file)
    if (source === 'file-item') clipboard.items.push({ kind: 'file', getAsFile: () => file })
    if (source === 'file-type') clipboard.setData('Files', '')
    const event = paste(element('[data-composer-input]'), clipboard)
    expect(event.clipboardData).toBe(clipboard)
    expect(event.defaultPrevented).toBe(false)
  })

  it('leaves plain-only, HTML-only, and immutable clipboard events to the existing editor', () => {
    activate()
    const editor = element('[data-composer-input]')
    for (const format of ['text/plain', 'text/html']) {
      const clipboard = new Clipboard()
      clipboard.setData(format, 'content')
      expect(paste(editor, clipboard).clipboardData).toBe(clipboard)
    }
    const clipboard = richClipboard()
    expect(paste(editor, clipboard, true).clipboardData).toBe(clipboard)
    vi.stubGlobal('DataTransfer', undefined)
    expect(paste(editor, clipboard).clipboardData).toBe(clipboard)
  })

  it('reinitializes settings without duplicate handlers, then restores native behavior on disable', () => {
    activate({ showSessionIds: true })
    const oldCleanup = desktop.__dshEnhancementsCleanup!
    const oldStyle = injectedStyle()!
    desktop.__dshEnhancements!.conversationWidth = 1600
    expect(oldStyle.textContent).toContain('1000px')
    activate({ conversationWidth: 1600, plainTextPaste: false })
    oldCleanup()
    expect(oldStyle.isConnected).toBe(false)
    expect(document.querySelectorAll('style[data-dsh-enhancements]')).toHaveLength(1)
    expect(injectedStyle()!.textContent).toContain('1600px')
    expect(injectedStyle()!.textContent).not.toContain('data-session-id')
    const clipboard = richClipboard()
    expect(paste(element('[data-composer-input]'), clipboard).clipboardData).toBe(clipboard)
    activate({ enabled: false })
    expect(injectedStyle()).toBeNull()
    expect(desktop.__dshEnhancementsCleanup).toBeUndefined()
  })

  it('releases the previous enabled paste listener when Bootstrap runs again in the same WebView', () => {
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    activate()
    const first = add.mock.calls.find(([name]) => name === 'paste')![1]
    activate({ conversationWidth: 1200 })
    const listeners = add.mock.calls.filter(([name]) => name === 'paste')
    expect(listeners).toHaveLength(2)
    expect(remove).toHaveBeenCalledWith('paste', first, true)
    expect(document.querySelectorAll('style[data-dsh-enhancements]')).toHaveLength(1)
    expect(paste(element('[data-composer-input]')).clipboardData!.types).toEqual(['text/plain'])
    desktop.__dshEnhancementsCleanup!()
    expect(remove).toHaveBeenCalledWith('paste', listeners[1]![1], true)
    const clipboard = richClipboard()
    expect(paste(element('[data-composer-input]'), clipboard).clipboardData).toBe(clipboard)
  })

  it('matches the current owner-provided title hook and native shared width axis', () => {
    const rows = readFileSync(resolve(process.cwd(), 'packages/client/ui-workspace/src/client/rows/Rows.tsx'), 'utf8')
    expect(rows).toContain('<span className={css.title} data-session-id={node.id}>{title}</span>')
    const flow = readFileSync(resolve(process.cwd(), 'packages/client/ui-chat/src/client/chat/ChatView.module.css'), 'utf8')
    const composer = readFileSync(resolve(process.cwd(), 'packages/client/ui-conversation/src/client/skeleton/InputBar.module.css'), 'utf8')
    expect(flow).toContain('max-width: var(--dsh-chat-content-width)')
    expect(flow).toContain('width: 100%')
    expect(composer).toContain('max-width: var(--dsh-composer-card-max-width)')
  })

  it('survives bfcache suspension and cleans up on final pagehide', () => {
    activate()
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
    expect(injectedStyle()).not.toBeNull()
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }))
    expect(injectedStyle()).toBeNull()
    const clipboard = richClipboard()
    expect(paste(element('[data-composer-input]'), clipboard).clipboardData).toBe(clipboard)
  })

  it('defers document-created styling until a root exists and cancels pending startup on cleanup', () => {
    const root = document.documentElement
    root.remove()
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
    try {
      activate()
      desktop.__dshEnhancementsCleanup!()
      document.append(root)
      document.dispatchEvent(new Event('DOMContentLoaded'))
      expect(injectedStyle()).toBeNull()
      root.remove()
      activate()
      document.append(root)
      document.dispatchEvent(new Event('DOMContentLoaded'))
      expect(injectedStyle()).not.toBeNull()
    } finally {
      if (!root.isConnected) document.append(root)
    }
  })

  it('routes through the real React composer and Lexical keymap exactly once, preserving file intake', () => {
    activate()
    const shell = new SessionInputShell({
      actx: new Context(),
      defaultSink: async () => { throw new Error('Paste must not submit') },
      commandAttachments: {
        serialize: async () => [], release: () => {}, unsupportedNotice: token => token,
      },
    })
    const editor = shell.editor
    const view = render(createElement(ComposerContentEditable, { editor, editable: true }), {
      container: element('[data-composer-seat]'),
    })
    const pasteText = vi.fn((text: string) => { shell.paste(text) })
    const intakeFiles = vi.fn()
    const unregister = registerComposerKeymap(editor, {
      arbitrate: () => 'pass', space: () => false, dismissPopup: () => {},
      canSubmit: () => true, submit: () => {}, pasteText, intakeFiles,
    })
    try {
      shell.setDraft('draft')
      const event = paste(view.container.querySelector('[data-composer-input]')!)
      editor.update(() => {}, { discrete: true })
      expect(event.defaultPrevented).toBe(true)
      expect(pasteText).toHaveBeenCalledExactlyOnceWith('plain <text>\nnext')
      expect(shell.snapshot.draft).toBe('draftplain <text>\nnext')
      expect(view.container.querySelector('b')).toBeNull()
      const clipboard = richClipboard()
      const file = new File(['file'], 'note.txt', { type: 'text/plain' })
      clipboard.items.push({ kind: 'file', getAsFile: () => file })
      expect(paste(view.container.querySelector('[data-composer-input]')!, clipboard).clipboardData).toBe(clipboard)
      expect(intakeFiles).toHaveBeenCalledExactlyOnceWith([file])
    } finally {
      unregister()
      view.unmount()
      shell.dispose()
    }
  })
})
