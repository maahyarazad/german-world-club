import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { PROBLEMS } from '@gwc/contracts/errors'
import { ApiError } from '../../src/lib/api'
import { useAction } from '../../src/lib/useAction'

afterEach(() => vi.restoreAllMocks())

const deferred = () => {
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('useAction', () => {
  it('runs the handler once for two presses in the same frame (a ref guard, not state)', async () => {
    const d = deferred()
    const fn = vi.fn(() => d.promise)
    const { result } = renderHook(() => useAction('T.run', fn))
    await act(async () => {
      void result.current[0]()
      void result.current[0]() // before any re-render
      d.resolve()
      await d.promise
    })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('is pending while the request runs and not after, and can run again', async () => {
    const d = deferred()
    const fn = vi.fn(() => d.promise)
    const { result } = renderHook(() => useAction('T.run', fn))
    expect(result.current[1]).toBe(false)
    let run!: Promise<void>
    act(() => { run = result.current[0]() })
    expect(result.current[1]).toBe(true)
    await act(async () => { d.resolve(); await run })
    expect(result.current[1]).toBe(false)
    await act(async () => { await result.current[0]() })
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('logs a failure under its name with the problem, swallows it, and is not left pending', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const problem = { ...PROBLEMS.NOT_FOUND, detail: 'x' }
    const fn = vi.fn(async () => { throw new ApiError(problem) })
    const { result } = renderHook(() => useAction('Roles.save', fn))
    await act(async () => { await result.current[0]() }) // must not throw
    expect(errors).toHaveBeenCalledWith('Roles.save', problem)
    expect(result.current[1]).toBe(false)
  })

  it('logs a non-API error as is', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const boom = new TypeError('offline')
    const { result } = renderHook(() => useAction('X.y', async () => { throw boom }))
    await act(async () => { await result.current[0]() })
    expect(errors).toHaveBeenCalledWith('X.y', boom)
  })

  it('hands the error to onError INSTEAD of logging it (the documented shown-as-well cases)', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const onError = vi.fn()
    const boom = new Error('refused')
    const { result } = renderHook(() => useAction('SignIn.submit', async () => { throw boom }, { onError }))
    await act(async () => { await result.current[0]() })
    expect(onError).toHaveBeenCalledWith(boom)
    expect(errors).not.toHaveBeenCalled()
  })

  it('passes its arguments through', async () => {
    const fn = vi.fn(async (_a: string, _b: number) => undefined)
    const { result } = renderHook(() => useAction('T.args', fn))
    await act(async () => { await result.current[0]('id-1', 2) })
    expect(fn).toHaveBeenCalledWith('id-1', 2)
  })
})
