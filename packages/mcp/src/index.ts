#!/usr/bin/env node
// Local (stdio) MCP server for Pulse. Everything it serves is baked in at
// build time — hardened sandboxes that block our domains can still get the
// setup/connect guides, because delivery happens over npm, not HTTP.
// pulse_verify / pulse_ask need the Pulse API and stay on the remote MCP.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE = 'https://api.pulse.pulsecircle.studio';
const HOOKS = 'https://hooks.pulse.pulsecircle.studio';
const APP = 'https://app.pulse.pulsecircle.studio';

const PLATFORMS = ['web', 'react-native', 'swift', 'kotlin'] as const;
const SOURCES = ['revenuecat', 'app_store', 'google_play'] as const;

const SETUP: Record<(typeof PLATFORMS)[number], string> = {
  web: `Install @pulse-circle/web:
  npm i @pulse-circle/web
  import { Pulse } from '@pulse-circle/web';
  Pulse.init(PULSE_API_KEY);          // pk_... publishable key
  Pulse.track('app_open');
  Pulse.identify(userId);             // after login
Script tag: https://cdn.jsdelivr.net/npm/@pulse-circle/web/dist/pulse.iife.global.js
NOTE: track() is for product events, not revenue. Subscription revenue/MRR/LTV
come from connecting your store/billing in Pulse (see pulse_connect).`,
  'react-native': `Raw ingestion API (RN SDK package pending):
  POST ${BASE}/v1/batch  Authorization: Bearer PULSE_API_KEY
  body { batch: [{ type:'track', anonymous_id, event, idempotency_key, timestamp }] }`,
  swift: `Install PulseSDK for iOS (iOS 15+, Swift 5.9+, zero dependencies) via Swift Package Manager:
  Xcode → Add Package → https://github.com/Pulse-Circle-Studio/pulse-sdk-native  (from: "0.1.0")
  import PulseSDK
  Pulse.initialize(apiKey: PULSE_API_KEY)   // pk_... publishable key
  Pulse.track("app_open")
  Pulse.identify(userId)                    // after login
Full agent guide: https://raw.githubusercontent.com/Pulse-Circle-Studio/pulse-sdk-native/main/llms.txt
NOTE: track() is for product events, not revenue. Subscription revenue/MRR/LTV
come from connecting your store/billing in Pulse (see pulse_connect).`,
  kotlin: `Android SDK (studio.pulsecircle.pulse:pulse-sdk-android on Maven Central) is pending
its first publish — until then use the raw ingestion API:
  POST ${BASE}/v1/batch  Authorization: Bearer PULSE_API_KEY
  body { batch: [{ type:'track', anonymous_id, event, idempotency_key, timestamp }] }
Full agent guide: https://raw.githubusercontent.com/Pulse-Circle-Studio/pulse-sdk-native/main/llms.txt
NOTE: track() is for product events, not revenue. Subscription revenue/MRR/LTV
come from connecting your store/billing in Pulse (see pulse_connect).`,
};

const CONNECT: Record<(typeof SOURCES)[number], string> = {
  revenuecat:
    'RevenueCat → copy the secret (sk_) key → ' + APP + '/connections → RevenueCat. ' +
    'Set app_user_id = your app user id so ads↔user↔revenue tie together.',
  app_store:
    'App Store Connect → App Store Connect API: create a key (.p8, Issuer ID, Key ID). ' +
    'Get the Vendor Number (Payments and Financial Reports) — REQUIRED for Sales & Trends. ' +
    'Paste .p8 + Issuer ID + Key ID + Bundle ID + Vendor Number at ' + APP + '/connections → App Store. ' +
    'Real-time subscriptions (MRR/LTV): Apple allows ONE Server Notifications URL per app — ' +
    'if your backend already uses it, forward a copy of the raw { signedPayload } body to ' +
    HOOKS + "/hooks/app-store/<connection-id> (do NOT replace your URL). Pulse re-verifies Apple's signature.",
  google_play:
    'Google Play: service-account JSON (Financial data + app info) + Pub/Sub subscription for ' +
    'real-time developer notifications → ' + APP + '/connections → Google Play.',
};

const server = new McpServer({ name: 'pulse-local', version: '0.1.0' });

server.registerTool(
  'pulse_setup_guide',
  {
    description: 'Step-by-step Pulse SDK install for a platform. Apply the snippet yourself.',
    inputSchema: { platform: z.enum(PLATFORMS) },
  },
  async ({ platform }) => ({ content: [{ type: 'text', text: SETUP[platform] }] }),
);

server.registerTool(
  'pulse_connect',
  {
    description: 'How to connect a Pulse revenue/store source for MRR, LTV and revenue.',
    inputSchema: { source: z.enum(SOURCES) },
  },
  async ({ source }) => ({ content: [{ type: 'text', text: CONNECT[source] }] }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
