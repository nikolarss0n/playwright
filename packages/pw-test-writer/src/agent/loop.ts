import Anthropic from '@anthropic-ai/sdk';
import { tools, executeTool } from '../tools/index.js';
import { SYSTEM_PROMPT } from './prompt.js';
import { store } from '../ui/store.js';
import { getBrowserSession } from '../browser/context.js';
import { scanExistingTests } from '../config/playwright.js';

const client = new Anthropic();

export interface AgentOptions {
  model?: string;
  headless?: boolean;
  baseURL?: string;
}

export async function runAgent(task: string, options: AgentOptions = {}): Promise<void> {
  const model = options.model || 'claude-haiku-4-5-20251001';

  store.setTask(task);
  store.setIsRunning(true);
  store.setStatus('Starting...');

  // Scan existing tests
  const existingTests = scanExistingTests();

  // Build task context
  let taskContent = '';

  if (options.baseURL) {
    taskContent += `Base URL: ${options.baseURL}\n\n`;
  }

  if (existingTests.length > 0) {
    taskContent += `Existing Tests:\n`;
    for (const test of existingTests) {
      taskContent += `- ${test.file}: ${test.description}\n`;
    }
    taskContent += `\nIf the task is similar to an existing test, consider extending it or reusing its patterns.\n\n`;
  }

  taskContent += `Task: ${task}`;

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: taskContent,
    },
  ];

  try {
    let continueLoop = true;
    let iterations = 0;
    const maxIterations = 50;

    while (continueLoop && iterations < maxIterations) {
      iterations++;
      store.setStatus(`Thinking... (step ${iterations})`);

      const response = await client.messages.create({
        model,
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        tools,
        messages,
      });

      // Process response content
      const assistantContent: Anthropic.ContentBlock[] = [];
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        assistantContent.push(block);

        if (block.type === 'text') {
          if (block.text.trim()) {
            const stepId = store.addStep(block.text.slice(0, 80));
            store.updateStep(stepId, 'done');
          }
        } else if (block.type === 'tool_use') {
          const stepId = store.addStep(block.name);
          store.updateStep(stepId, 'running');
          store.setStatus(`Executing: ${block.name}`);

          try {
            const result = await executeTool(block.name, block.input as Record<string, any>);
            store.updateStep(stepId, 'done', result.slice(0, 60));
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: result,
            });
          } catch (error: any) {
            store.updateStep(stepId, 'error', error.message);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: `Error: ${error.message}`,
              is_error: true,
            });
          }
        }
      }

      // Add assistant message
      messages.push({
        role: 'assistant',
        content: assistantContent,
      });

      // If there were tool uses, add results and continue
      if (toolResults.length > 0) {
        messages.push({
          role: 'user',
          content: toolResults,
        });
      }

      // Check if we should stop
      if (response.stop_reason === 'end_turn' && toolResults.length === 0) {
        continueLoop = false;
      }
    }

    // Cleanup
    try {
      await getBrowserSession().close();
    } catch {}

    store.setStatus('Done! Enter new task or F12 to reset');
  } catch (error: any) {
    store.setStatus(`Error: ${error.message} - Enter new task to retry`);
  } finally {
    store.setIsRunning(false);
  }
}
