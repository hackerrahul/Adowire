import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class AdowireList extends BaseCommand {
  static commandName = 'adowire:list'
  static description = 'List all registered Adowire wire components'

  static options: CommandOptions = {
    allowUnknownFlags: false,
  }

  @flags.boolean({ description: 'Output as JSON', alias: 'j' })
  declare json: boolean

  async run() {
    // Resolve the adowire binding — registry is populated during provider boot
    const { registry } = await this.app.container.make('adowire')
    const components = registry.all()

    if (this.json) {
      this.logger.log(
        JSON.stringify(
          components.map((c) => ({ name: c.name, classPath: c.classPath, viewName: c.viewName })),
          null,
          2
        )
      )
      return
    }

    if (components.length === 0) {
      this.logger.warning(
        'No wire components found. Run node ace make:adowire <name> to create one.'
      )
      return
    }

    this.logger.log('')

    const table = this.ui.table()
    table.head(['Name', 'View', 'Class Path'])

    for (const component of components) {
      table.row([
        component.name,
        component.viewName,
        component.classPath || '(manually registered)',
      ])
    }

    table.render()
    this.logger.log('')
    this.logger.log(`  Total: ${components.length} component(s)`)
    this.logger.log('')
  }
}
