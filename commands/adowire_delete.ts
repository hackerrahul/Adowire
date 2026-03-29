import { BaseCommand, args, flags } from '@adonisjs/core/ace'
import { unlink, access } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export default class AdowireDelete extends BaseCommand {
  static commandName = 'adowire:delete'
  static description = 'Delete a wire component class and its Edge.js view template'
  static options = { allowUnknownFlags: false }

  @args.string({ description: 'Component name to delete (e.g. counter, posts/create)' })
  declare name: string

  @flags.boolean({ description: 'Skip confirmation prompt', alias: 'f' })
  declare force: boolean

  async run() {
    const appRoot =
      this.app.appRoot instanceof URL ? fileURLToPath(this.app.appRoot) : String(this.app.appRoot)

    const g = this.app.generators
    const entity = g.createEntity(this.name)

    // Flat names produce './' — normalise to '' so join() works cleanly
    const normPath = (p: string) => (p === './' ? '' : p)

    const classPath = join(
      appRoot,
      'app',
      'adowire',
      normPath(entity.path),
      g.modelFileName(entity.name)
    )
    const viewPath = join(
      appRoot,
      'resources',
      'views',
      'adowire',
      normPath(entity.path),
      g.viewFileName(entity.name)
    )

    // ── Confirm unless --force ────────────────────────────────────────────────
    if (!this.force) {
      const confirmed = await this.prompt.confirm(
        `Delete component "${this.name}" and its view? This cannot be undone.`
      )
      if (!confirmed) {
        this.logger.info('Aborted.')
        return
      }
    }

    // ── Delete helper ─────────────────────────────────────────────────────────
    const tryDelete = async (filePath: string, label: string) => {
      try {
        await access(filePath)
        await unlink(filePath)
        this.logger.action(`delete ${filePath}`).succeeded()
      } catch (err: any) {
        if (err.code === 'ENOENT') {
          this.logger.warning(`${label} not found: ${filePath}`)
        } else {
          this.logger.error(`Failed to delete ${label}: ${err.message}`)
        }
      }
    }

    await tryDelete(classPath, 'class')
    await tryDelete(viewPath, 'view')
  }
}
