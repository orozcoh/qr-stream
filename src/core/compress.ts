async function pipe(bytes: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Compress with gzip, but only if it actually pays for itself. */
export async function gzipIfSmaller(bytes: Uint8Array): Promise<{ data: Uint8Array; gzipped: boolean }> {
  const compressed = await pipe(bytes, new CompressionStream('gzip'));
  if (compressed.length < bytes.length) return { data: compressed, gzipped: true };
  return { data: bytes, gzipped: false };
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  return pipe(bytes, new DecompressionStream('gzip'));
}
