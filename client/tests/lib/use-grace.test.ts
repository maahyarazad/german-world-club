import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGrace } from '../../src/lib/useGrace'

afterEach(() => vi.useRealTimers())

describe('useGrace', () => {
  it('is false until active has held for the whole period, then true', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useGrace(true, 150))
    expect(result.current).toBe(false)
    act(() => { vi.advanceTimersByTime(149) })
    expect(result.current).toBe(false)
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current).toBe(true)
  })

  it('drops to false at once when active ends, and a quick toggle restarts the wait (counter-assertion)', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ active }) => useGrace(active, 100), { initialProps: { active: true } })
    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current).toBe(true)
    rerender({ active: false })
    expect(result.current).toBe(false)
    rerender({ active: true })
    expect(result.current).toBe(false)
    act(() => { vi.advanceTimersByTime(99) })
    expect(result.current).toBe(false)
  })

  it('never turns on when it was active for less than the period', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ active }) => useGrace(active, 150), { initialProps: { active: true } })
    act(() => { vi.advanceTimersByTime(80) })
    rerender({ active: false })
    act(() => { vi.advanceTimersByTime(500) })
    expect(result.current).toBe(false)
  })
})
