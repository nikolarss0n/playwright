/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { MultiTraceModel } from '../ui/modelUtil';
import type { MCPTool, MCPToolResult } from './traceAnalysisMCP';

/**
 * Tools for querying DOM snapshots from trace data
 */
export class DOMQueryTools {
  constructor(private getTrace: () => MultiTraceModel | null) {}

  getTools(): MCPTool[] {
    return [
      {
        name: 'trace_get_dom_snapshot',
        description: 'Get HTML DOM snapshot at a specific timestamp or action',
        inputSchema: {
          type: 'object',
          properties: {
            timestamp: {
              type: 'number',
              description: 'Get DOM at this timestamp (ms from test start)',
            },
            actionId: {
              type: 'string',
              description: 'Get DOM snapshot for this specific action',
            },
          },
        },
      },
      {
        name: 'trace_query_dom',
        description: 'Query DOM snapshot using CSS selector, XPath, or text content',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector, XPath, or text to search for',
            },
            selectorType: {
              type: 'string',
              description: 'Type of selector: "css", "xpath", "text", or "role"',
            },
            timestamp: {
              type: 'number',
              description: 'Query DOM at this timestamp',
            },
            actionId: {
              type: 'string',
              description: 'Query DOM at this action',
            },
          },
          required: ['selector'],
        },
      },
      {
        name: 'trace_find_element',
        description: 'Find element in DOM by various attributes (text, role, label, test-id, placeholder)',
        inputSchema: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'Search by visible text content',
            },
            role: {
              type: 'string',
              description: 'Search by ARIA role (button, link, textbox, etc.)',
            },
            label: {
              type: 'string',
              description: 'Search by associated label text',
            },
            testId: {
              type: 'string',
              description: 'Search by data-testid attribute',
            },
            placeholder: {
              type: 'string',
              description: 'Search by placeholder text',
            },
            timestamp: {
              type: 'number',
            },
            actionId: {
              type: 'string',
            },
          },
        },
      },
      {
        name: 'trace_get_element_properties',
        description: 'Get detailed properties of an element (attributes, computed styles, position, visibility)',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector to find the element',
            },
            timestamp: {
              type: 'number',
            },
            actionId: {
              type: 'string',
            },
          },
          required: ['selector'],
        },
      },
    ];
  }

  async callTool(name: string, args: any): Promise<MCPToolResult> {
    const trace = this.getTrace();
    if (!trace) {
      return {
        content: [{
          type: 'text',
          text: 'No trace data available.',
        }],
        isError: true,
      };
    }

    try {
      switch (name) {
        case 'trace_get_dom_snapshot':
          return this.getDomSnapshot(trace, args);
        case 'trace_query_dom':
          return this.queryDom(trace, args);
        case 'trace_find_element':
          return this.findElement(trace, args);
        case 'trace_get_element_properties':
          return this.getElementProperties(trace, args);
        default:
          return {
            content: [{
              type: 'text',
              text: `Unknown tool: ${name}`,
            }],
            isError: true,
          };
      }
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  }

  private getDomSnapshot(trace: MultiTraceModel, args: any): MCPToolResult {
    const snapshot = this.findSnapshot(trace, args.timestamp, args.actionId);

    if (!snapshot) {
      return {
        content: [{
          type: 'text',
          text: 'No DOM snapshot found for the specified timestamp or action.',
        }],
        isError: true,
      };
    }

    // Return truncated HTML for overview
    const html = snapshot.html || '';
    const truncated = html.length > 5000 ? html.substring(0, 5000) + '\n...(truncated)' : html;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          timestamp: snapshot.timestamp,
          url: snapshot.url,
          htmlLength: html.length,
          htmlPreview: truncated,
        }, null, 2),
      }],
    };
  }

  private queryDom(trace: MultiTraceModel, args: any): MCPToolResult {
    const snapshot = this.findSnapshot(trace, args.timestamp, args.actionId);

    if (!snapshot) {
      return {
        content: [{
          type: 'text',
          text: 'No DOM snapshot found.',
        }],
        isError: true,
      };
    }

    // For now, return a simplified implementation
    // In a real implementation, we'd use jsdom or similar to query the DOM
    const html = snapshot.html || '';
    const selectorType = args.selectorType || 'css';

    let matches: string[] = [];
    if (selectorType === 'text') {
      // Simple text search
      const regex = new RegExp(args.selector, 'gi');
      const textMatches = html.match(regex);
      matches = textMatches ? [...new Set(textMatches)] : [];
    } else {
      // For CSS/XPath, we'd need proper DOM parsing
      // This is a placeholder - proper implementation would use jsdom
      matches = [`CSS selector "${args.selector}" - DOM parsing not yet implemented in this prototype`];
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          selector: args.selector,
          selectorType,
          matches: matches.slice(0, 10),
          totalMatches: matches.length,
          note: 'Full DOM query implementation requires jsdom integration',
        }, null, 2),
      }],
    };
  }

  private findElement(trace: MultiTraceModel, args: any): MCPToolResult {
    const snapshot = this.findSnapshot(trace, args.timestamp, args.actionId);

    if (!snapshot) {
      return {
        content: [{
          type: 'text',
          text: 'No DOM snapshot found.',
        }],
        isError: true,
      };
    }

    const html = snapshot.html || '';
    const searches: string[] = [];

    if (args.text) {
      // Search for text content
      const regex = new RegExp(`>${args.text}<`, 'i');
      if (regex.test(html)) {
        searches.push(`Found text: "${args.text}"`);
      }
    }

    if (args.testId) {
      // Search for data-testid
      const regex = new RegExp(`data-testid="${args.testId}"`, 'i');
      if (regex.test(html)) {
        searches.push(`Found test-id: "${args.testId}"`);
      }
    }

    if (args.role) {
      // Search for ARIA role
      const regex = new RegExp(`role="${args.role}"`, 'i');
      if (regex.test(html)) {
        searches.push(`Found role: "${args.role}"`);
      }
    }

    if (args.placeholder) {
      // Search for placeholder
      const regex = new RegExp(`placeholder="${args.placeholder}"`, 'i');
      if (regex.test(html)) {
        searches.push(`Found placeholder: "${args.placeholder}"`);
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          found: searches.length > 0,
          results: searches,
          note: 'Full element finding requires jsdom integration for accurate results',
        }, null, 2),
      }],
    };
  }

  private getElementProperties(trace: MultiTraceModel, args: any): MCPToolResult {
    const snapshot = this.findSnapshot(trace, args.timestamp, args.actionId);

    if (!snapshot) {
      return {
        content: [{
          type: 'text',
          text: 'No DOM snapshot found.',
        }],
        isError: true,
      };
    }

    // Placeholder - real implementation would use jsdom
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          selector: args.selector,
          note: 'Element property extraction requires jsdom integration',
          availableInSnapshot: true,
        }, null, 2),
      }],
    };
  }

  private findSnapshot(trace: MultiTraceModel, timestamp?: number, actionId?: string): any {
    // Find snapshot from resources
    if (trace.resources.length === 0) {
      return null;
    }

    if (actionId) {
      // Find action and get its timestamp
      const action = trace.actions.find(a => a.callId === actionId);
      if (action) {
        timestamp = action.startTime;
      }
    }

    if (timestamp !== undefined) {
      // Find closest snapshot before or at timestamp
      const snapshots = trace.resources
        .filter(r => (r as any).timestamp !== undefined)
        .sort((a, b) => (b as any).timestamp - (a as any).timestamp);

      for (const snapshot of snapshots) {
        if ((snapshot as any).timestamp <= timestamp) {
          return snapshot;
        }
      }
    }

    // Return most recent snapshot
    return trace.resources[trace.resources.length - 1] || null;
  }
}
