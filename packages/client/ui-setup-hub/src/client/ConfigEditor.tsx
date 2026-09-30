import { useCallback, useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SetupHubInjected } from './SetupHubSettingsTab.tsx'
import type { SetupHubLocaleKey } from './locales.ts'
import { configFields } from './config-fields.ts'
import css from './ConfigEditor.module.css'

type ConfigValue = string | number | boolean | readonly string[]
const resolutionPresets: Record<string, readonly string[]> = {
  '16:9': ['1280x720', '1920x1080', '2560x1440', '3840x2160'],
  '16:10': ['1280x800', '1920x1200', '2560x1600'],
  '21:9': ['2560x1080', '3440x1440'], '32:9': ['3840x1080', '5120x1440'],
  '4:3': ['1024x768', '1600x1200'], '5:4': ['1280x1024'], '3:2': ['1440x960', '2160x1440'],
}
interface ConfigDocument {
  target: 'dsh' | 'hub'
  revision: string
  values: Record<string, ConfigValue>
}

function checkDocument(input: unknown): ConfigDocument {
  if (typeof input !== 'object' || input === null) throw new Error('Invalid CONFIG response.')
  const value = input as Partial<ConfigDocument>
  if (typeof value.revision !== 'string' || value.values === undefined || value.values === null || typeof value.values !== 'object' || Array.isArray(value.values)
    || (value.target !== 'dsh' && value.target !== 'hub')) {
    throw new Error('Invalid CONFIG response; update the desktop launcher and retry.')
  }
  return { target: value.target, revision: value.revision, values: value.values }
}
type EditorProps = Pick<SetupHubInjected, 'requestHub' | 'desktopAvailable' | 'openConfig'>
  & PropsLocale<'settings.setupHub'>
  & Pick<SettingsSectionOwnerProps, 'registerLeaveGuard'>
  & { initialTarget?: 'dsh' | 'hub' }
type SectionProps = PropsRuntime<'settings.section'> & SettingsSectionOwnerProps
  & PropsLocale<'settings.setupHub'> & InjectFace<SetupHubInjected>

export function ConfigSettingsSection(props: SectionProps) {
  return <ConfigEditor {...props} />
}

export function ConfigEditor(props: EditorProps) {
  const [target, setTarget] = useState<'dsh' | 'hub'>(props.initialTarget ?? 'dsh')
  const [document, setDocument] = useState<ConfigDocument>()
  const [values, setValues] = useState<Record<string, ConfigValue>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [restartPending, setRestartPending] = useState(false)
  const [decision, setDecision] = useState(false)
  const [aspect, setAspect] = useState('16:9')
  const pendingDecision = useRef<((value: boolean) => void) | undefined>(undefined)
  const stayButton = useRef<HTMLButtonElement>(null)
  const dirty = document !== undefined && JSON.stringify(document.values) !== JSON.stringify(values)
  const failure = (reason: unknown): void => {
    setError(reason instanceof Error ? reason.message : String(reason))
  }
  const load = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const next = checkDocument(await props.requestHub<ConfigDocument>('config-read', { target }))
      setDocument(next)
      setValues(next.values)
      setAspect(Object.keys(resolutionPresets).find(ratio => resolutionPresets[ratio]?.includes(`${String(next.values.ResolutionWidth)}x${String(next.values.ResolutionHeight)}`)) ?? 'custom')
      setRestartPending(false)
    } catch (reason) { failure(reason) }
    finally { setBusy(false) }
  }, [props.requestHub, target])
  useEffect(() => { if (props.desktopAvailable) void load() }, [load, props.desktopAvailable])
  useEffect(() => {
    if (!props.desktopAvailable) return
    void props.requestHub('config-dirty', { dirty }).catch(failure)
    if (!dirty) return
    const beforeUnload = (event: BeforeUnloadEvent): void => { event.preventDefault() }
    window.addEventListener('beforeunload', beforeUnload)
    return () => { window.removeEventListener('beforeunload', beforeUnload) }
  }, [dirty, props.desktopAvailable, props.requestHub])
  useEffect(() => () => {
    pendingDecision.current?.(false)
    if (props.desktopAvailable) void props.requestHub('config-dirty', { dirty: false }).catch(() => undefined)
  }, [props.requestHub, props.desktopAvailable])
  const guard = useCallback(async (): Promise<boolean> => {
    if (busy) return false
    if (!dirty) return true
    if (pendingDecision.current) return false
    setDecision(true)
    return new Promise((resolve) => { pendingDecision.current = resolve })
  }, [busy, dirty])
  useEffect(() => props.registerLeaveGuard?.(guard), [props.registerLeaveGuard, guard])
  useEffect(() => { if (decision) stayButton.current?.focus() }, [decision])
  const resolveDecision = (allow: boolean): void => {
    setDecision(false)
    pendingDecision.current?.(allow)
    pendingDecision.current = undefined
  }
  const save = async (): Promise<boolean> => {
    if (!document) return false
    setBusy(true)
    setError('')
    try {
      const changes = Object.fromEntries(Object.entries(values)
        .filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(document.values[key])))
      const saved = checkDocument(await props.requestHub<ConfigDocument>('config-save', { target, revision: document.revision, values: changes }))
      setDocument(saved)
      setValues(saved.values)
      setRestartPending(true)
      await props.requestHub('config-dirty', { dirty: false })
      return true
    } catch (reason) { failure(reason); return false }
    finally { setBusy(false) }
  }
  const restart = async (): Promise<void> => {
    setBusy(true)
    setError('')
    setNotice(props.t('configRestarting'))
    try {
      await props.requestHub('config-restart', { target })
      setRestartPending(false)
    } catch (reason) { failure(reason); setNotice('') }
    finally { setBusy(false) }
  }
  const change = (key: string, value: ConfigValue): void => { setValues(previous => ({ ...previous, [key]: value })); setNotice('') }
  const resolutionKey = `${String(values.ResolutionWidth)}x${String(values.ResolutionHeight)}`
  const advanced = new Set(['Url', 'Port', 'NodePath', 'RepoPath', 'Extensions', 'EnableExtensions', 'InjectCss', 'InjectJs', 'DevTools', 'ExternalLinksInBrowser'])
  if (!props.desktopAvailable) return <p>{props.t('configUnavailable')}</p>
  return <section className={css.root} data-config-editor aria-label={props.t('configTitle')}>
    <div className={css.scroll}>
      <header className={css.header}><div><h2>{props.t('configTitle')}</h2><p>{props.t('configDescription')}</p></div>
        <button type="button" disabled={busy} onClick={() => { void guard().then((allowed) => { if (allowed) void props.requestHub('config-open', { target }).catch(failure) }) }}>{props.t('configStandalone')}</button>
      </header>
      <label className={css.target}>{props.t('configTarget')}<select value={target} disabled={busy} onChange={(event) => {
        const next = event.currentTarget.value as 'dsh' | 'hub'
        void guard().then((allowed) => { if (allowed) { setDocument(undefined); setValues({}); setNotice(''); setTarget(next) } })
      }}><option value="dsh">DSH</option><option value="hub">HUB</option></select></label>
      {error && <div role="alert" className={css.error}><strong>{error.includes('CONFIG_CONFLICT') ? props.t('configConflict') : props.t('configFailed')}</strong><details><summary>{props.t('catalogDiagnostics')}</summary><pre>{error}</pre></details><button type="button" disabled={busy} onClick={() => { void guard().then((allowed) => { if (allowed) void load() }) }}>{props.t('configReload')}</button></div>}
      {document && <fieldset disabled={busy} className={css.fields}>
        {target === 'dsh' && <div className={css.grid}><label className={css.row}>{props.t('configAspect')}<select value={aspect} onChange={(event) => { setAspect(event.currentTarget.value) }}>{Object.keys(resolutionPresets).map(ratio => <option key={ratio}>{ratio}</option>)}<option value="custom">{props.t('configCustom')}</option></select></label><label className={css.row}>{props.t('configResolution')}<select value={resolutionKey} onChange={(event) => {
          const [width, height] = event.currentTarget.value.split('x').map(Number)
          if (width && height) setValues(previous => ({ ...previous, ResolutionWidth: width, ResolutionHeight: height }))
        }}><option value={resolutionKey}>{String(values.ResolutionWidth)} × {String(values.ResolutionHeight)}</option>{(resolutionPresets[aspect] ?? []).filter(size => size !== resolutionKey).map(size => <option key={size} value={size}>{size.replace('x', ' × ')}</option>)}</select></label></div>}
        {(target === 'dsh' ? [false, true] : [false]).map(isAdvanced => <section key={String(isAdvanced)}><h3>{props.t(isAdvanced ? 'configAdvanced' : 'configDisplay')}</h3><div className={css.grid}>
          {configFields.filter(field => field.key in values && advanced.has(field.key) === isAdvanced).map((field) => {
            const value = values[field.key]
            const label = props.t(`configField${field.key}`)
            const options: readonly string[] | undefined = 'options' in field ? field.options : undefined
            return <label key={field.key} className={css.row}><span>{label}</span>{options
              ? <select value={String(value)} onChange={(event) => { change(field.key, field.key === 'PageSize' ? Number(event.currentTarget.value) : event.currentTarget.value) }}>{options.map(option => <option key={option} value={option}>{/^[0-9]+$/.test(option) ? option : props.t(`configChoice${option}` as SetupHubLocaleKey)}</option>)}</select>
              : typeof value === 'boolean' ? <input type="checkbox" checked={value} onChange={(event) => { change(field.key, event.currentTarget.checked) }} />
                : Array.isArray(value) ? <textarea rows={3} value={value.join('\n')} onChange={(event) => { change(field.key, event.currentTarget.value.split('\n').filter(Boolean)) }} />
                  : <input type={typeof value === 'number' ? 'number' : 'text'} value={String(value)} onWheel={(event) => { if (event.currentTarget.type === 'number') event.currentTarget.blur() }} onChange={(event) => { change(field.key, typeof value === 'number' ? Number(event.currentTarget.value) : event.currentTarget.value) }} />}</label>
          })}
        </div></section>)}
      </fieldset>}
    </div>
    <footer className={css.footer}><span role="status">{busy ? props.t('configSaving') : notice || props.t(dirty ? 'configPending' : 'configClean')}</span><button type="button" className={css.save} disabled={busy || (!dirty && !restartPending)} onClick={() => { void (async () => { if (!dirty || await save()) await restart() })() }}>{props.t(restartPending && !dirty ? 'configRetryRestart' : 'configSave')}</button></footer>
    {decision && <div className={css.backdrop} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) resolveDecision(false) }
      if (event.key === 'Tab') {
        const controls = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
        const index = controls.indexOf(window.document.activeElement as HTMLButtonElement)
        event.preventDefault(); controls[(index + (event.shiftKey ? controls.length - 1 : 1)) % controls.length]?.focus()
      }
    }}><div className={css.dialog} role="dialog" aria-modal="true" aria-label={props.t('configLeaveTitle')}><h3>{props.t('configLeaveTitle')}</h3><p>{props.t('configPending')}</p>{error && <p role="alert">{props.t('configFailed')}</p>}<div>
        <button ref={stayButton} type="button" disabled={busy} onClick={() => { resolveDecision(false) }}>{props.t('configStay')}</button>
        <button type="button" disabled={busy} onClick={() => { if (document) setValues(document.values); resolveDecision(true) }}>{props.t('configDiscard')}</button>
        <button type="button" disabled={busy} onClick={() => { void save().then((saved) => { if (saved) { setNotice(props.t('configSavedLater')); resolveDecision(true) } }) }}>{props.t('configSaveOnly')}</button>
      </div></div></div>}
  </section>
}
