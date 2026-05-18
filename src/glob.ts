const REGEX_META = /[.+^${}()|[\]\\]/g

export function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(REGEX_META, "\\$&")
  const regex = "^" + escaped.replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
  return new RegExp(regex)
}
