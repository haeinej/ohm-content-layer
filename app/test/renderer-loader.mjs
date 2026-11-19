const renderer = new URL("../../vault/feed/render.mjs", import.meta.url).href
const dependencies = new Set(["markdown-it", "markdown-it-footnote"])

export function resolve(specifier, context, nextResolve) {
  // The app owns these dependencies in its standalone install, as it does in Vite.
  if (context.parentURL === renderer && dependencies.has(specifier)) {
    return nextResolve(specifier, { ...context, parentURL: import.meta.url })
  }
  return nextResolve(specifier, context)
}
