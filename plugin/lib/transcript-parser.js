import { readFileSync } from 'fs';

/**
 * Parse a Claude Code transcript JSONL file.
 * Returns structured data: tool calls (with error status), text blocks, and raw lines.
 *
 * @param {string} transcriptPath - Absolute path to .jsonl file
 * @returns {{ toolCalls: Array, textBlocks: string[] }}
 */
export function parseTranscript(transcriptPath) {
  const content = readFileSync(transcriptPath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());

  const toolCalls = [];
  const textBlocks = [];
  const toolResults = new Map(); // tool_use_id -> { content, is_error }

  // First pass: collect tool results
  for (const line of lines) {
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }

    const msg = parsed.message;
    if (!msg || !msg.content) continue;

    const contentArr = Array.isArray(msg.content) ? msg.content : [];
    for (const block of contentArr) {
      if (block.type === 'tool_result') {
        toolResults.set(block.tool_use_id, {
          content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
          is_error: block.is_error === true
        });
      }
    }
  }

  // Second pass: collect tool calls and text
  for (const line of lines) {
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }

    const msg = parsed.message;
    if (!msg || !msg.content) continue;

    const contentArr = Array.isArray(msg.content) ? msg.content : [];
    for (const block of contentArr) {
      if (block.type === 'tool_use') {
        const result = toolResults.get(block.id);
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input || {},
          error: result ? result.is_error : false,
          errorContent: result && result.is_error ? result.content : null
        });
      } else if (block.type === 'text' && parsed.type === 'assistant') {
        textBlocks.push(block.text);
      }
    }
  }

  return { toolCalls, textBlocks };
}

/**
 * Extract the last assistant text output from a transcript.
 * Used by self-review hook to read Claude's self-review response.
 *
 * @param {string} transcriptPath
 * @returns {string}
 */
export function getLastAssistantText(transcriptPath) {
  const { textBlocks } = parseTranscript(transcriptPath);
  return textBlocks.length > 0 ? textBlocks[textBlocks.length - 1] : '';
}
