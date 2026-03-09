/**
 * Run all enabled detectors against parsed transcript data.
 *
 * @param {{ toolCalls: Array, textBlocks: string[] }} parsed
 * @param {object} config - Full callus config
 * @returns {Array<{ type: string, topic: string, severity: number, evidence: object }>}
 */
export function detectSignals(parsed, config) {
  const signals = [];
  const detectors = config.detectors;

  if (detectors.repeated_tool_failure.enabled) {
    signals.push(...detectRepeatedToolFailure(parsed.toolCalls, detectors.repeated_tool_failure));
  }
  if (detectors.file_churn.enabled) {
    signals.push(...detectFileChurn(parsed.toolCalls, detectors.file_churn));
  }
  if (detectors.approach_pivot.enabled) {
    signals.push(...detectApproachPivot(parsed, detectors.approach_pivot));
  }
  if (detectors.long_exploration.enabled) {
    signals.push(...detectLongExploration(parsed.toolCalls, detectors.long_exploration));
  }
  if (detectors.error_loop.enabled) {
    signals.push(...detectErrorLoop(parsed.toolCalls, detectors.error_loop));
  }

  return signals;
}

function detectRepeatedToolFailure(toolCalls, cfg) {
  // Find consecutive runs of same tool failing
  const signals = [];
  let streak = [];

  for (const call of toolCalls) {
    if (call.error && streak.length > 0 && streak[0].name === call.name) {
      streak.push(call);
    } else if (call.error) {
      if (streak.length >= cfg.min_count) {
        signals.push(makeSignal('repeated_tool_failure', streak, streak.length));
      }
      streak = [call];
    } else {
      if (streak.length >= cfg.min_count) {
        signals.push(makeSignal('repeated_tool_failure', streak, streak.length));
      }
      streak = [];
    }
  }
  if (streak.length >= cfg.min_count) {
    signals.push(makeSignal('repeated_tool_failure', streak, streak.length));
  }

  return signals;
}

function detectFileChurn(toolCalls, cfg) {
  const editCounts = {};
  for (const call of toolCalls) {
    if (call.name === 'Edit' && call.input.file_path) {
      editCounts[call.input.file_path] = (editCounts[call.input.file_path] || 0) + 1;
    }
  }

  const signals = [];
  for (const [file, count] of Object.entries(editCounts)) {
    if (count >= cfg.min_edits) {
      signals.push({
        type: 'file_churn',
        topic: inferTopic(toolCalls.filter(c => c.input.file_path === file)),
        severity: Math.min(5, Math.floor(count / cfg.min_edits) + 2),
        evidence: { file, edit_count: count }
      });
    }
  }
  return signals;
}

function detectApproachPivot(parsed, cfg) {
  const signals = [];
  for (const text of parsed.textBlocks) {
    const lower = text.toLowerCase();
    for (const pattern of cfg.patterns) {
      if (lower.includes(pattern.toLowerCase())) {
        signals.push({
          type: 'approach_pivot',
          topic: inferTopic(parsed.toolCalls),
          severity: 2,
          evidence: { matched_pattern: pattern, text_snippet: text.slice(0, 200) }
        });
        break; // one signal per text block
      }
    }
  }
  return signals;
}

function detectLongExploration(toolCalls, cfg) {
  const readTools = new Set(['Read', 'Grep', 'Glob']);
  const writeTools = new Set(['Edit', 'Write']);
  let readStreak = 0;
  let streakCalls = [];
  const signals = [];

  for (const call of toolCalls) {
    if (readTools.has(call.name)) {
      readStreak++;
      streakCalls.push(call);
    } else if (writeTools.has(call.name)) {
      if (readStreak >= cfg.min_reads) {
        signals.push({
          type: 'long_exploration',
          topic: inferTopic(streakCalls),
          severity: Math.min(5, Math.floor(readStreak / cfg.min_reads) + 2),
          evidence: { read_count: readStreak }
        });
      }
      readStreak = 0;
      streakCalls = [];
    }
    // other tools don't reset the streak
  }

  if (readStreak >= cfg.min_reads) {
    signals.push({
      type: 'long_exploration',
      topic: inferTopic(streakCalls),
      severity: Math.min(5, Math.floor(readStreak / cfg.min_reads) + 2),
      evidence: { read_count: readStreak }
    });
  }

  return signals;
}

function detectErrorLoop(toolCalls, cfg) {
  // Count similar error messages across non-consecutive calls
  const errorMessages = {};
  for (const call of toolCalls) {
    if (call.error && call.errorContent) {
      // Normalize: take first line, trim whitespace
      const key = call.errorContent.split('\n')[0].trim().slice(0, 200);
      if (!errorMessages[key]) errorMessages[key] = [];
      errorMessages[key].push(call);
    }
  }

  const signals = [];
  for (const [msg, calls] of Object.entries(errorMessages)) {
    if (calls.length >= cfg.min_count) {
      signals.push({
        type: 'error_loop',
        topic: inferTopic(calls),
        severity: Math.min(5, calls.length),
        evidence: { error_message: msg, occurrence_count: calls.length }
      });
    }
  }
  return signals;
}

function makeSignal(type, calls, count) {
  const sampleErrors = calls
    .filter(c => c.errorContent)
    .slice(0, 3)
    .map(c => c.errorContent.split('\n')[0].slice(0, 200));

  return {
    type,
    topic: inferTopic(calls),
    severity: Math.min(5, count - 1),
    evidence: {
      tool: calls[0]?.name,
      failure_count: count,
      sample_errors: sampleErrors
    }
  };
}

/**
 * Infer a topic string from tool calls.
 * Mechanical — no LLM. Uses file paths, tool args, and error content.
 */
export function inferTopic(calls) {
  const keywords = new Set();

  for (const call of calls) {
    // From tool arguments
    const cmd = call.input?.command || '';
    if (cmd.includes('playwright')) keywords.add('playwright');
    if (cmd.includes('npm')) keywords.add('npm');
    if (cmd.includes('git')) keywords.add('git');
    if (cmd.includes('python')) keywords.add('python');
    if (cmd.includes('cargo')) keywords.add('cargo');
    if (cmd.includes('docker')) keywords.add('docker');

    // From file paths
    const filePath = call.input?.file_path || call.input?.path || '';
    if (filePath) {
      const parts = filePath.split('/').filter(p => p && !p.startsWith('.'));
      // Take the most specific directory name
      if (parts.length >= 2) keywords.add(parts[parts.length - 2]);
    }

    // From error content
    const err = call.errorContent || '';
    if (err.toLowerCase().includes('react')) keywords.add('react');
    if (err.toLowerCase().includes('fiber')) keywords.add('react');
    if (err.toLowerCase().includes('timeout')) keywords.add('timeout');
    if (err.toLowerCase().includes('permission')) keywords.add('permission');
  }

  if (keywords.size === 0) return 'unknown';
  return [...keywords].sort().join('-');
}
