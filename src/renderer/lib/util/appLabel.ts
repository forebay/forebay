// Turn a data id/source (e.g. "claude-code") into a display label generically,
// so no specific app name is ever hardcoded in Forebay.
export function humanizeId(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
