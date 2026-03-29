/**
 * adowire — @error('field') / @end block tag
 *
 * Renders its body when there are validation errors for the given field,
 * exposing `message` (first error string) and `messages` (full array) inside
 * the block via Edge's `state` object.
 *
 * Usage in Edge templates:
 *   @error('title')
 *     <span class="error">{{ message }}</span>
 *   @enderror
 *
 * The field name can be any JS expression evaluated at runtime.
 *
 * Edge.js v6 tag contract:
 *   block    = true   → has an @end closing tag
 *   seekable = true   → accepts a JS expression (the field name)
 */

/**
 * Minimal inline shape of an Edge.js v6 TagContract.
 */
interface TagContract {
  tagName: string
  block: boolean
  seekable: boolean
  noNewLine: boolean
  compile(parser: any, buffer: any, token: any): void
}

export const errorTag: TagContract = {
  tagName: 'error',

  /**
   * Block tag — has an opening @error('field') and a closing @end.
   */
  block: true,

  /**
   * Accepts a JS expression (the field name).
   */
  seekable: true,

  /**
   * Do not emit a trailing newline after the opening tag.
   */
  noNewLine: true,

  compile(parser, buffer, token) {
    /**
     * The JS expression between the parentheses — the field name, e.g. `'title'`
     * or any runtime expression like `fieldName`.
     */
    const fieldExpr = token.properties.jsArg.trim() || "''"

    /**
     * Use the token's start line number to create unique local variable names,
     * preventing collisions in nested @error blocks.
     */
    const uid = `__wireErr${token.loc.start.line}`

    /**
     * Edge.js v6 resolves {{ message }} as state.message, so we must set
     * variables on the `state` object and restore them after the block.
     *
     * Emits:
     *
     *   {
     *     const __wireErr<line>_all = ((state.$errors ?? {})[<fieldExpr>]) ?? [];
     *     if (__wireErr<line>_all.length > 0) {
     *       const __wireErr<line>_prevMsg = state.message;
     *       const __wireErr<line>_prevMsgs = state.messages;
     *       state.message  = __wireErr<line>_all[0];
     *       state.messages = __wireErr<line>_all;
     *       <children>
     *       state.message  = __wireErr<line>_prevMsg;
     *       state.messages = __wireErr<line>_prevMsgs;
     *     }
     *   }
     */
    buffer.writeStatement(`{`, token.filename, token.loc.start.line)

    buffer.writeStatement(
      `const ${uid}_all = ((state.$errors ?? {})[${fieldExpr}]) ?? [];`,
      token.filename,
      token.loc.start.line
    )

    buffer.writeStatement(`if (${uid}_all.length > 0) {`, token.filename, token.loc.start.line)

    // Save previous values so nested @error blocks don't clobber each other
    buffer.writeStatement(
      `const ${uid}_prevMsg = state.message;`,
      token.filename,
      token.loc.start.line
    )
    buffer.writeStatement(
      `const ${uid}_prevMsgs = state.messages;`,
      token.filename,
      token.loc.start.line
    )

    // Set the variables on state so {{ message }} and {{ messages }} resolve
    buffer.writeStatement(`state.message = ${uid}_all[0];`, token.filename, token.loc.start.line)
    buffer.writeStatement(`state.messages = ${uid}_all;`, token.filename, token.loc.start.line)

    /**
     * Compile all child nodes (the body between @error and @end).
     * Edge.js v6 uses parser.processToken(), NOT parser.stringify().
     */
    for (const child of token.children) {
      parser.processToken(child, buffer)
    }

    // Restore previous values
    buffer.writeStatement(`state.message = ${uid}_prevMsg;`, token.filename, token.loc.start.line)
    buffer.writeStatement(`state.messages = ${uid}_prevMsgs;`, token.filename, token.loc.start.line)

    buffer.writeStatement('}', token.filename, -1)
    buffer.writeStatement('}', token.filename, -1)
  },
}
