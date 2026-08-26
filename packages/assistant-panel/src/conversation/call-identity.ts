/**
 * `value` as JSON with object keys in sorted order at every depth, so two calls
 * carrying equal input render alike whatever order their keys arrived in. Array
 * order is meaningful and is left alone.
 */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, raw: unknown) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return raw;
    const record = raw as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, record[key]])
    );
  });
}

/**
 * The identity two tool calls share when they ask for the very same thing: the
 * tool name and its input, with input keys ordered so key order never changes
 * the identity.
 */
export function callIdentity(name: string, input: unknown): string {
  return `${name} ${stableJson(input)}`;
}
