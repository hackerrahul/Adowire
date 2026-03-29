/*
|--------------------------------------------------------------------------
| Configure hook
|--------------------------------------------------------------------------
|
| The configure hook is called when someone runs "node ace configure adowire"
| command. It:
|
|  1. Publishes config/adowire.ts using the config stub
|  2. Registers the wire provider and commands in adonisrc.ts
|  3. Creates scaffold directories (app/adowire, resources/views/adowire)
|  4. Prints next-steps guidance to the developer
|
*/

import type Configure from '@adonisjs/core/commands/configure'
import { stubsRoot } from './stubs/main.js'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export async function configure(command: Configure) {
  const codemods = await command.createCodemods()

  // ── 1. Publish config/adowire.ts ──────────────────────────────────────────
  await codemods.makeUsingStub(stubsRoot, 'config/adowire.stub', {})

  // ── 2. Register provider + commands in adonisrc.ts ────────────────────────
  await codemods.updateRcFile((rcFile) => {
    rcFile.addProvider('adowire/wire_provider')
    rcFile.addCommand('adowire/commands')
  })

  // ── 3. Ensure scaffold directories exist ──────────────────────────────────
  const appRoot =
    command.app.appRoot instanceof URL
      ? fileURLToPath(command.app.appRoot)
      : String(command.app.appRoot)

  await mkdir(join(appRoot, 'app', 'adowire'), { recursive: true })
  await mkdir(join(appRoot, 'resources', 'views', 'adowire'), { recursive: true })

  // ── 4. Next-steps guidance ────────────────────────────────────────────────
  command.logger.success('Adowire configured successfully!')
  command.logger.log('')
  command.logger.log('  Next steps:')
  command.logger.log('    node ace make:adowire counter             # basic component')
  command.logger.log('    node ace make:adowire dashboard --page    # page component')
  command.logger.log('    node ace adowire:list                     # list all components')
  command.logger.log('')
}
