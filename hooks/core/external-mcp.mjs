const CONTEXT_MODE_MCP_SERVERS = new Set([
  "context-mode",
  "context_mode",
  "plugin_context-mode_context-mode",
  "plugin_context_mode_context_mode",
]);

/**
 * Return true for one of context-mode's explicitly registered `ctx_*` MCP
 * tool forms. Server ownership is exact: a substring match would let an
 * external server such as `my-context-mode-server` bypass isolation.
 */
export function isContextModeMcpToolName(toolName) {
  const raw = String(toolName ?? "");

  if (raw.startsWith("mcp__")) {
    const remainder = raw.slice(5);
    const separator = remainder.indexOf("__");
    if (separator <= 0) return false;
    const server = remainder.slice(0, separator);
    const tool = remainder.slice(separator + 2);
    return CONTEXT_MODE_MCP_SERVERS.has(server) && tool.startsWith("ctx_");
  }

  if (raw.startsWith("MCP:")) {
    return raw.slice(4).startsWith("ctx_");
  }

  if (raw.startsWith("@")) {
    const separator = raw.indexOf("/");
    if (separator <= 1) return false;
    const server = raw.slice(1, separator);
    const tool = raw.slice(separator + 1);
    return CONTEXT_MODE_MCP_SERVERS.has(server) && tool.startsWith("ctx_");
  }

  return false;
}

/**
 * Return true for an MCP tool owned by another server.
 *
 * Hook matchers are not uniformly enforced across clients, so capture hooks
 * use this guard as a second, non-bypassable isolation boundary. Bare
 * `ctx_*` names are handled by the normal context-mode routing path; this
 * helper only classifies names that carry an MCP namespace.
 */
export function isExternalMcpToolName(toolName) {
  const raw = String(toolName ?? "");

  if (raw.startsWith("mcp__")) {
    const remainder = raw.slice(5);
    const separator = remainder.indexOf("__");
    return separator > 0 && remainder.slice(separator + 2).length > 0
      ? !isContextModeMcpToolName(raw)
      : remainder.length > 0;
  }

  if (raw.startsWith("MCP:")) {
    const tool = raw.slice(4);
    return tool.length > 0 && !isContextModeMcpToolName(raw);
  }

  if (raw.startsWith("@") && raw.includes("/")) {
    const separator = raw.indexOf("/");
    const server = raw.slice(1, separator);
    const tool = raw.slice(separator + 1);
    return server.length > 0 && tool.length > 0 && !isContextModeMcpToolName(raw);
  }

  return false;
}
