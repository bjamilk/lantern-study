type XhrHeaderTarget = Pick<XMLHttpRequest, 'setRequestHeader'>;

/**
 * Apply authenticated JSON headers exactly once.
 *
 * XMLHttpRequest appends repeated header values. Setting Content-Type from both
 * getAuthHeaders() and the request helper produces
 * "application/json, application/json", which Express does not parse as JSON.
 */
export function applyJsonXhrHeaders(
  xhr: XhrHeaderTarget,
  headers: Record<string, string>
): void {
  for (const [key, value] of Object.entries(headers)) {
    if (!value || key.toLowerCase() === 'content-type') continue;
    xhr.setRequestHeader(key, value);
  }
  xhr.setRequestHeader('Content-Type', 'application/json');
}
