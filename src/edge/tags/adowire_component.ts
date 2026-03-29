/**
 * adowire — @adowire('name', { props }) / @end block tag
 *
 * Renders a child wire component embedded inside another Edge template.
 * The outer <div> carries the adowire:id, adowire:name, and adowire:snapshot data
 * attributes that the client-side runtime uses to initialise Alpine.js.
 *
 * Usage in Edge templates:
 *   @adowire('counter', { initialCount: 5 })
 *   @end
 *
 * The tag resolves the component from the ComponentRegistry, mounts it,
 * dehydrates its state into a snapshot, renders its template, and wraps
 * everything in the standard wire wrapper div.
 *
 * For Phase 1 the tag emits a compile-time expression that evaluates the
 * component name + props expression at runtime (inside an async IIFE so we
 * can await the registry / snapshot calls) and writes the resulting HTML.
 *
 * Edge.js v6 tag contract:
 *   block    = true   → has an @end closing tag
 *   seekable = true   → accepts a JS expression (component name + props)
 */

/**
 * Minimal inline shape of an Edge.js v6 TagContract.
 * We avoid importing from 'edge.js/types' because edge.js is a peer
 * dependency that may not be installed in the package's own node_modules.
 */
interface TagContract {
  tagName: string
  block: boolean
  seekable: boolean
  noNewLine: boolean
  compile(parser: any, buffer: any, token: any): void
}

// ─── Runtime expression builder ───────────────────────────────────────────────

/**
 * Build the async-IIFE expression string that is emitted into the compiled
 * Edge template at the call-site of every @adowire tag.
 *
 * Extracting this into its own function keeps the `compile` method short and
 * prevents language-server tools from trying to parse the template literal as
 * TypeScript source code.
 *
 * The generated code runs inside the Edge.js template runtime where `state`
 * is the current template data object.  It expects `state.$adowire` to be
 * an `{ registry, snapshot, config }` object injected by the provider.
 *
 * @param argsArrayExpr  The already-transformed JS array expression for the
 *                       wire args, e.g. `['counter', { initialCount: 5 }]`
 *                       or `[state.activeTab]` for dynamic names.
 *                       Must already have been processed through Edge.js's
 *                       AST rewriter so that template-state identifiers are
 *                       prefixed with `state.`.
 */
function buildWireIife(argsArrayExpr: string): string {
  const lines: string[] = [
    'await (async () => {',
    '  const __wireArgs = ' + argsArrayExpr + ';',
    '  const __wireName = __wireArgs[0];',
    '  const __wireProps = __wireArgs[1] ?? {};',
    '  const __adowire = state.$adowire;',
    '  if (!__adowire) {',
    "    return '<!-- adowire: $adowire not found in template state -->';",
    '  }',
    '  const { registry, snapshot: snapshotManager, config, edge: __edge, devProxy: __maybeDevProxy } = __adowire;',
    '  const __component = registry.make(__wireName);',
    '  __component.$name = __wireName;',
    '  __component.$config = config;',
    "  // Auto-fill matching public properties from props (like Livewire's auto-prop assignment).",
    '  // Any prop key whose name matches a public component property is pre-assigned BEFORE',
    '  // mount() runs. Developers can still override in mount() if needed.',
    '  const __publicKeys = Object.keys(__component.$getPublicState());',
    '  for (const [__pk, __pv] of Object.entries(__wireProps)) {',
    '    if (__publicKeys.includes(__pk)) {',
    '      __component[__pk] = __pv;',
    '    }',
    '  }',
    '  await __component.mount(__wireProps);',
    '  const __snapshot = await snapshotManager.dehydrate(__component);',
    '  __component.$id = __snapshot.memo.id;',
    // Render the component template directly via the Edge instance stored in
    // $adowire.  We cannot call __component.render() because that method
    // resolves Edge from $ctx.containerResolver which is not available during
    // initial SSR from the @adowire tag.  Using the same Edge singleton that the
    // provider already configured guarantees the template is found and globals
    // (like $adowire itself) are available in the child template.
    '  const __viewName = `${config.viewPrefix ?? "adowire"}/${__wireName.replace(/\\./g, "/")}`;',
    // Resolve @Computed properties for the template data (they are excluded
    // from $getPublicState() and the snapshot — like Livewire 4, they are
    // derived fresh each request and only injected into view data).
    '  const __computedKeys = Reflect.getMetadata("adowire:computed", Object.getPrototypeOf(__component)) || [];',
    '  const __computedData = {};',
    '  for (const __ck of __computedKeys) { __computedData[__ck] = await __component.$resolveComputed(__ck); }',
    '  const __viewData = { ...__component.$getPublicState(), ...__computedData, $errors: __component.$errors || {}, $component: __component };',
    '  const __finalData = typeof __maybeDevProxy === "function" ? __maybeDevProxy(__viewData, __wireName) : __viewData;',
    '  const __html = await __edge.render(__viewName, __finalData);',
    "  const __snapshotJson = JSON.stringify(__snapshot).replace(/'/g, '&#39;');",
    '  const __wrapper = (',
    '    `<div` +',
    '    ` adowire:id="${__snapshot.memo.id}"` +',
    '    ` adowire:name="${__wireName}"` +',
    "    ` adowire:snapshot='${__snapshotJson}'` +",
    '    `>${__html}</div>`',
    '  );',
    '  const __layout = __component.$getLayout();',
    '  if (__layout) {',
    '    const __title = __component.$getTitle();',
    '    const __layoutData = { $body: __wrapper, $title: __title };',
    '    return await __edge.render(__layout.name, __layoutData);',
    '  }',
    '  return __wrapper;',
    '})()',
  ]
  return lines.join('\n')
}

// ─── Tag definition ───────────────────────────────────────────────────────────

export const adowireComponentTag: TagContract = {
  tagName: 'adowire',

  /**
   * Block tag — has an opening @adowire(...) and a closing @end.
   */
  block: true,

  /**
   * Accepts a JS expression (the component name and optional props).
   */
  seekable: true,

  /**
   * Do not emit a trailing newline after the opening tag.
   */
  noNewLine: true,

  compile(parser, buffer, token) {
    /**
     * The raw JS expression provided between the parentheses, e.g.:
     *   'counter', { initialCount: 5 }
     *   activeTab                         ← template-state identifier
     *   'examples.components.' + tabSlug  ← expression using state vars
     */
    const rawExpression: string = (token.properties.jsArg as string).trim() || "''"

    // Transform the args through Edge.js's AST rewriter so that bare
    // template-state identifiers (e.g. `activeTab`) become `state.activeTab`
    // in the compiled output — Edge.js v6 does not use `with(state)`, it
    // rewrites all identifiers to `state.<name>` at compile time.
    //
    // We wrap the comma-separated args in `[…]` so they parse as a single
    // ArrayExpression node, run `transformAst` on that node, then stringify
    // the result back to JS source.  The output is the full array literal
    // (e.g. `[state.activeTab]` or `['counter', { initialCount: 5 }]`).
    const ast = parser.utils.generateAST(`[${rawExpression}]`, token.loc, token.filename)
    const transformed = parser.utils.transformAst(ast, token.filename, parser)
    const argsArrayExpr: string = parser.utils.stringify(transformed)

    /**
     * Emit an async IIFE expression that:
     *  1. Reads $adowire from the current Edge state (injected by the provider)
     *  2. Parses the first element as the component name, rest as props
     *  3. Makes the component, mounts it, dehydrates the snapshot
     *  4. Renders the component template
     *  5. Returns the wrapper div with the snapshot as a data attribute
     *
     * The body of the @adowire...@end block is intentionally ignored in
     * Phase 1 — the component is always rendered server-side from its own
     * Edge template. The block is preserved in the AST for future use
     * (e.g. named slots).
     */
    buffer.outputExpression(
      buildWireIife(argsArrayExpr),
      token.filename,
      token.loc.start.line,
      false
    )

    /**
     * Walk the children so Edge does not throw on unrecognised nodes inside
     * the block.  Their compiled output is discarded in Phase 1.
     *
     * Edge.js v6 uses parser.processToken() — NOT parser.stringify() which
     * does not exist in v6.
     */
    for (const child of token.children) {
      parser.processToken(child, buffer)
    }
  },
}
