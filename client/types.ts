/**
 * adowire client — shared type definitions
 * Mirrors the relevant server-side types from src/types.ts for use in browser code.
 */

// ─── Snapshot ────────────────────────────────────────────────────────────────

export interface WireSnapshot {
  state: Record<string, any>
  memo: WireMemo
  checksum: string
}

export interface WireMemo {
  name: string
  id: string
  children?: Record<string, { id: string; tag: string }>
  errors: Record<string, string[]>
  locale?: string
  lazy?: boolean
  lazyLoaded?: boolean
  path?: string
  method?: string
  scrollTo?: boolean
  [key: string]: any
}

// ─── Calls & Updates ─────────────────────────────────────────────────────────

export interface WireCall {
  method: string
  params: any[]
}

// ─── Effects ─────────────────────────────────────────────────────────────────

export interface WireEffect {
  html?: string
  redirect?: string
  dispatches?: WireDispatch[]
  js?: string[]
  streams?: WireStream[]
  dirty?: string[]
  download?: WireDownload
  title?: string
  xjs?: string[]
}

export interface WireDispatch {
  name: string
  params: any[]
  to?: string
  up?: boolean
  self?: boolean
}

export interface WireStream {
  name: string
  content: string
  replace?: boolean
}

export interface WireDownload {
  name: string
  url: string
}

// ─── Request / Response ───────────────────────────────────────────────────────

export interface WireRequestPayload {
  components: Array<{
    snapshot: WireSnapshot
    calls: WireCall[]
    updates: Record<string, any>
  }>
}

export interface WireComponentResponse {
  snapshot: WireSnapshot
  effects: WireEffect
}

export interface WireResponse {
  components: WireComponentResponse[]
}

// ─── Global augmentations ─────────────────────────────────────────────────────

declare global {
  interface Window {
    Alpine?: any
    Adowire?: {
      version: string
      endpoint?: string
      components: Map<string, any>
      init(): void
      find(id: string): any | undefined
      [key: string]: any
    }
  }
}
