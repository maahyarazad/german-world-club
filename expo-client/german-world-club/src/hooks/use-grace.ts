import { useEffect, useState } from 'react';

/**
 * `true` only once `active` has been continuously true for `ms` (feature 030).
 * A loader that flashes for 40 ms is worse than none, so a response that arrives
 * within the grace period shows nothing. Same behaviour as the web's `useGrace`.
 */
export function useGrace(active: boolean, ms = 150): boolean {
    const [shown, setShown] = useState(false);

    useEffect(() => {
        if (!active) {
            setShown(false);
            return undefined;
        }
        const timer = setTimeout(() => setShown(true), ms);
        return () => clearTimeout(timer);
    }, [active, ms]);

    return active && shown;
}
