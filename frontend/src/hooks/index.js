import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from '../lib/socket.js';

// Loads data with loading/error state. `reload()` refetches silently
// (keeps current data visible while refreshing).
export function useResource(loader, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const seq = useRef(0);

  const run = useCallback(async ({ silent = false } = {}) => {
    const id = ++seq.current;
    if (!silent) setLoading(true);
    try {
      const result = await loaderRef.current();
      if (id === seq.current) {
        setData(result);
        setError(null);
      }
      return result;
    } catch (err) {
      if (id === seq.current) setError(err);
      return null;
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const reload = useCallback(() => run({ silent: true }), [run]);
  return { data, setData, error, loading, reload, retry: run };
}

// Subscribes to one Socket.IO event for the component's lifetime.
export function useSocketEvent(event, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const socket = getSocket();
    const listener = (payload) => ref.current(payload);
    socket.on(event, listener);
    return () => socket.off(event, listener);
  }, [event]);
}

// Runs `callback` on every (re)connection — used to rejoin rooms and to
// refetch authoritative state after a disconnect.
export function useOnConnect(callback) {
  const ref = useRef(callback);
  ref.current = callback;
  useEffect(() => {
    const socket = getSocket();
    const listener = () => ref.current();
    socket.on('connect', listener);
    if (socket.connected) listener();
    return () => socket.off('connect', listener);
  }, []);
}

// Joins an authorized room (org:join / service:watch) while mounted.
export function useRoom(kind, id) {
  const [state, setState] = useState({ joined: false, error: null });
  useEffect(() => {
    if (!id) return undefined;
    const socket = getSocket();
    const payload = kind === 'org' ? { orgId: id } : { serviceId: id };
    const joinEvent = kind === 'org' ? 'org:join' : 'service:watch';
    const leaveEvent = kind === 'org' ? 'org:leave' : 'service:unwatch';
    const join = () =>
      socket.emit(joinEvent, payload, (ack) => setState({ joined: Boolean(ack?.ok), error: ack?.ok ? null : ack?.error }));
    const lost = () => setState((s) => ({ ...s, joined: false }));
    socket.on('connect', join);
    socket.on('disconnect', lost);
    if (socket.connected) join();
    return () => {
      socket.off('connect', join);
      socket.off('disconnect', lost);
      if (socket.connected) socket.emit(leaveEvent, payload);
    };
  }, [kind, id]);
  return state;
}

export function useSocketStatus() {
  const [connected, setConnected] = useState(() => getSocket().connected);
  useEffect(() => {
    const socket = getSocket();
    const on = () => setConnected(true);
    const off = () => setConnected(false);
    socket.on('connect', on);
    socket.on('disconnect', off);
    return () => {
      socket.off('connect', on);
      socket.off('disconnect', off);
    };
  }, []);
  return connected;
}

// Current time, re-rendering every `intervalMs` (for countdowns).
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// Debounced callback (coalesces bursts of queue events into one refetch).
export function useDebounced(fn, ms = 250) {
  const ref = useRef(fn);
  ref.current = fn;
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  return useCallback(
    (...args) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => ref.current(...args), ms);
    },
    [ms]
  );
}

export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · QueueLess` : 'QueueLess — Skip the line';
  }, [title]);
}
