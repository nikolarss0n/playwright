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

import { asLocator, asLocators } from '@isomorphic/locatorGenerators';
import type { Language } from '@isomorphic/locatorGenerators';
import type { MultiTraceModel } from '../ui/modelUtil';
import type { MCPTool, MCPToolResult } from './traceAnalysisMCP';

/**
 * Tools for testing and generating Playwright locators
 * Reuses existing locatorGenerators from Playwright core
 */
export class LocatorTools {
  constructor(private getTrace: () => MultiTraceModel | null) {}

  getTools(): MCPTool[] {
    return [
      {
        name: 'trace_generate_locator',
        description: 'Generate Playwright locator code from a CSS selector or element description. Returns multiple alternatives ranked by best practice.',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector or Playwright selector to convert (e.g., "#submit", "button.primary", "[data-testid=submit]")',
            },
            language: {
              type: 'string',
              description: 'Programming language for generated code: javascript, python, java, csharp',
            },
            maxSuggestions: {
              type: 'number',
              description: 'Maximum number of alternative locators to return (default: 5)',
            },
          },
          required: ['selector'],
        },
      },
      {
        name: 'trace_test_locator',
        description: 'Test if a Playwright locator would have matched elements in the DOM snapshot. CRITICAL for debugging selector issues!',
        inputSchema: {
          type: 'object',
          properties: {
            locator: {
              type: 'string',
              description: 'Playwright locator code to test (e.g., "page.getByRole(\'button\', { name: \'Submit\' })" or ".submit-btn")',
            },
            timestamp: {
              type: 'number',
              description: 'Test against DOM at this timestamp',
            },
            actionId: {
              type: 'string',
              description: 'Test against DOM at this action',
            },
          },
          required: ['locator'],
        },
      },
      {
        name: 'trace_suggest_better_locators',
        description: 'Analyze a failing or brittle locator and suggest more robust alternatives following Playwright best practices',
        inputSchema: {
          type: 'object',
          properties: {
            currentLocator: {
              type: 'string',
              description: 'The locator that failed or needs improvement',
            },
            failureReason: {
              type: 'string',
              description: 'Why the locator failed (e.g., "element not found", "multiple elements matched", "flaky")',
            },
            language: {
              type: 'string',
              description: 'Programming language: javascript, python, java, csharp',
            },
          },
          required: ['currentLocator'],
        },
      },
      {
        name: 'trace_convert_locator_syntax',
        description: 'Convert between different locator syntaxes (CSS to getByRole, XPath to CSS, etc.)',
        inputSchema: {
          type: 'object',
          properties: {
            locator: {
              type: 'string',
              description: 'Locator to convert',
            },
            fromSyntax: {
              type: 'string',
              description: 'Source syntax: css, xpath, playwright',
            },
            toSyntax: {
              type: 'string',
              description: 'Target syntax: css, xpath, playwright',
            },
            language: {
              type: 'string',
              description: 'Target language if converting to Playwright syntax',
            },
          },
          required: ['locator', 'fromSyntax', 'toSyntax'],
        },
      },
    ];
  }

  async callTool(name: string, args: any): Promise<MCPToolResult> {
    try {
      switch (name) {
        case 'trace_generate_locator':
          return this.generateLocator(args);
        case 'trace_test_locator':
          return this.testLocator(args);
        case 'trace_suggest_better_locators':
          return this.suggestBetterLocators(args);
        case 'trace_convert_locator_syntax':
          return this.convertLocatorSyntax(args);
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

  private generateLocator(args: any): MCPToolResult {
    const selector = args.selector;
    const language = (args.language || 'javascript') as Language;
    const maxSuggestions = args.maxSuggestions || 5;

    try {
      // Use Playwright's existing locator generator!
      const locators = asLocators(language, selector, false, maxSuggestions);

      if (locators.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `Could not generate locators for selector: ${selector}`,
          }],
          isError: true,
        };
      }

      // Rank locators by best practice
      const ranked = this.rankLocators(locators);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            selector,
            language,
            recommended: ranked[0].locator,
            alternatives: ranked.slice(1).map(r => r.locator),
            explanation: ranked[0].explanation,
            bestPractices: [
              '1. Prefer user-facing attributes (role, label, text)',
              '2. Use test-ids for elements without good semantics',
              '3. Avoid CSS classes and complex selectors',
              '4. Ensure locator is unique and stable',
            ],
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Failed to generate locator: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  }

  private testLocator(args: any): MCPToolResult {
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

    const locator = args.locator;

    // Parse the locator to understand what it's trying to match
    const parsed = this.parseLocatorString(locator);

    // For now, provide analysis without actual DOM testing
    // Real implementation would use jsdom to test against snapshot
    const analysis = {
      locator,
      parsed,
      wouldPass: 'unknown - requires jsdom integration',
      suggestions: [
        'DOM testing requires full implementation with jsdom',
        'This would test: ' + parsed.description,
      ],
      bestPractices: this.getLocatorBestPractices(parsed),
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(analysis, null, 2),
      }],
    };
  }

  private suggestBetterLocators(args: any): MCPToolResult {
    const currentLocator = args.currentLocator;
    const failureReason = args.failureReason || 'unknown';
    const language = (args.language || 'javascript') as Language;

    // Analyze the current locator
    const parsed = this.parseLocatorString(currentLocator);

    // Generate suggestions based on failure reason
    const suggestions = this.generateSuggestions(parsed, failureReason, language);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          currentLocator,
          failureReason,
          issues: parsed.issues,
          suggestions: suggestions.map(s => ({
            locator: s.locator,
            reason: s.reason,
            priority: s.priority,
          })),
          explanation: this.explainIssues(parsed, failureReason),
        }, null, 2),
      }],
    };
  }

  private convertLocatorSyntax(args: any): MCPToolResult {
    const locator = args.locator;
    const fromSyntax = args.fromSyntax;
    const toSyntax = args.toSyntax;

    if (toSyntax === 'playwright') {
      // Convert to Playwright locator using existing generator
      const language = (args.language || 'javascript') as Language;
      try {
        const converted = asLocator(language, locator, false);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              original: locator,
              converted,
              language,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Conversion failed: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    }

    return {
      content: [{
        type: 'text',
        text: 'Conversion between other syntaxes not yet implemented',
      }],
    };
  }

  private parseLocatorString(locator: string): any {
    const issues: string[] = [];
    let type = 'unknown';
    let description = locator;

    // Detect locator type and issues
    if (locator.includes('getByRole')) {
      type = 'role-based';
      description = 'Uses ARIA roles - BEST PRACTICE ✓';
    } else if (locator.includes('getByTestId')) {
      type = 'test-id';
      description = 'Uses test-id - Good for non-semantic elements ✓';
    } else if (locator.includes('getByText') || locator.includes('getByLabel')) {
      type = 'text-based';
      description = 'Uses visible text - Good for user-facing elements ✓';
    } else if (locator.match(/\[class.*=|\.[\w-]+/)) {
      type = 'css-class';
      description = 'Uses CSS classes - BRITTLE ⚠';
      issues.push('CSS classes can change with styling updates');
      issues.push('Not tied to user-facing behavior');
    } else if (locator.includes(':nth-child') || locator.includes(':nth-of-type')) {
      type = 'positional';
      description = 'Uses position in DOM - VERY BRITTLE ⚠⚠';
      issues.push('Position-based selectors break when DOM structure changes');
      issues.push('Consider using role, text, or test-id instead');
    } else if (locator.includes('//') || locator.startsWith('/')) {
      type = 'xpath';
      description = 'Uses XPath - Consider converting to Playwright locators';
      issues.push('XPath can be hard to read and maintain');
    }

    return {
      type,
      description,
      issues,
      original: locator,
    };
  }

  private rankLocators(locators: string[]): Array<{ locator: string; score: number; explanation: string }> {
    return locators.map(locator => {
      let score = 0;
      let explanation = '';

      if (locator.includes('getByRole')) {
        score = 100;
        explanation = 'Role-based locator - follows accessibility best practices';
      } else if (locator.includes('getByLabel')) {
        score = 90;
        explanation = 'Label-based locator - uses semantic HTML';
      } else if (locator.includes('getByTestId')) {
        score = 80;
        explanation = 'Test-id locator - explicit test identifier';
      } else if (locator.includes('getByText')) {
        score = 75;
        explanation = 'Text-based locator - user-visible content';
      } else if (locator.includes('getByPlaceholder')) {
        score = 70;
        explanation = 'Placeholder-based locator - good for inputs';
      } else {
        score = 50;
        explanation = 'Generic locator - consider more specific alternatives';
      }

      return { locator, score, explanation };
    }).sort((a, b) => b.score - a.score);
  }

  private getLocatorBestPractices(parsed: any): string[] {
    const practices: string[] = [];

    if (parsed.type === 'css-class') {
      practices.push('❌ Avoid CSS classes - they change with styling');
      practices.push('✅ Use getByRole() for interactive elements');
      practices.push('✅ Use getByTestId() if no semantic alternative');
    } else if (parsed.type === 'positional') {
      practices.push('❌ Avoid position-based selectors - very brittle');
      practices.push('✅ Use role, text, or test-id instead');
    } else if (parsed.type === 'role-based') {
      practices.push('✅ Excellent! Role-based locators are best practice');
    }

    return practices;
  }

  private generateSuggestions(parsed: any, failureReason: string, language: Language): Array<{ locator: string; reason: string; priority: number }> {
    const suggestions: Array<{ locator: string; reason: string; priority: number }> = [];

    if (parsed.type === 'css-class' || parsed.type === 'positional') {
      if (language === 'javascript') {
        suggestions.push({
          locator: 'page.getByRole(\'button\', { name: \'Submit\' })',
          reason: 'Use role and accessible name - most stable',
          priority: 1,
        });
        suggestions.push({
          locator: 'page.getByTestId(\'submit-button\')',
          reason: 'Add data-testid attribute for explicit test targeting',
          priority: 2,
        });
        suggestions.push({
          locator: 'page.getByText(\'Submit\')',
          reason: 'Use visible text if unique',
          priority: 3,
        });
      }
    }

    if (failureReason.includes('multiple')) {
      suggestions.push({
        locator: `${parsed.original}.first()`,
        reason: 'Add .first() to handle multiple matches',
        priority: 2,
      });
    }

    return suggestions;
  }

  private explainIssues(parsed: any, failureReason: string): string {
    const parts: string[] = [];

    parts.push(`Current locator type: ${parsed.type}`);
    parts.push(`Failure reason: ${failureReason}`);

    if (parsed.issues.length > 0) {
      parts.push('Issues with current locator:');
      parsed.issues.forEach((issue: string) => parts.push(`  - ${issue}`));
    }

    parts.push('\nRecommendation: Follow Playwright\'s locator priority:');
    parts.push('  1. getByRole() - best for interactive elements');
    parts.push('  2. getByLabel() - good for form fields');
    parts.push('  3. getByTestId() - when no semantic alternative');
    parts.push('  4. CSS/XPath - only as last resort');

    return parts.join('\n');
  }
}
