// Push services of the browsers that can install Warren. The server POSTs to a subscription's
// endpoint, so any other URL (an internal address, a stranger's server) is refused.
const PUSH_HOSTS = [
  /^web\.push\.apple\.com$/, // Safari and the installed app on iPhone
  /^fcm\.googleapis\.com$/, // Chrome and Android
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^[a-z0-9-]+\.notify\.windows\.com$/, // Edge
]

export function isPushEndpoint(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  // Browsers hand out canonical URLs; anything the parser had to rewrite (a tab, upper case, a stray
  // newline) is refused, because web-push parses it again with a different parser.
  return url.href === raw && url.protocol === 'https:' && !url.port && !url.username && !url.password
    && PUSH_HOSTS.some(host => host.test(url.hostname))
}
