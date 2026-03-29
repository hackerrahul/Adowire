import { BaseCommand, args } from '@adonisjs/core/ace'
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export default class AdowireMove extends BaseCommand {
  static commandName = 'adowire:move'
  static description = 'Move or rename a wire component (class + view) and update the class name'
  static options = { allowUnknownFlags: false }

  @args.string({ description: 'Current component name (e.g. counter, posts/create)' })
  declare from: string

  @args.string({ description: 'New component name (e.g. widgets/counter, forms/create)' })
  declare to: string

  async run() {
    const appRoot =
      this.app.appRoot instanceof URL ? fileURLToPath(this.app.appRoot) : String(this.app.appRoot)

    const g = this.app.generators
    const fromEntity = g.createEntity(this.from)
    const toEntity = g.createEntity(this.to)

    // Flatten './' to '' so join() doesn't produce stray dots
    const normPath = (p: string) => (p === './' ? '' : p)

    const fromClassFile = g.modelFileName(fromEntity.name)
    const toClassFile = g.modelFileName(toEntity.name)
    const fromViewFile = g.viewFileName(fromEntity.name)
    const toViewFile = g.viewFileName(toEntity.name)

    const fromClassPath = join(appRoot, 'app', 'adowire', normPath(fromEntity.path), fromClassFile)
    const toClassPath = join(appRoot, 'app', 'adowire', normPath(toEntity.path), toClassFile)

    const fromViewPath = join(
      appRoot,
      'resources',
      'views',
      'adowire',
      normPath(fromEntity.path),
      fromViewFile
    )
    const toViewPath = join(
      appRoot,
      'resources',
      'views',
      'adowire',
      normPath(toEntity.path),
      toViewFile
    )

    const fromClassName = g.modelName(fromEntity.name)
    const toClassName = g.modelName(toEntity.name)

    let movedAny = false

    // ── Move class ────────────────────────────────────────────────────────────
    try {
      let src = await readFile(fromClassPath, 'utf-8')

      // Rename the class declaration in the source
      src = src.replace(new RegExp(`\\bclass\\s+${fromClassName}\\b`, 'g'), `class ${toClassName}`)

      await mkdir(dirname(toClassPath), { recursive: true })
      await writeFile(toClassPath, src, 'utf-8')
      await unlink(fromClassPath)

      this.logger.action(`move ${fromClassPath} → ${toClassPath}`).succeeded()
      movedAny = true
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        this.logger.warning(`Class file not found, skipping: ${fromClassPath}`)
      } else {
        this.logger.error(`Failed to move class file: ${err.message}`)
      }
    }

    // ── Move view ─────────────────────────────────────────────────────────────
    try {
      const viewSrc = await readFile(fromViewPath, 'utf-8')

      await mkdir(dirname(toViewPath), { recursive: true })
      await writeFile(toViewPath, viewSrc, 'utf-8')
      await unlink(fromViewPath)

      this.logger.action(`move ${fromViewPath} → ${toViewPath}`).succeeded()
      movedAny = true
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        this.logger.warning(`View file not found, skipping: ${fromViewPath}`)
      } else {
        this.logger.error(`Failed to move view file: ${err.message}`)
      }
    }

    if (!movedAny) {
      this.logger.error(
        `No files found for component "${this.from}". ` +
          `Expected class at ${fromClassPath} or view at ${fromViewPath}.`
      )
    }
  }
}
