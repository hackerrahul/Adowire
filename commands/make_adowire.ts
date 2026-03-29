import { BaseCommand, args, flags } from '@adonisjs/core/ace'
import { stubsRoot } from '../stubs/main.js'

export default class MakeAdowire extends BaseCommand {
  static commandName = 'make:adowire'
  static description = 'Create a new Adowire wire component class and its Edge.js view template'
  static options = { allowUnknownFlags: false }

  @args.string({ description: 'Component name (e.g. counter, posts/create)' })
  declare name: string

  @flags.boolean({
    description: 'Generate a page component with @Layout and @Title decorators',
    alias: 'p',
  })
  declare page: boolean

  @flags.boolean({
    description: 'Generate the component class only (skip the Edge.js view)',
    alias: 'c',
  })
  declare class: boolean

  @flags.boolean({
    description: 'Generate the Edge.js view only (skip the component class)',
    alias: 'v',
  })
  declare view: boolean

  async run() {
    const codemods = await this.createCodemods()
    const entity = this.app.generators.createEntity(this.name)

    // --class and --view together = same as default (both)
    const makeClass = !this.view || this.class
    const makeView = !this.class || this.view

    // 1. Generate the component class (page or basic)
    if (makeClass) {
      const stubPath = this.page ? 'make/page.stub' : 'make/component.stub'
      await codemods.makeUsingStub(stubsRoot, stubPath, { entity })
    }

    // 2. Generate the Edge.js view template
    if (makeView) {
      await codemods.makeUsingStub(stubsRoot, 'make/view.stub', { entity })
    }
  }
}
