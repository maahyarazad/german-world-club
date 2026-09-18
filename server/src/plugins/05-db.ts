import fp from 'fastify-plugin'
import { createPool } from '../db/pool.ts'

export default fp(
  async function db(app, opts) {
    const pool = createPool(opts.env)
    app.decorate('pg', pool)
    app.decorate('dbHealthy', async () => {
      try {
        await pool.query('SELECT 1')
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err.message }
      }
    })
    app.addHook('onClose', async () => {
      await pool.end()
    })
  },
  { name: 'db' },
)
