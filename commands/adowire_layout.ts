import { BaseCommand, flags } from '@adonisjs/core/ace'
import { writeFile, mkdir, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Default layout template — written verbatim, bypasses tempura so Edge
// expressions like {{ $title }} and {{{ $body }}} are preserved literally.
function layoutTemplate(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{ $title ?? 'App' }}</title>
  @adowireStyles
</head>
<body>
  {{{ $body }}}
  @adowireScripts
</body>
</html>
`
}

export default class AdowireLayout extends BaseCommand {
  static commandName = 'adowire:layout'
  static description =
    'Create the default Adowire layout template (resources/views/layouts/adowire.edge)'
  static options = { allowUnknownFlags: false }

  @flags.string({
    description: 'Layout name without extension (default: adowire)',
    alias: 'n',
  })
  declare name: string

  @flags.boolean({
    description: 'Overwrite the layout if it already exists',
    alias: 'f',
  })
  declare force: boolean

  async run() {
    const appRoot =
      this.app.appRoot instanceof URL ? fileURLToPath(this.app.appRoot) : String(this.app.appRoot)

    const layoutName = this.name ?? 'adowire'
    const destPath = join(appRoot, 'resources', 'views', 'layouts', `${layoutName}.edge`)

    // Check for existing file unless --force
    if (!this.force) {
      try {
        await access(destPath)
        this.logger.warning(`Layout already exists: ${destPath}  (use --force to overwrite)`)
        return
      } catch {
        // File does not exist — proceed
      }
    }

    await mkdir(dirname(destPath), { recursive: true })
    await writeFile(destPath, layoutTemplate(), 'utf-8')
    this.logger.action(`create ${destPath}`).succeeded()
    this.logger.log('')
    this.logger.log('  Add the layout to a page component:')
    this.logger.log(`    @Layout('layouts/${layoutName}')`)
    this.logger.log('')
    this.logger.log('  Or set it as the default in config/adowire.ts:')
    this.logger.log(`    defaultLayout: 'layouts/${layoutName}'`)
    this.logger.log('')
  }
}
