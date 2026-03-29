/**
 * adowire client — directive registry
 *
 * Central entry point that registers every adowire:* DOM directive.
 * Import and call `registerDirectives()` once during bootstrap (before any
 * user interaction can occur) so that event delegation listeners are in place
 * for the full lifetime of the page.
 */

import { registerClickDirective } from './click.js'
import { registerSubmitDirective } from './submit.js'
import { registerModelDirective } from './model.js'
import { registerPollDirective } from './poll.js'
import { initLoading } from './loading.js'
import { initCloak, uncloakAll } from './cloak.js'
import { initDirty } from './dirty.js'
import { initShow } from './show.js'

export { initLoading }
export { initCloak, uncloakAll } from './cloak.js'
export { initDirty, applyDirtyState, clearDirtyState } from './dirty.js'
export { initShow, applyShowState } from './show.js'

/**
 * Register all adowire directives.
 *
 * Each directive uses event delegation on `document` so this only needs to
 * be called once — components added dynamically after initial boot are
 * handled automatically.
 *
 * Safe to call multiple times; each individual directive guards against
 * double-registration internally.
 */
export function registerDirectives(): void {
  registerClickDirective()
  registerSubmitDirective()
  registerModelDirective()
  registerPollDirective()
  initLoading()
  initCloak()
  initDirty()
  initShow()
}

/**
 * Post-init hook — call after all components have been mounted to perform
 * one-time reveal operations (e.g. uncloaking).
 */
export function postInitDirectives(): void {
  // initShow() must run before uncloakAll() so adowire:show elements are already
  // in the correct visible/hidden state when the cloak attribute is removed.
  // initShow() is called in registerDirectives() which runs before Adowire.init(),
  // so by the time we reach here every adowire:show has been evaluated. uncloakAll()
  // now safely reveals them in the right state.
  uncloakAll()
}
