/**
 * Package-owned invariant companion for the Setup manifest protocol.
 * @module @deepseek-ai/dsh-setup-protocol/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-setup-protocol'

/** Cordis companion plugin name. */
export const name = 'setup-protocol-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package validates immutable external manifests;
 * its acceptance relation is covered by the protocol test suite.
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
