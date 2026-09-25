// Effect's `.env` grammar, kept so v1 and v2 read the same files the same way: `export` is
// allowed, quotes are stripped, `\n` expands only inside double quotes, and `$` stays literal.
const LINE =
  /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/gm;

export const parse = (text: string): Record<string, string> => {
  const vars: Record<string, string> = {};
  for (const match of text.replace(/\r\n?/g, "\n").matchAll(LINE)) {
    const key = match[1];
    if (key === undefined) {
      continue;
    }
    const raw = (match[2] ?? "").trim();
    const unquoted = raw.replace(/^(['"`])([\s\S]*)\1$/, "$2");
    vars[key] = raw.startsWith('"')
      ? unquoted.replace(/\\n/g, "\n").replace(/\\r/g, "\r")
      : unquoted;
  }
  return vars;
};
