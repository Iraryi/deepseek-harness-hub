// @vitest-environment jsdom
/**
 * AppRoot boot-gate smoke: loading page until the settled signal flips (status
 * alone never opens the gate), fail-loud entry list + boot failure report,
 * one-pass switch to the real UI. The full browser chain (real module system
 * + vendored Loader + bundles) is the e2e's job; this pins the shell-owned
 * gate semantics. Stores are the kernel-own signals production boot uses
 * (shell self-sufficiency: the loading page depends on no plugin package).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'

afterEach(cleanup)
import { AppRoot } from '@deepseek-ai/dsh-client-web/src/AppRoot.tsx'
import { createLoaderStatusStore, createSignal } from '@deepseek-ai/dsh-client-web/src/loader-status.ts'

function mount(restartApplication?: () => Promise<void>) {
  const settled = createSignal(false)
  const error = createSignal<string | undefined>(undefined)
  const status = createLoaderStatusStore()
  let renders = 0
  const utils = render(
    <AppRoot
      settled={settled}
      status={status}
      error={error}
      {...(restartApplication === undefined ? {} : { restartApplication })}
      renderApp={() => { renders += 1; return <div data-testid="real-ui" /> }}
    />,
  )
  return { settled, status, error, counts: () => renders, ...utils }
}

describe('AppRoot', () => {
  it('shows the loading page and never calls renderApp before settled', () => {
    const { queryByTestId, counts, getByText } = mount()
    expect(getByText('HARNESS')).toBeTruthy()
    expect(queryByTestId('real-ui')).toBeNull()
    expect(counts()).toBe(0)
  })

  it('all-active status alone does not open the gate (settled signal is the only key)', () => {
    const { status, queryByTestId } = mount()
    act(() => {
      status.set('a', 'active')
      status.set('b', 'active')
    })
    expect(queryByTestId('real-ui')).toBeNull()
  })

  it('lists failed entries and stays on the loading page', () => {
    const { status, getByText, queryByTestId } = mount()
    act(() => {
      status.set('@deepseek-ai/dsh-client-ui-layout', 'failed')
      status.set('ok', 'active')
    })
    expect(getByText('Failed to load plugins')).toBeTruthy()
    expect(getByText('@deepseek-ai/dsh-client-ui-layout')).toBeTruthy()
    expect(queryByTestId('real-ui')).toBeNull()
  })

  it('renders the boot failure report even when no entry projected failed', () => {
    const { error, getByText, queryByTestId } = mount()
    act(() => { error.set('web boot: 1 entry did not activate\nx: pending (waiting for service: y)') })
    expect(getByText('Failed to load plugins')).toBeTruthy()
    expect(getByText(/waiting for service/)).toBeTruthy()
    expect(queryByTestId('real-ui')).toBeNull()
  })

  it('replaces a plugin failure with the restart transition immediately', async () => {
    const restartApplication = vi.fn(() => new Promise<void>(() => {}))
    const { error, getByRole, getByText, queryByText } = mount(restartApplication)
    act(() => { error.set('plugin activation failed') })
    fireEvent.click(getByRole('button', { name: '重启应用' }))
    await waitFor(() => { expect(restartApplication).toHaveBeenCalledOnce() })
    expect(getByText('重启中')).toBeTruthy()
    expect(queryByText('Failed to load plugins')).toBeNull()
  })

  it('restores the failure surface when the restart request is rejected', async () => {
    const restartApplication = vi.fn(async () => { throw new Error('native restart unavailable') })
    const { error, getByRole, findByText } = mount(restartApplication)
    act(() => { error.set('plugin activation failed') })
    fireEvent.click(getByRole('button', { name: '重启应用' }))
    expect(await findByText('Error: native restart unavailable')).toBeTruthy()
    expect(getByRole('button', { name: '重启应用' })).toBeTruthy()
  })

  it('flipping settled switches to the real UI in one pass', () => {
    const { settled, getByTestId, queryByText, counts } = mount()
    act(() => { settled.set(true) })
    expect(getByTestId('real-ui')).toBeTruthy()
    expect(queryByText('HARNESS')).toBeNull()
    expect(counts()).toBe(1)
  })
})
