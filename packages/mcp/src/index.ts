#!/usr/bin/env node
// Local (stdio) MCP server for Pulse. Everything it serves is baked in at
// build time — hardened sandboxes that block our domains can still get the
// setup/connect guides, because delivery happens over npm, not HTTP.
// pulse_verify / pulse_ask need the Pulse API and stay on the remote MCP.
import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Read the version rather than repeat it. A hardcoded string here drifted from
// package.json on the 0.1.1 bump and failed the smoke test's drift guard —
// which is the guard doing its job, but the duplication is the actual bug.
// dist/index.js sits one level below the package root, and npm always ships
// package.json regardless of the "files" list.
const PKG_VERSION = (
  createRequire(import.meta.url)('../package.json') as { version: string }
).version;

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
Events go to ${BASE} by default — no endpoint config needed.
NOTE: track() is for product events, not revenue. Subscription revenue/MRR/LTV
come from connecting your store/billing in Pulse (see pulse_connect).`,
  'react-native': `Install @pulse-circle/react-native (pure JS, no native modules, works in Expo Go):
  npm install @pulse-circle/react-native @react-native-async-storage/async-storage
  import { Pulse } from '@pulse-circle/react-native';
  Pulse.init(PULSE_API_KEY);          // pk_... publishable key
  Pulse.track('screen_opened', { screen: 'Home' });
  Pulse.identify(userId);             // after login
  Pulse.reset();                      // on logout
async-storage is a peer dependency — it persists the queue across launches.
@react-native-community/netinfo is optional (flush the moment the network returns).
NOTE: track() is for product events, not revenue. Subscription revenue/MRR/LTV
come from connecting your store/billing in Pulse (see pulse_connect).`,
  swift: `Install PulseSDK for iOS (iOS 15+, Swift 5.9+, zero dependencies).

Swift Package Manager:
  Xcode → Add Package → https://github.com/Pulse-Circle-Studio/pulse-sdk-native  (from: "0.1.1")
CocoaPods — the pod is 'pulse-circle', the module is still PulseSDK:
  pod 'pulse-circle', '~> 0.1.1'

  import PulseSDK
  Pulse.initialize(apiKey: PULSE_API_KEY)   // pk_... publishable key
  Pulse.track("app_open")
  Pulse.identify(userId)                    // after login
  Pulse.reset()                             // on logout
Full agent guide: https://raw.githubusercontent.com/Pulse-Circle-Studio/pulse-sdk-native/main/llms.txt
NOTE: track() is for product events, not revenue. Subscription revenue/MRR/LTV
come from connecting your store/billing in Pulse (see pulse_connect).`,
  kotlin: `Install the Pulse Android SDK from Maven Central (Android 7.0+/API 24, zero dependencies):
  // build.gradle.kts
  implementation("studio.pulsecircle.pulse:pulse-sdk-android:0.1.0")

  import studio.pulsecircle.pulse.android.Pulse
  Pulse.init(context, PULSE_API_KEY)  // pk_... publishable key; any Context
  Pulse.track("app_open")
  Pulse.identify(userId)              // after login
  Pulse.reset()                       // on logout
init() is safe to call more than once; every method is a no-op until it runs.
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

const server = new McpServer({ name: 'pulse-local', version: PKG_VERSION });

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
