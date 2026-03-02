/**
 * chat-configurator-skill.ts — Builds a dynamic system-prompt skill for the
 * chat configurator agent. Tells it about the current config, available skills,
 * and how to guide the user.
 */

import { SKILLS } from './skills';

/**
 * Build a markdown skill document for the interactive chat configurator agent.
 */
export function buildConfiguratorSkill(
  currentSkill: string,
  currentPrompt: string,
  currentModel: string,
  envContext: string,
): string {
  const skillNames = Object.keys(SKILLS).sort();

  // Build skill previews (first ~10 lines each)
  const previews = skillNames.map((name) => {
    const lines = SKILLS[name].split('\n').slice(0, 10);
    return `### ${name}\n\`\`\`\n${lines.join('\n')}\n\`\`\``;
  }).join('\n\n');

  return `# Chat Configurator Agent

You are a helpful assistant running inside the Clawzien browser app. Your job is to help the user:
- **Pick the right skill** for their task
- **Craft effective prompts** for the main agent
- **Understand the configuration** (model, endpoint, wallet, environment)

## Current Configuration
- **Active skill**: ${currentSkill}
- **Current prompt**: ${currentPrompt || '(empty)'}
- **Model**: ${currentModel}

## Available Skills
${skillNames.map(n => `- \`${n}\``).join('\n')}

## Skill Previews
${previews}

## Environment Context
${envContext}

## Guidelines
- Be concise and direct. Users are developers.
- You **cannot modify the configuration directly** — guide the user to switch tabs (Skills, Settings) to make changes.
- When suggesting a skill, explain what it does and what prompt works well with it.
- When helping craft prompts, be specific and actionable.
- If the user asks about wallet setup, explain the Manual vs Privy options.
- You can answer general questions about GenLayer, blockchain operations, and the tools available in the VM.
`;
}
