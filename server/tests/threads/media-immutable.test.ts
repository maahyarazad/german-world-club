import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { hasDatabase } from '../helpers/db.ts'
import { buildSocialApp, resetSocial, member, uploadPhoto } from './social-helpers.ts'
import type { GwcApp } from '../../src/app.ts'
import type { Member } from './social-helpers.ts'

/**
 * Post media is part of the post (research R4, data-model §2.2), and the
 * database — not the API — is what makes that true (Principle IV).
 */
describe.skipIf(!hasDatabase)('post media is immutable', () => {
  let app: GwcApp
  let anna: Member
  let assetId: string

  beforeAll(async () => { app = await buildSocialApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetSocial(app)
    anna = await member(app, 'Anna')
    assetId = (await uploadPhoto(app, anna.headers)).id
  })

  /** Run statements in one transaction on a dedicated connection. */
  const inTransaction = async (fn: (q: (sql: string, v?: unknown[]) => Promise<any>) => Promise<void>) => {
    const client = await app.pg.connect()
    try {
      await client.query('BEGIN')
      await fn((sql, v) => client.query(sql, v))
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }

  it('accepts media written in the transaction that creates the post', async () => {
    await inTransaction(async (q) => {
      const { rows } = await q(`INSERT INTO thread_posts (author_id, body) VALUES ($1, '') RETURNING id`, [anna.id])
      await q('INSERT INTO thread_post_media (post_id, asset_id, position) VALUES ($1, $2, 0)', [rows[0].id, assetId])
    })
    const { rows } = await app.pg.query('SELECT count(*)::int AS n FROM thread_post_media')
    expect(rows[0].n).toBe(1)
  })

  it('refuses media attached in any later transaction', async () => {
    const { rows } = await app.pg.query(`INSERT INTO thread_posts (author_id, body) VALUES ($1, 'Text') RETURNING id`, [anna.id])
    await expect(app.pg.query('INSERT INTO thread_post_media (post_id, asset_id, position) VALUES ($1, $2, 0)', [rows[0].id, assetId]))
      .rejects.toThrow(/transaction that creates the post/)
  })

  it('refuses changing or removing media once published', async () => {
    let postId = ''
    await inTransaction(async (q) => {
      const { rows } = await q(`INSERT INTO thread_posts (author_id, body) VALUES ($1, 'x') RETURNING id`, [anna.id])
      postId = rows[0].id
      await q('INSERT INTO thread_post_media (post_id, asset_id, position) VALUES ($1, $2, 0)', [postId, assetId])
    })
    await expect(app.pg.query('UPDATE thread_post_media SET position = 1 WHERE post_id = $1', [postId])).rejects.toThrow(/not changed/)
    await expect(app.pg.query('DELETE FROM thread_post_media WHERE post_id = $1', [postId])).rejects.toThrow(/not changed/)
  })

  it('refuses at COMMIT a post with neither text nor media', async () => {
    await expect(app.pg.query(`INSERT INTO thread_posts (author_id, body) VALUES ($1, '   ')`, [anna.id]))
      .rejects.toThrow(/neither text nor media/)
    // Counter-assertion: the same empty body commits with one media row.
    await expect(inTransaction(async (q) => {
      const { rows } = await q(`INSERT INTO thread_posts (author_id, body) VALUES ($1, '') RETURNING id`, [anna.id])
      await q('INSERT INTO thread_post_media (post_id, asset_id, position) VALUES ($1, $2, 0)', [rows[0].id, assetId])
    })).resolves.toBeUndefined()
  })

  it('refuses rewriting what a post quotes or answers', async () => {
    const { rows: [a] } = await app.pg.query(`INSERT INTO thread_posts (author_id, body) VALUES ($1, 'a') RETURNING id`, [anna.id])
    const { rows: [b] } = await app.pg.query(`INSERT INTO thread_posts (author_id, body) VALUES ($1, 'b') RETURNING id`, [anna.id])
    await expect(app.pg.query('UPDATE thread_posts SET quote_of_id = $2 WHERE id = $1', [b.id, a.id]))
      .rejects.toThrow(/not edited after publication/)
  })
})
