# Callus

**Skills Hardened Where It Hurts**

A Claude Code plugin that automatically detects recurring struggles across coding sessions, extracts reusable lessons, and forges them into skills — creating a closed-loop learning system.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](#zero-dependencies)
[![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-Plugin-blueviolet.svg)](https://code.claude.com/docs/en/plugins)

---

## The Metaphor

Calluses form where skin experiences repeated friction. This plugin forms **skills** where you repeatedly struggle.

Instead of making the same mistakes across sessions, Callus watches for patterns — repeated tool failures, file churn, error loops — and automatically proposes rules and skills to prevent them from happening again.

## How It Works

```
Session 1: You struggle with React fiber traversal          → Callus records signals
Session 2: Same fiber errors appear again                   → Signals accumulate
Session 3: Callus detects the pattern at startup            → Proposes a CLAUDE.md rule
Session N: Rule isn't enough, struggles persist             → Escalates to a standalone Skill
```

### The Three-Tier System

| Level | Trigger | Output | Purpose |
|-------|---------|--------|---------|
| **L1 Rule** | Same topic across 2+ sessions, severity ≥ 5 | One-line rule in CLAUDE.md | Quick guard rail |
| **L2 Skill** | 3+ sessions, severity ≥ 10, or L1 rule insufficient | Standalone `SKILL.md` file | Comprehensive guidance |
| **L3 Merge** | 3+ related skills in same domain | Pattern-level skill (originals archived) | Consolidation |

### Signal Detection

Callus runs **5 quantitative detectors** on every session transcript:

| Detector | What It Catches | Default Threshold |
|----------|----------------|-------------------|
| `repeated_tool_failure` | Same tool failing consecutively | 3+ times |
| `file_churn` | Same file edited over and over | 5+ edits |
| `approach_pivot` | "Let me try..." followed by different approach | Pattern match |
| `long_exploration` | 10+ consecutive reads without any writes | 10+ reads |
| `error_loop` | Same error message appearing repeatedly | 3+ times |

### Data Flow

```
┌─────────────────────────────────────────────────┐
│              Stop Hook (session end)             │
│                                                  │
│  stop-analyze.js                                 │
│  ├─ Parse transcript (JSONL)                     │
│  ├─ Run 5 quantitative detectors                 │
│  └─ Append signals to ~/.callus/signals.json     │
└──────────────────────┬──────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────┐
│          SessionStart Hook (next session)        │
│                                                  │
│  session-start-forge.js                          │
│  ├─ Aggregate signals by topic (30-day window)   │
│  ├─ Check three-tier thresholds                  │
│  ├─ Detect optional enhancements (claude-mem)    │
│  └─ Inject [callus] prompt → Claude proposes fix │
└─────────────────────────────────────────────────┘
```

## Installation

### From Source (recommended)

```bash
# Clone into Claude Code plugin directory
git clone https://github.com/wisdommen/Callus.git ~/.claude/plugins/marketplaces/callus

# Enable the plugin in Claude Code settings
# Add "callus@callus": true to enabledPlugins in ~/.claude/settings.json
```

Or manually add to `~/.claude/settings.json`:

```json
{
  "enabledPlugins": {
    "callus@callus": true
  }
}
```

### Verify Installation

Start a new Claude Code session. On first run, Callus automatically creates its data directory:

```
~/.callus/
├── config.json      # User configuration
├── signals.json     # Accumulated signals
└── registry.json    # Skill/rule metadata
```

## Usage

**Callus is fully automatic.** There's nothing to invoke manually.

1. **Use Claude Code normally.** Write code, debug, explore — do your thing.
2. **When a session ends**, the Stop hook silently analyzes the transcript for struggle patterns.
3. **When the next session starts**, if accumulated signals cross a threshold, Callus injects a `[callus]` prompt.
4. **Claude proposes an action** (a CLAUDE.md rule or a new skill) and **asks for your confirmation** before making any changes.

### Example: What You'll See

When Callus detects a recurring problem, at the start of your next session you'll see something like:

```
[callus] Detected recurring difficulty on the following topic:

Topic: playwright-react
Occurrences: 5 times across 2 sessions
Total severity: 12

Typical issues:
- [repeated_tool_failure] severity 2: Bash failed 3 times (Error: Cannot read fiber)
- [approach_pivot] severity 2: "Let me try a different approach."
- [error_loop] severity 3: Same error occurred 3 times

Suggested action: Append a rule to the project CLAUDE.md to prevent this class of issues.
Please draft a concise, actionable rule and ask the user for confirmation before adding it.
```

Claude then drafts a rule or skill, and asks you to confirm before writing anything.

### What Gets Generated

**L1 Rule** — A one-liner appended to your project's `CLAUDE.md`:
```markdown
# React Fiber: Don't use element.remove() on overlays — it crashes the React app. Use element.click() to dismiss instead.
```

**L2 Skill** — A standalone skill file at `~/.claude/skills/{topic}/SKILL.md`:
```markdown
---
name: playwright-react-fiber
description: Use when working with React fiber traversal in Playwright automation
---

## Don't Do
- Don't call element.remove() on React-managed overlays
- Don't dispatch synthetic mousedown events for autosuggest components

## Do Instead
- Use element.click() to dismiss overlays
- Walk fiber.return chain to find onSuggestionSelected callback
```

## Configuration

Edit `~/.callus/config.json` to customize behavior:

```json
{
  "enabled": true,
  "thresholds": {
    "l1_min_sessions": 2,
    "l1_min_total_severity": 5,
    "l2_min_sessions": 3,
    "l2_min_total_severity": 10,
    "l3_merge_cluster_size": 3,
    "time_window_days": 30,
    "cooldown_days": 7
  },
  "detectors": {
    "repeated_tool_failure": { "enabled": true, "min_count": 3 },
    "file_churn": { "enabled": true, "min_edits": 5 },
    "approach_pivot": {
      "enabled": true,
      "patterns": ["let me try", "different approach", "try another", "let's try"]
    },
    "long_exploration": { "enabled": true, "min_reads": 10 },
    "error_loop": { "enabled": true, "min_count": 3 }
  },
  "exclude_topics": [],
  "topic_groups": {
    "playwright": ["playwright-*", "cdp-*", "browser-*"]
  }
}
```

### Key Options

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Master switch for the plugin |
| `thresholds.l1_min_sessions` | `2` | Minimum sessions before proposing a rule |
| `thresholds.time_window_days` | `30` | Only consider signals from the last N days |
| `thresholds.cooldown_days` | `7` | Don't re-trigger for a topic within N days |
| `exclude_topics` | `[]` | Glob patterns for topics to ignore |
| `topic_groups` | `{}` | Group related topics for L3 merge detection |

## Optional Enhancements

Callus works standalone with zero dependencies. It automatically detects and integrates with these plugins when available:

| Plugin | Enhancement |
|--------|-------------|
| [claude-mem](https://github.com/thedotmack/claude-mem) | Adds `smart_search` hint to prompts for deeper historical context |
| [superpowers](https://github.com/anthropics/claude-plugins-official) | Adds `writing-skills` TDD hint when creating L2 skills |

No configuration needed — Callus detects them at runtime.

## Architecture

```
~/.claude/plugins/marketplaces/callus/
├── .claude-plugin/
│   └── plugin.json                    # Plugin manifest
├── plugin/
│   ├── hooks/
│   │   ├── hooks.json                 # Hook registration
│   │   ├── stop-analyze.js            # Stop hook: transcript → signals
│   │   └── session-start-forge.js     # SessionStart hook: signals → prompt
│   ├── lib/
│   │   ├── init.js                    # First-run init, config defaults
│   │   ├── transcript-parser.js       # JSONL transcript parser
│   │   ├── signal-store.js            # Signal persistence and aggregation
│   │   └── detector.js                # 5 quantitative detectors
│   └── skills/
│       └── callus/
│           └── SKILL.md               # Self-referential skill for analysis
└── tests/
    ├── test-transcript-parser.js
    ├── test-signal-store.js
    └── test-detector.js

~/.callus/                             # Runtime data (auto-created)
├── config.json
├── signals.json
└── registry.json
```

### Zero Dependencies

Callus uses only Node.js built-in modules (`fs`, `path`, `os`). No `npm install` required. Works on any machine with Claude Code installed.

## Development

### Run Tests

```bash
cd ~/.claude/plugins/marketplaces/callus
node tests/test-transcript-parser.js
node tests/test-signal-store.js
node tests/test-detector.js
```

### Local Development

```bash
# Load plugin from local directory
claude --plugin-dir ~/.claude/plugins/marketplaces/callus

# Debug hook execution
claude --debug
```

### Manual Hook Testing

```bash
# Test stop hook with a mock transcript
echo '{"session_id":"test","transcript_path":"/path/to/transcript.jsonl"}' | \
  node ~/.claude/plugins/marketplaces/callus/plugin/hooks/stop-analyze.js

# Test session-start hook
echo '{}' | node ~/.claude/plugins/marketplaces/callus/plugin/hooks/session-start-forge.js
```

## Roadmap

- [x] **Phase 1** — Signal collection + L1 CLAUDE.md rules
- [ ] **Phase 2** — Claude self-review (struggles + wins) + L2 skill creation
- [ ] **Phase 3** — Confidence scoring with decay, L3 merge, skill archival
- [ ] **Phase 4** — claude-mem deep integration, multilingual patterns, visualization

## Design Philosophy

1. **Three-tier graduated output** — Not every pattern deserves a full skill. Rules → Skills → Pattern Skills.
2. **User confirmation gate** — Callus never writes without your consent.
3. **Confidence with decay** — Skills that don't work auto-archive. Quality over quantity.
4. **Zero dependency** — Works on a clean Claude Code installation, enhances with existing plugins.
5. **Mechanical detection** — No LLM calls in hooks. Fast, deterministic, predictable.

## License

MIT
