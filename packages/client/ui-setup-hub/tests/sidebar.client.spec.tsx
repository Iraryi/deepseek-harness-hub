// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HubSidebarAction, type HubSidebarActionProps } from '../src/client/HubSidebarAction.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

describe('HUB sidebar entry', () => {
  for (const dictionary of [zh, en]) {
    for (const wide of [true, false]) {
      it(`opens the existing HUB with ${dictionary.marketEntry}, wide=${wide}`, () => {
        const openHub = vi.fn()
        const props = { wide, openHub, t: (key: keyof typeof zh) => dictionary[key] } as HubSidebarActionProps
        render(<HubSidebarAction {...props} />)
        const button = screen.getByRole('button', { name: dictionary.marketEntry })
        expect(button.querySelector('svg')).not.toBeNull()
        expect(button.querySelector('svg')?.getAttribute('width')).toBe(String(wide ? 16 : 18))
        expect(button.textContent).toBe(wide ? dictionary.marketEntry : '')
        fireEvent.click(button)
        expect(openHub).toHaveBeenCalledOnce()
      })
    }
  }
})
