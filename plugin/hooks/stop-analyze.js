#!/usr/bin/env node

/**
 * Callus Stop Hook — Phase 1: Quantitative Analysis
 *
 * Reads transcript from stdin, runs detectors, appends signals to signals.json.
 * Always exits 0 to never block the user.
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { parseTranscript } from '../lib/transcript-parser.js';
import { SignalStore } from '../lib/signal-store.js';
import { detectSignals } from '../lib/detector.js';
import { loadConfig, ensureInit, SIGNALS_PATH } from '../lib/init.js';

async function main() {
  try {
    // Read hook input from stdin
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
    }
    const hookInput = JSON.parse(input);
    const { session_id, transcript_path } = hookInput;

    if (!transcript_path || !session_id) {
      process.exit(0);
    }

    // Load config
    const config = loadConfig();
    if (!config.enabled) {
      process.exit(0);
    }

    // Parse transcript
    const parsed = parseTranscript(transcript_path);

    // Run detectors
    const signals = detectSignals(parsed, config);

    if (signals.length === 0) {
      // No signals detected — output standard response
      console.log(JSON.stringify({ continue: true, suppressOutput: true }));
      process.exit(0);
    }

    // Append signals to store
    ensureInit();
    const store = new SignalStore(SIGNALS_PATH);
    const now = new Date().toISOString();

    for (const signal of signals) {
      store.appendSignal({
        session_id,
        timestamp: now,
        ...signal
      });
    }

    // Calculate max severity for self-review hook
    const maxSeverity = Math.max(...signals.map(s => s.severity));

    // Pass max severity to next hook via temp file
    const tempPath = join(process.env.HOME, '.callus', '.last-stop-severity');
    writeFileSync(tempPath, String(maxSeverity));

    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  } catch (e) {
    // Never block the user on error
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  }
  process.exit(0);
}

main();
