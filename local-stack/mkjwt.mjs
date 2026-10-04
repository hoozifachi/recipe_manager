import crypto from 'node:crypto'
const secret = process.argv[2]
const sub = process.argv[3]
const role = process.argv[4] ?? 'authenticated'
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const now = Math.floor(Date.now() / 1000)
const header = { alg: 'HS256', typ: 'JWT' }
const anon = role === 'anon'
const payload = anon
  ? {
      iss: 'supabase-local',
      ref: 'local',
      role: 'anon',
      iat: now,
      exp: now + 60 * 60 * 24 * 365 * 20,
    }
  : {
      sub,
      aud: 'authenticated',
      role,
      iss: 'supabase-local',
      iat: now,
      exp: now + 3600,
      session_id: crypto.randomUUID(),
      email: 'local@example.com',
    }
const data = `${b64(header)}.${b64(payload)}`
const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url')
console.log(`${data}.${sig}`)
