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
    ...r.struggles.filter(s => s.topic === topic).map(s => `- 困难: ${s.what_happened} → 教训: ${s.lesson}`),
    ...r.wins.filter(w => w.topic === topic).map(w => `- 成功模式: ${w.pattern}`)
  ]).join('\n');

  let prompt = `[callus] 检测到你在以下主题上反复遇到困难：

主题: ${topic}
出现次数: ${data.signal_count} 次，跨 ${data.session_count} 个 session
总严重度: ${data.total_severity}

典型问题:
${evidence}
${selfReviews ? `\n自评摘要:\n${selfReviews}` : ''}

建议动作：在项目 CLAUDE.md 中追加一条规则来防止此类问题。
请起草一条简洁、可操作的规则，并在添加前征求用户确认。`;

  if (hasClaudeMem) {
    prompt += `\n\n提示：可以使用 smart_search 工具搜索更多关于 "${topic}" 的历史上下文。`;
  }

  return prompt;
}

function buildL2Prompt(topic, data, hasClaudeMem, hasWritingSkills, registry) {
  const existingRule = registry.claude_md_rules?.find(r => r.topic === topic);
  const evidence = data.signals.slice(0, 5).map(s =>
    `- [${s.type}] severity ${s.severity}: ${JSON.stringify(s.evidence).slice(0, 150)}`
  ).join('\n');

  const selfReviews = data.self_reviews.flatMap(r => [
    ...r.struggles.filter(s => s.topic === topic).map(s => `- 不要做: ${s.what_happened} (根因: ${s.root_cause})`),
    ...r.wins.filter(w => w.topic === topic).map(w => `- 应该做: ${w.pattern}`)
  ]).join('\n');

  let prompt = `[callus] 反复困难升级，建议创建独立 Skill：

主题: ${topic}
出现次数: ${data.signal_count} 次，跨 ${data.session_count} 个 session
总严重度: ${data.total_severity}
${existingRule ? `已有 CLAUDE.md 规则（不足以解决问题）: "${existingRule.rule}"` : ''}

证据:
${evidence}
${selfReviews ? `\n经验总结:\n${selfReviews}` : ''}

建议动作：在 ~/.claude/skills/${topic}/SKILL.md 创建一个 Skill。
Skill 应包含两个 section："不要做"（失败教训）和 "应该做"（成功模式）。
创建前请征求用户确认。`;

  if (hasWritingSkills) prompt += `\n\n提示：请遵循 writing-skills 的 TDD 规范来创建 skill。`;
  if (hasClaudeMem) prompt += `\n提示：可以使用 smart_search 工具搜索更多关于 "${topic}" 的历史上下文。`;

  return prompt;
}

function buildIteratePrompt(topic, data, registry) {
  const skill = registry.skills[topic];
  const activeVersion = skill.versions.find(v => v.status === 'active');

  return `[callus] Skill "${topic}" (v${activeVersion.version}, 置信度: ${skill.confidence}) 未能防止同类问题复现：

Skill 路径: ${activeVersion.path}
创建后仍出现的信号: ${data.signal_count} 次
新的教训: ${data.self_reviews.flatMap(r => r.struggles.filter(s => s.topic === topic).map(s => s.lesson)).join('; ')}

建议动作：迭代升级该 Skill，补充遗漏的场景。请征求用户确认。`;
}

function buildMergePrompt(skills, registry) {
  const list = skills.map(([topic, _]) => {
    const active = registry.skills[topic]?.versions?.find(v => v.status === 'active');
    return `- ${topic} (${active?.path})`;
  }).join('\n');

  return `[callus] 以下 ${skills.length} 个精确 Skill 属于同一领域，建议合并为模式级 Skill：

${list}

建议动作：创建一个新的模式级 Skill 整合以上内容，然后归档原有 Skill 到 ~/.callus/archive/。
请征求用户确认。`;
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
