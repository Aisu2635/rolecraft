/**
 * Linear-space wildcard matcher: `*` matches zero or more characters and `?`
 * exactly one. Two-pointer with backtrack-to-last-star, O(n*m) worst case, and
 * no RegExp, so user-supplied patterns cannot cause catastrophic backtracking.
 */
export function globMatch(pattern: string, text: string): boolean {
  let p = 0;
  let t = 0;
  let starP = -1;
  let starT = 0;
  while (t < text.length) {
    const c = pattern[p];
    if (c === "*") {
      starP = p++;
      starT = t;
    } else if (c !== undefined && (c === "?" || c === text[t])) {
      p++;
      t++;
    } else if (starP !== -1) {
      p = starP + 1;
      t = ++starT;
    } else {
      return false;
    }
  }
  while (pattern[p] === "*") p++;
  return p === pattern.length;
}
