// Minimal Supabase-compatible gateway: supabase-js talks to a single project
// URL, so /auth/v1 and /rest/v1 have to arrive on one port. Routes each prefix
// to the standalone GoTrue and PostgREST processes.
import http from 'node:http'

const ROUTES = [
  ['/auth/v1', 9999],
  ['/rest/v1', 30000],
]

const hopByHop = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
])

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS, HEAD',
  'access-control-allow-headers':
    'authorization, apikey, content-type, x-client-info, x-supabase-api-version, prefer, range, accept-profile, content-profile, x-supabase-authorization',
  'access-control-expose-headers': 'content-range, x-total-count, x-supabase-api-version',
  'access-control-max-age': '3600',
}

const server = http.createServer((req, res) => {
  // Hosted Supabase answers CORS at the gateway; there is no Kong here, so the
  // browser app's cross-origin calls to /auth/v1 and /rest/v1 need it here.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    res.end()
    return
  }

  const route = ROUTES.find(([prefix]) => req.url.startsWith(prefix))
  if (!route) {
    res.writeHead(404, { 'content-type': 'application/json', ...CORS_HEADERS })
    res.end(JSON.stringify({ message: 'Not found' }))
    return
  }
  const [prefix, port] = route
  const headers = { ...req.headers, host: `127.0.0.1:${port}` }
  for (const name of hopByHop) delete headers[name]

  // Kong strips the service prefix before the request reaches the upstream,
  // so PostgREST sees /recipes and GoTrue sees /health.
  const path = req.url.slice(prefix.length) || '/'

  const upstream = http.request(
    { host: '127.0.0.1', port, path, method: req.method, headers },
    (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, { ...upRes.headers, ...CORS_HEADERS })
      upRes.pipe(res)
    },
  )
  upstream.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'application/json', ...CORS_HEADERS })
    res.end(JSON.stringify({ message: err.message }))
  })
  req.pipe(upstream)
})

server.listen(54321, '127.0.0.1', () => console.log('gateway on 54321'))