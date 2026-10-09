import { useCallback, useEffect, useState } from 'react';

export function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({
    loading: true,
  });
  const [tick, setTick] = useState(0);
  // The caller lists what load depends on, like a useEffect dependency list.
  const run = useCallback(load, deps);
  useEffect(() => {
    let live = true;
    setState((previous) => ({ ...previous, loading: true }));
    run().then(
      (data) => {
        if (live) setState({ data, loading: false });
      },
      (error: unknown) => {
        if (live) {
          setState({
            error: error instanceof Error ? error : new Error(String(error)),
            loading: false,
          });
        }
      },
    );
    return () => {
      live = false;
    };
  }, [run, tick]);
  return { ...state, reload: () => setTick((n) => n + 1) };
}
