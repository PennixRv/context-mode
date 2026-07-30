/**
 * Self-contained fetch worker used by ctx_fetch_and_index.
 *
 * The release build bundles this file with Turndown and Domino. It is then
 * copied verbatim into the sandbox script, so marketplace installs never need
 * a runtime node_modules directory or an npm download to fetch HTML.
 */

import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const fs = module.require("node:fs") as typeof import("node:fs");
const dns = module.require("node:dns") as typeof import("node:dns");
const dnsPromises = module.require("node:dns/promises") as typeof import("node:dns/promises");

type IpVerdict = "block" | "private" | "public";

export function classifyFetchIp(rawIp: string): IpVerdict {
  const pctIndex = rawIp.indexOf("%");
  const ip = pctIndex === -1 ? rawIp : rawIp.slice(0, pctIndex);
  const lower = ip.toLowerCase();

  if (lower.includes(":")) {
    const mappedIpv4 = lower.match(/^::ffff:([\d.]+)$/);
    if (mappedIpv4) return classifyFetchIp(mappedIpv4[1]);
    if (lower === "") return "block";
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) {
      return "block";
    }
    if (lower.startsWith("ff")) return "block";
    if (lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd")) return "private";
    return "public";
  }

  if (!ip.includes(".")) return "block";
  const parts = ip.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return "block";
  }

  const [first, second] = parts;
  if (first === 169 && second === 254) return "block";
  if (first === 0 || first >= 224) return "block";
  if (first === 127 || first === 10) return "private";
  if (first === 172 && second >= 16 && second <= 31) return "private";
  if (first === 192 && second === 168) return "private";
  return "public";
}

function rejectBlockedAddress(hostname: string, address: string, strict: boolean): Error | null {
  const verdict = classifyFetchIp(address);
  if (verdict === "block" || (strict && verdict === "private")) {
    return new Error(
      `SSRF blocked at connect-time: ${hostname} resolves to ${address} (${verdict})`,
    );
  }
  return null;
}

function installDnsGuards(strict: boolean): void {
  const originalLookup = dns.lookup;
  dns.lookup = function patchedLookup(hostname: string, options: any, callback?: any): any {
    let resolvedOptions = options;
    let resolvedCallback = callback;
    if (typeof resolvedOptions === "function") {
      resolvedCallback = resolvedOptions;
      resolvedOptions = {};
    }
    if (typeof resolvedOptions === "number") {
      resolvedOptions = { family: resolvedOptions };
    }

    const wantsAll = resolvedOptions?.all;
    const lookupOptions = { ...(resolvedOptions ?? {}), all: true, verbatim: true };
    return originalLookup(hostname, lookupOptions, (error, records) => {
      if (error) return resolvedCallback(error);
      const normalized = Array.isArray(records)
        ? records
        : [{ address: records as unknown as string, family: resolvedOptions?.family ?? 4 }];
      for (const record of normalized) {
        const blocked = rejectBlockedAddress(hostname, record.address, strict);
        if (blocked) return resolvedCallback(blocked);
      }
      return wantsAll
        ? resolvedCallback(null, normalized)
        : resolvedCallback(null, normalized[0].address, normalized[0].family);
    });
  } as typeof dns.lookup;

  const originalPromisesLookup = dnsPromises.lookup;
  (dnsPromises as { lookup: any }).lookup = async function patchedPromisesLookup(
    hostname: string,
    options?: import("node:dns").LookupAllOptions | import("node:dns").LookupOneOptions,
  ): Promise<any> {
    const lookupOptions = { ...(options ?? {}), all: true, verbatim: true } as import("node:dns").LookupAllOptions;
    const records = await originalPromisesLookup(hostname, lookupOptions);
    const normalized = Array.isArray(records) ? records : [records];
    for (const record of normalized) {
      const blocked = rejectBlockedAddress(hostname, record.address, strict);
      if (blocked) throw blocked;
    }
    return options?.all ? normalized : normalized[0];
  };

  for (const name of ["resolve4", "resolve6"] as const) {
    const originalResolve = dns[name];
    dns[name] = function patchedResolve(hostname: string, options: any, callback?: any): any {
      let resolvedOptions = options;
      let resolvedCallback = callback;
      if (typeof resolvedOptions === "function") {
        resolvedCallback = resolvedOptions;
        resolvedOptions = undefined;
      }
      return originalResolve.call(dns, hostname, resolvedOptions ?? {}, (error: Error | null, addresses: any[]) => {
        if (error) return resolvedCallback(error);
        const withTtl = resolvedOptions?.ttl;
        for (const address of addresses) {
          const ip = withTtl ? address.address : address;
          const blocked = rejectBlockedAddress(hostname, ip, strict);
          if (blocked) return resolvedCallback(blocked);
        }
        return resolvedCallback(null, addresses);
      });
    } as typeof dns[typeof name];
  }

  const originalResolve = dns.resolve;
  dns.resolve = function patchedResolve(hostname: string, rrtype: any, callback?: any): any {
    let resolvedType = rrtype;
    let resolvedCallback = callback;
    if (typeof resolvedType === "function") {
      resolvedCallback = resolvedType;
      resolvedType = "A";
    }
    return originalResolve.call(dns, hostname, resolvedType, (error: Error | null, records: any) => {
      if (error) return resolvedCallback(error);
      if ((resolvedType === "A" || resolvedType === "AAAA") && Array.isArray(records)) {
        for (const address of records) {
          const blocked = rejectBlockedAddress(hostname, address, strict);
          if (blocked) return resolvedCallback(blocked);
        }
      }
      return resolvedCallback(null, records);
    });
  } as typeof dns.resolve;
}

function clearProxyEnvironment(): void {
  for (const name of [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "npm_config_proxy",
    "npm_config_https_proxy",
  ]) {
    delete process.env[name];
  }
}

function emitContent(contentType: "html" | "json" | "text", outputPath: string, content: string): void {
  fs.writeFileSync(outputPath, content);
  console.log(`__CM_CT__:${contentType}`);
}

async function fetchWithManualRedirect(initialUrl: string, strict: boolean): Promise<Response> {
  const maximumRedirects = 5;
  let currentUrl = initialUrl;

  for (let redirectCount = 0; redirectCount <= maximumRedirects; redirectCount++) {
    const response = await fetch(currentUrl, { redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    if (redirectCount === maximumRedirects) {
      throw new Error(`SSRF blocked: redirect chain exceeded ${maximumRedirects} hops`);
    }

    let nextUrl: URL;
    try {
      nextUrl = new URL(location, currentUrl);
    } catch {
      throw new Error(`SSRF blocked: invalid redirect Location: ${location}`);
    }
    if (nextUrl.protocol !== "http:" && nextUrl.protocol !== "https:") {
      throw new Error(`SSRF blocked: redirect to non-http(s) scheme ${nextUrl.protocol}`);
    }

    const hostname = nextUrl.hostname.replace(/^\[|\]$/g, "");
    const isIpLiteral = /^[0-9.]+$/.test(hostname) || hostname.includes(":");
    if (isIpLiteral) {
      const blocked = rejectBlockedAddress(hostname, hostname, strict);
      if (blocked) throw blocked;
    } else {
      const records = await dnsPromises.lookup(hostname, { all: true, verbatim: true });
      for (const record of records) {
        const blocked = rejectBlockedAddress(hostname, record.address, strict);
        if (blocked) throw blocked;
      }
    }
    currentUrl = nextUrl.toString();
  }

  throw new Error(`SSRF blocked: redirect chain exceeded ${maximumRedirects} hops`);
}

async function readResponseText(response: Response): Promise<string> {
  const maximumFetchBytes = 50 * 1024 * 1024;
  const contentLength = Number.parseInt(response.headers.get("content-length") ?? "0", 10);
  if (contentLength > maximumFetchBytes) {
    throw new Error(`Response too large: Content-Length ${contentLength} exceeds ${maximumFetchBytes}`);
  }

  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maximumFetchBytes) {
    throw new Error(`Response too large: ${Buffer.byteLength(text, "utf8")} bytes exceeds ${maximumFetchBytes}`);
  }
  return text;
}

export async function runFetchWorker(url: string, outputPath: string, strict: boolean): Promise<void> {
  clearProxyEnvironment();
  installDnsGuards(strict);

  const response = await fetchWithManualRedirect(url, strict);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") || contentType.includes("+json")) {
    const text = await readResponseText(response);
    try {
      emitContent("json", outputPath, JSON.stringify(JSON.parse(text), null, 2));
    } catch {
      emitContent("text", outputPath, text);
    }
    return;
  }

  if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
    const html = await readResponseText(response);
    const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
    turndown.use(gfm);
    turndown.remove(["script", "style", "nav", "header", "footer", "noscript"]);
    emitContent("html", outputPath, turndown.turndown(html));
    return;
  }

  emitContent("text", outputPath, await readResponseText(response));
}

// Not used by production code. The properties let the unit suite exercise the
// exact converters embedded in the release worker rather than development
// node_modules paths.
export const __testOnlyTurndownService = TurndownService;
export const __testOnlyGfm = gfm;
