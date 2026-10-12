/** Internal viewport cancellation; export and direct renders opt in explicitly. */
export function checkRenderCurrent(isCancelled?: () => boolean): void {
  if (isCancelled?.()) throw new DOMException("Render superseded.", "AbortError");
}
