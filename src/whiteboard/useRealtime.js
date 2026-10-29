import { useCallback, useEffect, useRef, useState } from 'react';

const REPLACED = 4000; // the server's close code for 'you connected again somewhere else'

function socketUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

// One WebSocket that reconnects with backoff and says hello again after every
// connect, so a dropped connection or a deploy is only a short blip.
export function useRealtime({ hello, onMessage }) {
  const [status, setStatus] = useState('connecting'); // connecting | open | replaced
  const socketRef = useRef(null);
  const helloRef = useRef(hello);
  const onMessageRef = useRef(onMessage);
  helloRef.current = hello;
  onMessageRef.current = onMessage;

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let retryTimer;

    const connect = () => {
      const socket = new WebSocket(socketUrl());
      socketRef.current = socket;
      const current = () => !stopped && socketRef.current === socket;
      socket.onopen = () => {
        if (!current()) return;
        attempt = 0;
        setStatus('open');
        socket.send(JSON.stringify(helloRef.current()));
      };
      socket.onmessage = (event) => {
        if (!current()) return;
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        onMessageRef.current(msg);
      };
      socket.onclose = (event) => {
        if (!current()) return;
        socketRef.current = null;
        if (event.code === REPLACED) {
          setStatus('replaced');
          return;
        }
        setStatus('connecting');
        retryTimer = setTimeout(connect, Math.min(5000, 500 * 2 ** attempt));
        attempt += 1;
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close();
    };
  }, []);

  const send = useCallback((msg) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  }, []);

  return { status, send };
}
