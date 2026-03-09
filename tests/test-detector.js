import { detectSignals, inferTopic } from '../plugin/lib/detector.js';

function assert(condition, msg) {
  if (!condition) { console.error('FAIL:', msg); process.exit(1); }
}

const defaultConfig = {
  detectors: {
    repeated_tool_failure: { enabled: true, min_count: 3 },
    file_churn: { enabled: true, min_edits: 5 },
    approach_pivot: { enabled: true, patterns: ["let me try", "different approach", "换个方法"] },
    long_exploration: { enabled: true, min_reads: 10 },
    error_loop: { enabled: true, min_count: 3 }
  }
};

// Test 1: repeated_tool_failure
const toolCalls1 = [
  { name: 'Bash', input: { command: 'npm test' }, error: true, errorContent: 'Error: fail' },
  { name: 'Bash', input: { command: 'npm test' }, error: true, errorContent: 'Error: fail' },
  { name: 'Bash', input: { command: 'npm test' }, error: true, errorContent: 'Error: fail' },
  { name: 'Bash', input: { command: 'npm test' }, error: false, errorContent: null },
];
const r1 = detectSignals({ toolCalls: toolCalls1, textBlocks: [] }, defaultConfig);
assert(r1.some(s => s.type === 'repeated_tool_failure'), 'should detect repeated_tool_failure');
assert(r1.find(s => s.type === 'repeated_tool_failure').evidence.failure_count === 3, 'count should be 3');

// Test 2: file_churn
const toolCalls2 = Array.from({ length: 6 }, (_, i) => ({
  name: 'Edit', input: { file_path: '/tmp/app.js', old_string: `v${i}`, new_string: `v${i+1}` }, error: false
}));
const r2 = detectSignals({ toolCalls: toolCalls2, textBlocks: [] }, defaultConfig);
assert(r2.some(s => s.type === 'file_churn'), 'should detect file_churn');

// Test 3: approach_pivot
const r3 = detectSignals({
  toolCalls: [
    { name: 'Bash', input: { command: 'method1' }, error: true },
    { name: 'Bash', input: { command: 'method2' }, error: false },
  ],
  textBlocks: ["That failed. Let me try something else.", "OK this works."]
}, defaultConfig);
assert(r3.some(s => s.type === 'approach_pivot'), 'should detect approach_pivot');

// Test 4: long_exploration
const toolCalls4 = Array.from({ length: 12 }, () => ({
  name: 'Read', input: { file_path: '/tmp/some.js' }, error: false
}));
const r4 = detectSignals({ toolCalls: toolCalls4, textBlocks: [] }, defaultConfig);
assert(r4.some(s => s.type === 'long_exploration'), 'should detect long_exploration');

// Test 5: error_loop (same error message 3+ times)
const toolCalls5 = [
  { name: 'Bash', input: { command: 'cargo build' }, error: true, errorContent: 'error[E0308]: mismatched types' },
  { name: 'Edit', input: { file_path: '/tmp/main.rs' }, error: false },
  { name: 'Bash', input: { command: 'cargo build' }, error: true, errorContent: 'error[E0308]: mismatched types' },
  { name: 'Edit', input: { file_path: '/tmp/main.rs' }, error: false },
  { name: 'Bash', input: { command: 'cargo build' }, error: true, errorContent: 'error[E0308]: mismatched types' },
];
const r5 = detectSignals({ toolCalls: toolCalls5, textBlocks: [] }, defaultConfig);
assert(r5.some(s => s.type === 'error_loop'), 'should detect error_loop');

// Test 6: topic inference
assert(inferTopic([
  { name: 'Bash', input: { command: 'playwright-cli eval "document.title"' }, error: true, errorContent: 'React fiber error' }
]) === 'playwright-react', 'should infer playwright-react topic');

// Test 7: no false positives — 2 failures is below threshold
const toolCalls7 = [
  { name: 'Bash', input: { command: 'npm test' }, error: true, errorContent: 'fail' },
  { name: 'Bash', input: { command: 'npm test' }, error: true, errorContent: 'fail' },
];
const r7 = detectSignals({ toolCalls: toolCalls7, textBlocks: [] }, defaultConfig);
assert(!r7.some(s => s.type === 'repeated_tool_failure'), 'should NOT detect with only 2 failures');

console.log('All detector tests passed.');
