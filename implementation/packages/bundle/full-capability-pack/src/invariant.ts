/**
 * Package-owned invariant companion for the full-capability bundle.
 * @module @deepseek-ai/dsh-full-capability-pack/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-full-capability-pack'

/** Cordis companion plugin name. */
export const name = 'full-capability-pack-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: the package carries only a static patch list. */
const install: InvariantInstaller = () => {}

/**
 * Register the package's invariant companion.
 * @param ctx - Context carrying the invariant registry.
 * @returns the installed registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
