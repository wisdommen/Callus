---
name: callus
description: Use when [callus] tagged prompt is injected about recurring struggles, to analyze patterns and create/iterate/merge skills from experience
---

# Callus — Forge Skills from Experience

## Trigger
Only activates when a [callus] tagged prompt is injected by the SessionStart hook. Never invoke proactively.

## Modes

### Mode A: New CLAUDE.md Rule (L1)
1. Read the injected signal summary
2. Draft a concise, actionable one-line rule
3. Ask user for confirmation
4. If confirmed: append to project CLAUDE.md, update ~/.callus/registry.json

### Mode B: New Skill (L2)
1. Read signal summary and self-review data
2. (Optional) Use claude-mem smart_search for deeper history if available
3. Create ~/.claude/skills/{topic}/SKILL.md with:
   - YAML frontmatter: name (letters/numbers/hyphens), description starting with "Use when..."
   - "Don't do" section (from struggles/failures)
   - "Do instead" section (from wins/successes)
   - "Common pitfalls" section
4. Ask user for confirmation before writing
5. Update ~/.callus/registry.json with new skill entry

### Mode C: Iterate Existing Skill
1. Read current skill content
2. Identify what scenarios the skill missed
3. Add missing content, increment version in registry
4. Ask user for confirmation

### Mode D: Merge (L3)
1. Read all precise skills in the cluster
2. Extract shared principles
3. Create pattern-level skill: principles → specific scenarios (referencing originals)
4. Archive originals to ~/.callus/archive/
5. Ask user for confirmation

## Quality Gate
- Rule/Skill must be actionable: read it → avoid the trap
- Format: "Don't do X because Y. Do Z instead."
- Skills < 200 words for frequently-loaded; details in supporting files
- If uncertain → don't create. Ask user.
