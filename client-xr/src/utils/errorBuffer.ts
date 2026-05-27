const MAX_ENTRIES = 20;
const MAX_LENGTH = 500;

const buffer: string[] = [];
let installed = false;

function push(line: string): void {
  if (!line) return;
  const trimmed = line.length > MAX_LENGTH ? `${line.slice(0, MAX_LENGTH)}…` : line;
  buffer.push(`${new Date().toISOString()} ${trimmed}`);
  if (buffer.length > MAX_ENTRIES) buffer.shift();
}

export function installErrorBuffer(): void {
  if (installed) return;
  installed = true;

  const prevOnError = window.onerror;
  window.onerror = (msg, src, line, col, err) => {
    push(`error: ${String(msg)} @ ${src}:${line}:${col}${err?.stack ? `\n${err.stack.split("\n").slice(0, 3).join("\n")}` : ""}`);
    return typeof prevOnError === "function" ? prevOnError.call(window, msg, src, line, col, err) : false;
  };

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const text = reason instanceof Error ? `${reason.message}\n${reason.stack ?? ""}` : String(reason);
    push(`unhandledrejection: ${text}`);
  });

  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      push(`console.error: ${args.map((a) => (a instanceof Error ? a.stack ?? a.message : typeof a === "string" ? a : safeStringify(a))).join(" ")}`);
    } catch {}
    origError(...args);
  };
}

function safeStringify(v: unknown): string {
  try { return JSON.stringify(v); } catch { return String(v); }
}

export function getRecentErrors(): string[] {
  return buffer.slice();
}
