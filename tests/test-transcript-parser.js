import { writeFileSync, mkdtempSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseTranscript } from '../plugin/lib/transcript-parser.js';

const tmpDir = mkdtempSync(join(tmpdir(), 'callus-test-'));

function assert(condition, msg) {
  if (!condition) { console.error('FAIL:', msg); process.exit(1); }
}

// Test 1: Parse tool calls
const transcript1 = [
  JSON.stringify({ type: 'user', message: { role: 'user', content: 'fix the bug' } }),
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [
    { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } },
  ] } }),
  JSON.stringify({ type: 'user', message: { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 't1', content: 'Error: test failed', is_error: true }
  ] } }),
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [
    { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test' } },
  ] } }),
  JSON.stringify({ type: 'user', message: { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 't2', content: 'Error: test failed', is_error: true }
  ] } }),
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [
    { type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'npm test' } },
  ] } }),
  JSON.stringify({ type: 'user', message: { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 't3', content: 'All tests passed' }
  ] } }),
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [
    { type: 'text', text: 'Tests pass now.' }
  ] } }),
].join('\n');

const f1 = join(tmpDir, 'test1.jsonl');
writeFileSync(f1, transcript1);

const result1 = parseTranscript(f1);
assert(result1.toolCalls.length === 3, 'should find 3 tool calls');
assert(result1.toolCalls[0].name === 'Bash', 'tool name should be Bash');
assert(result1.toolCalls[0].error === true, 'first call should be error');
assert(result1.toolCalls[2].error === false, 'third call should succeed');
assert(result1.textBlocks.length >= 1, 'should have text blocks');

// Test 2: Parse edit operations
const transcript2 = [
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [
    { type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: '/tmp/foo.js', old_string: 'a', new_string: 'b' } },
  ] } }),
  JSON.stringify({ type: 'user', message: { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'e1', content: 'OK' }
  ] } }),
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [
    { type: 'tool_use', id: 'e2', name: 'Edit', input: { file_path: '/tmp/foo.js', old_string: 'b', new_string: 'c' } },
  ] } }),
  JSON.stringify({ type: 'user', message: { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'e2', content: 'OK' }
  ] } }),
].join('\n');

const f2 = join(tmpDir, 'test2.jsonl');
writeFileSync(f2, transcript2);

const result2 = parseTranscript(f2);
assert(result2.toolCalls.length === 2, 'should find 2 edit calls');
assert(result2.toolCalls[0].input.file_path === '/tmp/foo.js', 'should capture file_path');

// Test 3: Parse assistant text with approach pivots
const transcript3 = [
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [
    { type: 'text', text: "That didn't work. Let me try a different approach." }
  ] } }),
].join('\n');

const f3 = join(tmpDir, 'test3.jsonl');
writeFileSync(f3, transcript3);

const result3 = parseTranscript(f3);
assert(result3.textBlocks.some(t => t.includes('different approach')), 'should capture pivot text');

// Cleanup
unlinkSync(f1); unlinkSync(f2); unlinkSync(f3);
console.log('All transcript-parser tests passed.');
