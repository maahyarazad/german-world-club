import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '@/api/client';

/**
 * Wrap a handler that sends a request (feature 030). Same behaviour as the web's
 * `useAction`: a ref guard so two presses in one frame start one request, a
 * `pending` flag for the button's `loading`, and failures logged the project's
 * way (`console.error(name, problem)`), swallowed, never stored or shown. The
 * documented shown-as-well cases pass `onError`, which replaces the log.
 */
export function useAction<A extends unknown[]>(
    name: string,
    fn: (...args: A) => Promise<unknown>,
    { onError }: { onError?: (error: unknown) => void } = {},
): [(...args: A) => Promise<void>, boolean] {
    const [pending, setPending] = useState(false);
    const running = useRef(false);
    const mounted = useRef(true);
    const latest = useRef({ fn, onError, name });
    latest.current = { fn, onError, name };

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const run = useCallback(async (...args: A): Promise<void> => {
        if (running.current) return;
        running.current = true;
        setPending(true);
        try {
            await latest.current.fn(...args);
        } catch (error) {
            if (latest.current.onError) latest.current.onError(error);
            else console.error(latest.current.name, error instanceof ApiError ? error.problem : error);
        } finally {
            running.current = false;
            if (mounted.current) setPending(false);
        }
    }, []);

    return [run, pending];
}
