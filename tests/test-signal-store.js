import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SignalStore } from '../plugin/lib/signal-store.js';

function assert(condition, msg) {
  if (!condition) { console.error('FAIL:', msg); process.exit(1); }
}

const tmpDir = mkdtempSync(join(tmpdir(), 'callus-test-'));
const signalsPath = join(tmpDir, 'signals.json');

// Initialize empty
writeFileSync(signalsPath, JSON.stringify({ signals: [], self_reviews: [] }));

const store = new SignalStore(signalsPath);

// Test 1: Append signal
store.appendSignal({
  session_id: 's1',
  timestamp: '2026-03-09T10:00:00Z',
  type: 'error_loop',
  topic: 'playwright-fiber',
  severity: 4,
  evidence: { tool: 'Bash', failure_count: 5 }
});

let data = store.load();
assert(data.signals.length === 1, 'should have 1 signal');
assert(data.signals[0].topic === 'playwright-fiber', 'topic should match');

// Test 2: Append another signal, same topic different session
store.appendSignal({
  session_id: 's2',
  timestamp: '2026-03-10T10:00:00Z',
  type: 'file_churn',
  topic: 'playwright-fiber',
  severity: 3,
  evidence: { file: '/tmp/foo.js', edit_count: 6 }
});

// Test 3: Aggregate by topic
const agg = store.aggregateByTopic(30);
assert(agg['playwright-fiber'].total_severity === 7, 'total severity should be 7');
assert(agg['playwright-fiber'].session_count === 2, 'session count should be 2');
assert(agg['playwright-fiber'].signal_count === 2, 'signal count should be 2');

// Test 4: Time window filtering
store.appendSignal({
  session_id: 's0',
  timestamp: '2025-01-01T10:00:00Z', // very old
  type: 'error_loop',
  topic: 'old-topic',
  severity: 5,
  evidence: {}
});

const agg2 = store.aggregateByTopic(30);
assert(!agg2['old-topic'], 'old signals should be filtered out');

// Test 5: Append self-review
store.appendSelfReview({
  session_id: 's1',
  timestamp: '2026-03-09T10:05:00Z',
  struggles: [{ topic: 'playwright-fiber', what_happened: 'test', root_cause: 'test', lesson: 'test', reusable: true }],
  wins: [{ topic: 'playwright-fiber', pattern: 'use fiber.return', reusable: true }]
});

data = store.load();
assert(data.self_reviews.length === 1, 'should have 1 self-review');

// Cleanup
rmSync(tmpDir, { recursive: true });
console.log('All signal-store tests passed.');
