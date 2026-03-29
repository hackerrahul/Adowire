import { BaseCommand, flags } from '@adonisjs/core/ace'
import { copyFile, mkdir, access } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stubsRoot } from '../stubs/main.js'

export default class AdowireStubs extends BaseCommand {
  static commandName = 'adowire:stubs'
  static description = 'Publish Adowire stubs to stubs/vendor/adowire/ for customisation'
  static options = { allowUnknownFlags: false }

  @flags.boolean({
    description: 'Overwrite stubs that already exist in the destination',
    alias: 'f',
  })
  declare force: boolean

  async run() {
    const appRoot =
      this.app.appRoot instanceof URL ? fileURLToPath(this.app.appRoot) : String(this.app.appRoot)

    const destDir = join(appRoot, 'stubs', 'vendor', 'adowire')

    // Ensure destination subdirectories exist
    await mkdir(join(destDir, 'make'), { recursive: true })
    await mkdir(join(destDir, 'config'), { recursive: true })

    const stubFiles = [
      'make/component.stub',
      'make/page.stub',
      'make/view.stub',
      'make/layout.stub',
      'config/adowire.stub',
    ]

    let published = 0
    let skipped = 0

    for (const file of stubFiles) {
      const src = join(stubsRoot, file)
      const dest = join(destDir, file)

      // Skip if file already exists and --force is not set
      if (!this.force) {
        try {
          await access(dest)
          this.logger.action(`skip ${dest} (already exists, use --force to overwrite)`).succeeded()
          skipped++
          continue
        } catch {
          // File does not exist — proceed with copy
        }
      }

      try {
        await copyFile(src, dest)
        this.logger.action(`create ${dest}`).succeeded()
        published++
      } catch (err: any) {
        this.logger.error(`Failed to publish ${file}: ${err.message}`)
      }
    }

    this.logger.log('')

    if (published > 0) {
      this.logger.success(`Published ${published} stub(s) to stubs/vendor/adowire/`)
    }

    if (skipped > 0) {
      this.logger.log(`  Skipped ${skipped} stub(s) that already exist. Use --force to overwrite.`)
    }

    this.logger.log('')
    this.logger.log('  After editing, Adowire will automatically prefer your local stubs over')
    this.logger.log('  the package defaults when you run make:adowire or adowire:layout.')
    this.logger.log('')
  }
}
