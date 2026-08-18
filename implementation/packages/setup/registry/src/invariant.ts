/**
 * Package-owned invariant companion for the Setup registry.
 * @module @deepseek-ai/dsh-setup-registry/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-setup-registry'

/** Cordis companion plugin name. */
export const name = 'setup-registry-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: registry state is immutable after parsing and is
 * validated by the registry test suite at its external JSON boundary.
 */
const install: InvariantInstaller = () => {}

/**
 * Register the package's invariant companion.
 * @param ctx - Context carrying the invariant registry.
 * @returns the installed registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
