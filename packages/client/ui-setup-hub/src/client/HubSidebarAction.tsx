import { IconCordisPluginOutline14, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './HubSidebarAction.module.css'

/** Sidebar entry into the existing HUB, in expanded and collapsed layouts. */
export type HubSidebarActionProps = PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'settings.setupHub'> & { openHub: () => void }

/** Render the localized market entry without replacing the sidebar or Settings. */
export function HubSidebarAction({ wide, openHub, t }: HubSidebarActionProps) {
  return (
    <Tooltip label={t('marketEntry')} disabled={wide} side="right">
      <button
        type="button"
        className={css.entry}
        data-wide={wide}
        aria-label={t('marketEntry')}
        onClick={openHub}
      >
        <IconCordisPluginOutline14 size={wide ? 16 : 18} />
        {wide ? <span className={css.label}>{t('marketEntry')}</span> : null}
      </button>
    </Tooltip>
  )
}
