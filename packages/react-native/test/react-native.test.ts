import { describe, expect, test } from 'vitest';
import {
  AsyncQueueStorage,
  MemoryAsyncStorage,
  createReactNativeClient,
} from '@pulse/react-native';
import { MockTransport, VirtualClock, settle } from '@pulse/core/testing';

describe('lifecycle hooks', () => {
  test('backgrounding the app triggers a best-effort flush', async () => {
    const transport = new MockTransport();
    let onChange: ((state: string) => void) | undefined;
    const client = createReactNativeClient(
      'pk_test',
      { flushIntervalMs: 3_600_000 },
      {
        transport,
        clock: new VirtualClock(),
        asyncStorage: new MemoryAsyncStorage(),
        appState: {
          addEventListener: (_type, handler) => {
            onChange = handler;
          },
        },
        netInfo: null,
      },
    );
    await settle();
    client.track('screen_closed');
    expect(transport.pending).toHaveLength(0);
    onChange!('background');
    await settle();
    expect(transport.pending).toHaveLength(1);
    const req = transport.shift()!;
    req.callback({ ok: true, status: 200, body: '{"accepted":[],"rejected":[]}' });
    await settle();
  });

  test('connectivity returning triggers a flush via NetInfo', async () => {
    const transport = new MockTransport();
    let onNet: ((state: { isConnected?: boolean | null }) => void) | undefined;
    const client = createReactNativeClient(
      'pk_test',
      { flushIntervalMs: 3_600_000 },
      {
        transport,
        clock: new VirtualClock(),
        asyncStorage: new MemoryAsyncStorage(),
        appState: null,
        netInfo: {
          addEventListener: (handler) => {
            onNet = handler;
          },
        },
      },
    );
    await settle();
    client.track('offline_event');
    expect(transport.pending).toHaveLength(0);
    onNet!({ isConnected: true });
    await settle();
    expect(transport.pending).toHaveLength(1);
    const req = transport.shift()!;
    req.callback({ ok: true, status: 200, body: '{"accepted":[],"rejected":[]}' });
    await settle();
  });
});

describe('AsyncQueueStorage', () => {
  test('writes land in order and the final snapshot wins', async () => {
    const writes: string[] = [];
    const store = {
      getItem: async () => null,
      setItem: async (_k: string, v: string) => {
        writes.push(v);
      },
      removeItem: async () => {},
    };
    const queue = new AsyncQueueStorage(store);
    await queue.loadAll();
    queue.append('"a"');
    queue.append('"b"');
    queue.markConsumed(1);
    await settle();
    expect(writes[writes.length - 1]).toBe('["\\"b\\""]');
  });
});
