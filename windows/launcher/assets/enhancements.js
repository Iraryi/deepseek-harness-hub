/**
 * Document-created desktop adapter. Set window.__dshEnhancements before loading.
 * Re-execution replaces the previous instance; __dshEnhancementsCleanup removes it.
 * Settings are captured at initialization, not synchronized with persisted drafts.
 * Session prefixes require data-session-id on SessionRowItem's title span.
 */
(() => {
  'use strict'

  if (typeof window.__dshEnhancementsCleanup === 'function') window.__dshEnhancementsCleanup()
  const settings = window.__dshEnhancements
  if (!settings || settings.enabled !== true) return

  const width = Number.isInteger(settings.conversationWidth)
    && settings.conversationWidth >= 640 && settings.conversationWidth <= 2000
    ? settings.conversationWidth
    : 0
  const plainTextPaste = settings.plainTextPaste === true
  const showSessionIds = settings.showSessionIds === true
  const rules = []
  if (width !== 0) {
    rules.push(`[data-conversation-scroll] {
      --dsh-chat-content-width: ${width}px !important;
      --dsh-composer-card-max-width: calc(${width}px + 32px) !important;
    }`)
  }
  if (showSessionIds) {
    rules.push(`[role="tree"] [role="treeitem"] > span[data-session-id]:not([data-session-id=""])::before {
      content: attr(data-session-id);
      display: inline-block;
      max-width: 8ch;
      margin-inline-end: 0.5em;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: clip;
      vertical-align: bottom;
      font-family: monospace;
      font-size: 0.85em;
      opacity: 0.7;
      pointer-events: none;
    }`)
  }

  let style = null
  let disposed = false

  function mountStyle() {
    if (disposed || style || rules.length === 0) return
    const parent = document.head || document.documentElement
    if (!parent) return
    style = document.createElement('style')
    style.setAttribute('data-dsh-enhancements', '')
    style.textContent = rules.join('\n')
    parent.appendChild(style)
  }

  function onPaste(event) {
    if (event.defaultPrevented || !(event.target instanceof Element)) return
    const editor = event.target.closest('[data-composer-input][contenteditable="true"][role="textbox"]')
    if (!editor || !editor.closest('[data-composer-seat]')) return
    const editable = event.target.closest('[contenteditable]')
    if (editable !== editor || editor.getAttribute('aria-disabled') === 'true'
      || editor.getAttribute('aria-readonly') === 'true') return
    const clipboard = event.clipboardData
    if (!clipboard || clipboard.files.length > 0
      || Array.from(clipboard.items).some(item => item.kind === 'file')) return
    const types = Array.from(clipboard.types)
    if (types.includes('Files') || !types.some(type =>
      type === 'text/html' || type === 'text/rtf' || type === 'application/x-lexical-editor')) return
    const text = clipboard.getData('text/plain')
    if (text === '' || typeof DataTransfer !== 'function') return
    const plain = new DataTransfer()
    plain.setData('text/plain', text)
    try {
      Object.defineProperty(event, 'clipboardData', { configurable: true, value: plain })
    } catch (error) {
      if (!(error instanceof TypeError)) throw error
    }
  }

  function cleanup() {
    if (disposed) return
    disposed = true
    document.removeEventListener('DOMContentLoaded', mountStyle)
    document.removeEventListener('paste', onPaste, true)
    window.removeEventListener('pagehide', onPageHide)
    if (style) style.remove()
    if (window.__dshEnhancementsCleanup === cleanup) delete window.__dshEnhancementsCleanup
  }

  function onPageHide(event) {
    if (!event.persisted) cleanup()
  }

  window.__dshEnhancementsCleanup = cleanup
  if (plainTextPaste) document.addEventListener('paste', onPaste, true)
  window.addEventListener('pagehide', onPageHide)
  mountStyle()
  if (!style && rules.length > 0 && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountStyle, { once: true })
  }
})()
