import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { execSync, spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// End-to-end smoke test over real stdio: builds the package, starts the bin
// exactly the way `npx @pulse-circle/mcp` would, and speaks JSON-RPC to it.

const pkgRoot = path.resolve(import.meta.dirname, '..');
const pkgJson = JSON.parse(readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')) as {
  version: string;
  bin: Record<string, string>;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id?: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};

type ToolResult = { content: Array<{ type: string; text: string }> };

let child: ChildProcessWithoutNullStreams;
let stderr = '';
let nextId = 1;
const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();

function send(msg: Record<string, unknown>): void {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
}

function rpc(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const id = nextId++;
  const result = new Promise<Record<string, unknown>>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`timed out waiting for ${method}\nserver stderr: ${stderr}`));
    }, 10_000);
  });
  send({ id, method, params });
  return result;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  const res = (await rpc('tools/call', { name, arguments: args })) as ToolResult;
  expect(res.content[0]?.type).toBe('text');
  return res.content[0]!.text;
}

beforeAll(() => {
  execSync('npm run build', { cwd: pkgRoot, stdio: 'pipe' });
  const entry = path.join(pkgRoot, Object.values(pkgJson.bin)[0]!);
  child = spawn(process.execPath, [entry]);
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  let buffer = '';
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line) as JsonRpcResponse;
      if (msg.id === undefined) continue;
      const waiter = pending.get(msg.id);
      if (!waiter) continue;
      pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
      else waiter.resolve(msg.result ?? {});
    }
  });
}, 120_000);

afterAll(() => {
  child?.kill();
});

describe('@pulse-circle/mcp stdio server', () => {
  test('initializes and reports the package version', async () => {
    const init = (await rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'smoke-test', version: '0.0.0' },
    })) as { serverInfo: { name: string; version: string } };
    send({ method: 'notifications/initialized' });

    expect(init.serverInfo.name).toBe('pulse-local');
    // Same drift guard as core's SDK_VERSION test: the version the server
    // announces must match packages/mcp/package.json.
    expect(init.serverInfo.version).toBe(pkgJson.version);
  }, 15_000);

  test('exposes exactly the two offline guide tools', async () => {
    const res = (await rpc('tools/list')) as { tools: Array<{ name: string }> };
    expect(res.tools.map((t) => t.name).sort()).toEqual(['pulse_connect', 'pulse_setup_guide']);
  }, 15_000);

  test('web setup guide: install snippet, script tag, revenue disclaimer', async () => {
    const text = await callTool('pulse_setup_guide', { platform: 'web' });
    expect(text).toContain('npm i @pulse-circle/web');
    expect(text).toContain('Pulse.init(');
    expect(text).toContain('https://cdn.jsdelivr.net/npm/@pulse-circle/web');
    expect(text).toContain('not revenue');
  }, 15_000);

  test('react-native setup guide points at the raw ingestion API', async () => {
    const text = await callTool('pulse_setup_guide', { platform: 'react-native' });
    expect(text).toContain('https://api.pulse.pulsecircle.studio/v1/batch');
    expect(text).toContain('idempotency_key');
  }, 15_000);

  test('swift guide installs the native SDK via SPM; kotlin falls back to raw API', async () => {
    const swift = await callTool('pulse_setup_guide', { platform: 'swift' });
    expect(swift).toContain('https://github.com/Pulse-Circle-Studio/pulse-sdk-native');
    expect(swift).toContain('Pulse.initialize(apiKey:');
    expect(swift).toContain('llms.txt');

    const kotlin = await callTool('pulse_setup_guide', { platform: 'kotlin' });
    expect(kotlin).toContain('https://api.pulse.pulsecircle.studio/v1/batch');
    expect(kotlin).toContain('Maven Central');
  }, 15_000);

  test('app_store connect guide: Vendor Number required, forward-not-replace', async () => {
    const text = await callTool('pulse_connect', { source: 'app_store' });
    expect(text).toContain('Vendor Number');
    expect(text).toContain('REQUIRED for Sales & Trends');
    expect(text).toContain('ONE Server Notifications URL');
    expect(text).toContain('do NOT replace');
    expect(text).toContain('https://hooks.pulse.pulsecircle.studio/hooks/app-store/');
  }, 15_000);

  test('revenuecat and google_play connect guides point at /connections', async () => {
    const revenuecat = await callTool('pulse_connect', { source: 'revenuecat' });
    expect(revenuecat).toContain('https://app.pulse.pulsecircle.studio/connections');
    expect(revenuecat).toContain('app_user_id');

    const googlePlay = await callTool('pulse_connect', { source: 'google_play' });
    expect(googlePlay).toContain('https://app.pulse.pulsecircle.studio/connections');
    expect(googlePlay).toContain('Pub/Sub');
  }, 15_000);

  test('unknown platform is rejected by the input schema', async () => {
    // The MCP SDK reports input-validation failures in-band: a normal
    // tools/call response carrying isError plus the zod message.
    const res = (await rpc('tools/call', {
      name: 'pulse_setup_guide',
      arguments: { platform: 'flash' },
    })) as ToolResult & { isError?: boolean };
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain('Invalid enum value');
  }, 15_000);
});
