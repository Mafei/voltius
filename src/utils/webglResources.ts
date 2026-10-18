/** Context restoration invalidates old resource handles. addon-webgl 0.19
 * disposes its old renderers after restoration, when deleting those handles
 * produces INVALID_OPERATION in WebKit. Skip invalid handles (already freed
 * by the context reset), while disposing every live resource normally. */
export function guardWebglResourceDisposal(gl: WebGL2RenderingContext): () => void {
  const operations = [
    ["deleteProgram", "isProgram"],
    ["deleteBuffer", "isBuffer"],
    ["deleteTexture", "isTexture"],
  ] as const;
  const originals = operations.map(([remove]) => ({ remove, descriptor: Object.getOwnPropertyDescriptor(gl, remove) }));
  for (const [remove, contains] of operations) {
    const dispose = gl[remove].bind(gl), valid = gl[contains].bind(gl);
    gl[remove] = (resource: WebGLProgram | WebGLBuffer | WebGLTexture | null) => {
      if (resource === null || valid(resource)) dispose(resource);
    };
  }
  return () => {
    for (const { remove, descriptor } of originals) {
      if (descriptor) Object.defineProperty(gl, remove, descriptor); else delete (gl as Partial<WebGL2RenderingContext>)[remove];
    }
  };
}
