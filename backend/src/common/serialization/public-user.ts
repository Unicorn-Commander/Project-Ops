/** Preserve domain payloads while removing credentials from full Prisma User records. */
export function publicUserPayload(value: any): any {
  if (Array.isArray(value)) return value.map(publicUserPayload);
  if (!value || typeof value !== 'object') return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const isUser =
    typeof value.id === 'string' &&
    typeof value.email === 'string' &&
    typeof value.username === 'string';
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) => !isUser || (key !== 'password' && key !== 'keycloakId' && !key.startsWith('__')),
      )
      .map(([key, item]) => [key, publicUserPayload(item)]),
  );
}

/** MCP's HTTP stream bypasses Nest response serialization; JSON text needs the same projection. */
export function publicMcpUserPayload(value: any): any {
  const result = publicUserPayload(value);
  if (!result || !Array.isArray(result.content)) return result;
  return {
    ...result,
    content: result.content.map((block: any) => {
      if (block?.type !== 'text' || typeof block.text !== 'string') return block;
      try {
        return { ...block, text: JSON.stringify(publicUserPayload(JSON.parse(block.text))) };
      } catch {
        return block;
      }
    }),
  };
}
