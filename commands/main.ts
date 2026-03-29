import { readFile } from 'node:fs/promises'
import MakeAdowire from './make_adowire.js'
import AdowireList from './adowire_list.js'
import AdowireLayout from './adowire_layout.js'
import AdowireMove from './adowire_move.js'
import AdowireDelete from './adowire_delete.js'
import AdowireStubs from './adowire_stubs.js'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CommandMetaData {
  commandName: string
  description: string
  help: string
  namespace: string | null
  aliases: string[]
  flags: {
    name: string
    flagName: string
    required: boolean
    type: string
    description: string
    alias?: string
    default?: any
  }[]
  args: {
    name: string
    argumentName: string
    required: boolean
    description: string
    type: string
  }[]
  options: Record<string, any>
  filePath: string
}

// ─── In-memory cache ──────────────────────────────────────────────────────────

let commandsMetaData: CommandMetaData[] | undefined

// ─── Command map ──────────────────────────────────────────────────────────────
// Since all commands are bundled into this single chunk by tsdown, we resolve
// command constructors from an inline map rather than dynamic file imports.

const COMMAND_MAP: Record<string, { new (...args: any[]): any }> = {
  'make:adowire': MakeAdowire,
  'adowire:list': AdowireList,
  'adowire:layout': AdowireLayout,
  'adowire:move': AdowireMove,
  'adowire:delete': AdowireDelete,
  'adowire:stubs': AdowireStubs,
}

// ─── Loader interface ─────────────────────────────────────────────────────────

/**
 * Returns the metadata for all Adowire Ace commands.
 * The metadata is read from the co-located commands.json manifest on the
 * first call and cached for subsequent calls.
 */
export async function getMetaData(): Promise<CommandMetaData[]> {
  if (commandsMetaData) {
    return commandsMetaData
  }

  const commandsIndex = await readFile(new URL('./commands.json', import.meta.url), 'utf-8')
  commandsMetaData = JSON.parse(commandsIndex).commands as CommandMetaData[]

  return commandsMetaData
}

/**
 * Returns the command constructor for the given metadata entry.
 * Returns `null` if the command cannot be found.
 */
export async function getCommand(
  metaData: Pick<CommandMetaData, 'commandName'>
): Promise<{ new (...args: any[]): any } | null> {
  return COMMAND_MAP[metaData.commandName] ?? null
}
