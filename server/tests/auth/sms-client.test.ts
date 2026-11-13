import { describe, it, expect, vi, afterEach } from 'vitest'
import { createSmsClient, DEFAULT_ORIGIN } from '../../src/integrations/sms.ts'
import type { SmsGlobalFactory } from '../../src/integrations/sms.ts'

/**
 * The SMSGlobal client (feature 023), with the SDK replaced — no network.
 *
 * Two defects this pins: a rejected send was swallowed and reported as sent
 * (so a member waited for a code that never came), and the sender was written
 * into the code instead of read from SMSGLOBAL_ORIGIN.
 */

type Payload = { origin: string; destination: string; message: string }

/** A stand-in for `require('smsglobal')(key, secret)`. */
const fakeSdk = (send: (payload: Payload) => Promise<unknown>) => {
  const calls: Payload[] = []
  const factory = vi.fn<SmsGlobalFactory>(() => ({
    sms: {
      send: (payload: Payload) => {
        calls.push(payload)
        return send(payload) as Promise<{ statusCode: number; data: unknown }>
      },
    },
  }))
  return { factory, calls }
}

afterEach(() => vi.restoreAllMocks())

describe('sending a code through SMSGlobal', () => {
  it('rejects with SMSGlobal’s own answer when it refuses — never reports it as sent', async () => {
    const refusal = { statusCode: 400, data: { errors: { origin: ['Origin is invalid.'] } } }
    const { factory } = fakeSdk(() => Promise.reject(refusal))
    const sms = createSmsClient({ apiKey: 'k', apiSecret: 's', origin: 'B P', sdkFactory: factory })

    await expect(sms.sendCode({ mobile: '+49 151 23456789', code: '123456' })).rejects.toBe(refusal)
  })

  it('rejects on a transport failure too', async () => {
    const { factory } = fakeSdk(() => Promise.reject(new Error('ECONNRESET')))
    const sms = createSmsClient({ apiKey: 'k', apiSecret: 's', sdkFactory: factory })
    await expect(sms.sendCode({ mobile: '+491512345678', code: '1' })).rejects.toThrow('ECONNRESET')
  })

  it('resolves as delivered when SMSGlobal accepts — the counter-assertion', async () => {
    const { factory } = fakeSdk(() => Promise.resolve({ statusCode: 200, data: { messages: [] } }))
    const sms = createSmsClient({ apiKey: 'k', apiSecret: 's', sdkFactory: factory })
    await expect(sms.sendCode({ mobile: '+491512345678', code: '1' }))
      .resolves.toEqual({ delivered: true, response: { messages: [] } })
  })

  it('writes nothing to the console: logging a failure is the gateway’s job', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { factory } = fakeSdk(() => Promise.reject(new Error('down')))
    const sms = createSmsClient({ apiKey: 'k', apiSecret: 's', sdkFactory: factory })
    await sms.sendCode({ mobile: '+491512345678', code: '1' }).catch(() => undefined)
    expect(errors).not.toHaveBeenCalled()
  })

  it('creates the SDK once, with the configured credentials, on first use', async () => {
    const { factory } = fakeSdk(() => Promise.resolve({ data: null }))
    const sms = createSmsClient({ apiKey: 'key-1', apiSecret: 'secret-1', sdkFactory: factory })
    expect(factory).not.toHaveBeenCalled()
    await sms.sendCode({ mobile: '+491512345678', code: '1' })
    await sms.sendCode({ mobile: '+491512345678', code: '2' })
    expect(factory).toHaveBeenCalledTimes(1)
    expect(factory).toHaveBeenCalledWith('key-1', 'secret-1')
  })
})

describe('the sender is configuration', () => {
  it('sends from the configured origin', async () => {
    const { factory, calls } = fakeSdk(() => Promise.resolve({ data: null }))
    await createSmsClient({ apiKey: 'k', apiSecret: 's', origin: 'B P', sdkFactory: factory })
      .sendCode({ mobile: '+491512345678', code: '1' })
    expect(calls[0]!.origin).toBe('B P')
  })

  it('sends from a different origin when configured so — not one written into the code', async () => {
    const { factory, calls } = fakeSdk(() => Promise.resolve({ data: null }))
    await createSmsClient({ apiKey: 'k', apiSecret: 's', origin: 'Club', sdkFactory: factory })
      .sendCode({ mobile: '+491512345678', code: '1' })
    expect(calls[0]!.origin).toBe('Club')
  })

  it('defaults to B P when no origin is configured', async () => {
    const { factory, calls } = fakeSdk(() => Promise.resolve({ data: null }))
    await createSmsClient({ apiKey: 'k', apiSecret: 's', sdkFactory: factory })
      .sendCode({ mobile: '+491512345678', code: '1' })
    expect(DEFAULT_ORIGIN).toBe('B P')
    expect(calls[0]!.origin).toBe('B P')
  })

  it('sends the number as digits only', async () => {
    const { factory, calls } = fakeSdk(() => Promise.resolve({ data: null }))
    const sms = createSmsClient({ apiKey: 'k', apiSecret: 's', sdkFactory: factory })
    await sms.sendCode({ mobile: '+49 151 2345-6789', code: '1' })
    await sms.sendCode({ mobile: '0049 151 23456789', code: '1' })
    expect(calls.map((c) => c.destination)).toEqual(['4915123456789', '4915123456789'])
  })
})
