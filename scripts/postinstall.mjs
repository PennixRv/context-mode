#!/usr/bin/env node
// Installation validates this package; host configuration belongs to lifecycle.
const [major, minor] = process.versions.node.split(".").map(Number);
if (process.platform === "linux" && !process.versions.bun && (major < 22 || (major === 22 && minor < 5))) {
  console.error("context-mode requires Node.js >= 22.5 on Linux (upstream issues/564).");
  process.exit(1);
}
// Dependencies run their own install scripts. Do not repair another installation.
console.error("context-mode: package installed; manage integration through pennix-component-lifecycle.");
