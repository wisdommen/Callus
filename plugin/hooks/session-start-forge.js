#!/usr/bin/env node

/**
 * Callus SessionStart Hook — Signal Aggregation & Prompt Injection
 *
 * Reads signals.json, aggregates by topic, checks thresholds,
 * and injects a prompt for Claude to create CLAUDE.md rules or skills.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { SignalStore } from '../lib/signal-store.js';
import { loadConfig, ensureInit, SIGNALS_PATH, REGISTRY_PATH } from '../lib/init.js';

function main() {
  try {
    ensureInit();
    const config = loadConfig();
    if (!config.enabled) {
      process.exit(0);
    }

    const store = new SignalStore(SIGNALS_PATH);
    const aggregated = store.aggregateByTopic(config.thresholds.time_window_days);

    // Load registry to check existing skills and cooldowns
    const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));

    // Find topics that exceed thresholds
    const candidates = [];
    for (const [topic, data] of Object.entries(aggregated)) {
      // Check exclusions
      if (config.exclude_topics.some(pat => matchGlob(topic, pat))) continue;

      // Check cooldown
      if (isInCooldown(topic, registry, config.thresholds.cooldown_days)) continue;

      // Determine level
      const hasExistingRule = registry.claude_md_rules?.some(r => r.topic === topic && !r.promoted_to_skill);
      const hasExistingSkill = registry.skills?.[topic]?.versions?.some(v => v.status === 'active');

      let level = null;
      if (hasExistingSkill) {
        // Check if skill is ineffective (still producing signals)
        level = 'iterate';
      } else if (hasExistingRule && data.session_count >= config.thresholds.l2_min_sessions && data.total_severity >= config.thresholds.l2_min_total_severity) {
        level = 'l2_skill';
      } else if (!hasExistingRule && data.session_count >= config.thresholds.l1_min_sessions && data.total_severity >= config.thresholds.l1_min_total_severity) {
        level = 'l1_rule';
      } else if (data.session_count >= config.thresholds.l2_min_sessions && data.total_severity >= config.thresholds.l2_min_total_severity) {
        level = 'l2_skill';
      }

      if (level) {
        candidates.push({ topic, level, data });
      }
    }

    // Check for L3 merge candidates
    const activeSkills = Object.entries(registry.skills || {})
      .filter(([_, s]) => s.versions?.some(v => v.status === 'active' && v.granularity === 'precise'));
    const mergeClusters = findMergeClusters(activeSkills, config);
    for (const cluster of mergeClusters) {
      candidates.push({
        topic: cluster.map(([t]) => t).join('+'),
        level: 'l3_merge',
        data: { skills: cluster }
      });
    }

    if (candidates.length === 0) {
      process.exit(0);
    }

    // Build and output prompt
    const prompt = buildPrompt(candidates, config, registry);
    console.log(prompt);
    process.exit(0);

  } catch (e) {
    // Never block startup on error
    process.exit(0);
  }
}

function buildPrompt(candidates, config, registry) {
  const sections = [];

  // Detect optional enhancements
  const hasClaudeMem = existsSync(join(process.env.HOME, '.claude-mem', 'claude-mem.db'));
  const hasWritingSkills = existsSync(join(
    process.env.HOME, '.claude', 'plugins', 'cache', 'claude-plugins-official', 'superpowers'
  ));

  for (const { topic, level, data } of candidates) {
    if (level === 'l1_rule') {
      sections.push(buildL1Prompt(topic, data, hasClaudeMem));
    } else if (level === 'l2_skill') {
      sections.push(buildL2Prompt(topic, data, hasClaudeMem, hasWritingSkills, registry));
    } else if (level === 'iterate') {
      sections.push(buildIteratePrompt(topic, data, registry));
    } else if (level === 'l3_merge') {
      sections.push(buildMergePrompt(data.skills, registry));
    }
  }

  return sections.join('\n\n---\n\n');
}

function buildL1Prompt(topic, data, hasClaudeMem) {
  const evidence = data.signals.slice(0, 5).map(s =>
    `- [${s.type}] severity ${s.severity}: ${JSON.stringify(s.evidence).slice(0, 150)}`
  ).join('\n');

  const selfReviews = data.self_reviews.flatMap(r => [
    ...r.struggles.filter(s => s.topic === topic).map(s => `- Struggle: ${s.what_happened} -> Lesson: ${s.lesson}`),
    ...r.wins.filter(w => w.topic === topic).map(w => `- Successful pattern: ${w.pattern}`)
  ]).join('\n');

  let prompt = `[callus] Detected recurring difficulty on the following topic:

Topic: ${topic}
Occurrences: ${data.signal_count} times across ${data.session_count} sessions
Total severity: ${data.total_severity}

Typical issues:
${evidence}
${selfReviews ? `\nSelf-review summary:\n${selfReviews}` : ''}

Suggested action: Append a rule to the project CLAUDE.md to prevent this class of issues.
Please draft a concise, actionable rule and ask the user for confirmation before adding it.`;

  if (hasClaudeMem) {
    prompt += `\n\nHint: You can use smart_search to find more historical context about "${topic}".`;
  }

  return prompt;
}

function buildL2Prompt(topic, data, hasClaudeMem, hasWritingSkills, registry) {
  const existingRule = registry.claude_md_rules?.find(r => r.topic === topic);
  const evidence = data.signals.slice(0, 5).map(s =>
    `- [${s.type}] severity ${s.severity}: ${JSON.stringify(s.evidence).slice(0, 150)}`
  ).join('\n');

  const selfReviews = data.self_reviews.flatMap(r => [
    ...r.struggles.filter(s => s.topic === topic).map(s => `- Don't: ${s.what_happened} (root cause: ${s.root_cause})`),
    ...r.wins.filter(w => w.topic === topic).map(w => `- Do: ${w.pattern}`)
  ]).join('\n');

  let prompt = `[callus] Recurring difficulty escalated — suggesting a standalone Skill:

Topic: ${topic}
Occurrences: ${data.signal_count} times across ${data.session_count} sessions
Total severity: ${data.total_severity}
${existingRule ? `Existing CLAUDE.md rule (insufficient): "${existingRule.rule}"` : ''}

Evidence:
${evidence}
${selfReviews ? `\nLessons learned:\n${selfReviews}` : ''}

Suggested action: Create a Skill at ~/.claude/skills/${topic}/SKILL.md
The skill should have two sections: "Don't do" (from failures) and "Do instead" (from successes).
Please ask the user for confirmation before creating.`;

  if (hasWritingSkills) prompt += `\n\nHint: Follow the writing-skills TDD process to create the skill.`;
  if (hasClaudeMem) prompt += `\nHint: You can use smart_search to find more historical context about "${topic}".`;

  return prompt;
}

function buildIteratePrompt(topic, data, registry) {
  const skill = registry.skills[topic];
  const activeVersion = skill.versions.find(v => v.status === 'active');

  return `[callus] Skill "${topic}" (v${activeVersion.version}, confidence: ${skill.confidence}) has not prevented recurrence:

Skill path: ${activeVersion.path}
Post-skill signals: ${data.signal_count} occurrences
New lessons: ${data.self_reviews.flatMap(r => r.struggles.filter(s => s.topic === topic).map(s => s.lesson)).join('; ')}

Suggested action: Iterate the skill with missing scenarios. Please ask the user for confirmation.`;
}

function buildMergePrompt(skills, registry) {
  const list = skills.map(([topic, _]) => {
    const active = registry.skills[topic]?.versions?.find(v => v.status === 'active');
    return `- ${topic} (${active?.path})`;
  }).join('\n');

  return `[callus] The following ${skills.length} precise skills belong to the same domain and can be merged into a pattern-level skill:

${list}

Suggested action: Create a new pattern-level skill consolidating the above, then archive originals to ~/.callus/archive/.
Please ask the user for confirmation.`;
}

function findMergeClusters(activeSkills, config) {
  if (activeSkills.length < config.thresholds.l3_merge_cluster_size) return [];

  // Group by topic prefix (first segment before -)
  const groups = {};
  for (const [topic, skill] of activeSkills) {
    const prefix = topic.split('-')[0];
    // Also check configured topic_groups
    let groupKey = prefix;
    for (const [group, patterns] of Object.entries(config.topic_groups || {})) {
      if (patterns.some(pat => matchGlob(topic, pat))) {
        groupKey = group;
        break;
      }
    }
    if (!groups[groupKey]) groups[groupKey] = [];
    groups[groupKey].push([topic, skill]);
  }

  return Object.values(groups).filter(g => g.length >= config.thresholds.l3_merge_cluster_size);
}

function isInCooldown(topic, registry, cooldownDays) {
  // Check if this topic was recently triggered
  const skill = registry.skills?.[topic];
  if (!skill) return false;
  const lastVersion = skill.versions?.[skill.versions.length - 1];
  if (!lastVersion) return false;
  const daysSince = (Date.now() - new Date(lastVersion.created).getTime()) / (24 * 60 * 60 * 1000);
  return daysSince < cooldownDays;
}

function matchGlob(str, pattern) {
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  return regex.test(str);
}

main();
