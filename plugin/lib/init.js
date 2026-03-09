import fs from 'fs';
import path from 'path';

const CALLUS_DIR = path.join(process.env.HOME, '.callus');
const SIGNALS_PATH = path.join(CALLUS_DIR, 'signals.json');
const REGISTRY_PATH = path.join(CALLUS_DIR, 'registry.json');
const CONFIG_PATH = path.join(CALLUS_DIR, 'config.json');

const DEFAULT_CONFIG = {
  enabled: true,
  self_review: {
    enabled: true,
    min_severity_to_trigger: 3,
    timeout_ms: 5000
  },
  thresholds: {
    l1_min_sessions: 2,
    l1_min_total_severity: 5,
    l2_min_sessions: 3,
    l2_min_total_severity: 10,
    l3_merge_cluster_size: 3,
    time_window_days: 30,
    cooldown_days: 7,
    effectiveness_min_sessions: 5,
    effectiveness_failure_ratio: 0.5
  },
  detectors: {
    repeated_tool_failure: { enabled: true, min_count: 3 },
    file_churn: { enabled: true, min_edits: 5 },
    approach_pivot: {
      enabled: true,
      patterns: [
        "让我换个方法", "试试另一种", "换一种方式",
        "let me try", "different approach", "try another", "let's try"
      ]
    },
    long_exploration: { enabled: true, min_reads: 10 },
    error_loop: { enabled: true, min_count: 3 }
  },
  exclude_topics: [],
  topic_groups: {},
  language: "zh-CN"
};

const DEFAULT_SIGNALS = { signals: [], self_reviews: [] };
const DEFAULT_REGISTRY = { skills: {}, claude_md_rules: [] };

export function ensureInit() {
  if (!fs.existsSync(CALLUS_DIR)) {
    fs.mkdirSync(CALLUS_DIR, { recursive: true });
  }
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }
  if (!fs.existsSync(SIGNALS_PATH)) {
    fs.writeFileSync(SIGNALS_PATH, JSON.stringify(DEFAULT_SIGNALS, null, 2));
  }
  if (!fs.existsSync(REGISTRY_PATH)) {
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(DEFAULT_REGISTRY, null, 2));
  }
}

export function loadConfig() {
  ensureInit();
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

export { CALLUS_DIR, SIGNALS_PATH, REGISTRY_PATH, CONFIG_PATH };
