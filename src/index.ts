import { serve } from '@hono/node-server'

import { app } from '@/app'

const port = Number(process.env['PORT'] ?? 3000)

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Listening on http://localhost:${String(info.port)}`)
})

server.on('error', (err) => {
  console.error('Server failed to start:', err)
  process.exit(1)
})
