// @ts-check
import { cleanPriority, freshName } from './priority-editor.js'
import {
  DEFAULT_PRIORITY_COUNT,
  DEFAULT_PRIORITY_NAME,
  DEFAULT_PRIORITY_PROMPT,
  MAX_PRIORITY_COUNT,
  MAX_PRIORITY_NAME,
  MAX_PRIORITY_PROMPT,
  MAX_PRIORITY_PROMPTS,
} from './priority.js'

/** @param {string} name @param {string} prompt */
const named = (name, prompt) => ({ name, prompt })

describe('cleanPriority', () => {
  it('saves the default prompt alone, at the default count, as no setting', () => {
    expect(
      cleanPriority(
        [named(`  ${DEFAULT_PRIORITY_NAME}  `, `  ${DEFAULT_PRIORITY_PROMPT}  `)],
        0,
        String(DEFAULT_PRIORITY_COUNT)
      )
    ).toEqual({ priority: null })
  })

  it('rejects an empty or over-long name or prompt, too many prompts, and a count outside 1 to 10', () => {
    const one = [named('Bugs', 'Bugs first.')]
    expect(cleanPriority([named('  ', 'x')], 0, '1')).toEqual({ error: 'Prompt 1 needs a name.' })
    expect(cleanPriority([named('n'.repeat(MAX_PRIORITY_NAME + 1), 'x')], 0, '1')).toEqual({
      error: `Keep each name to ${MAX_PRIORITY_NAME} characters.`,
    })
    expect(cleanPriority([named('Bugs', '   ')], 0, '1')).toEqual({
      error: 'Write what makes a PR highest priority in “Bugs”.',
    })
    expect(cleanPriority([named('Bugs', 'x'.repeat(MAX_PRIORITY_PROMPT + 1))], 0, '1')).toEqual({
      error: `Keep “Bugs” to ${MAX_PRIORITY_PROMPT} characters.`,
    })
    expect(cleanPriority([], 0, '1')).toEqual({ error: 'Keep at least one prompt.' })
    expect(
      cleanPriority(
        Array.from({ length: MAX_PRIORITY_PROMPTS + 1 }, (_, i) => named(`P${i}`, 'x')),
        0,
        '1'
      )
    ).toEqual({ error: `Keep up to ${MAX_PRIORITY_PROMPTS} prompts.` })
    expect(cleanPriority(one, 0, '0')).toEqual({ error: `Show 1 to ${MAX_PRIORITY_COUNT} PRs.` })
    expect(cleanPriority(one, 0, '1.5')).toEqual({ error: `Show 1 to ${MAX_PRIORITY_COUNT} PRs.` })
  })

  it('uses the first prompt when the one in use is gone', () => {
    expect(cleanPriority([named('Bugs', 'Bugs first.'), named('Security', 'Now.')], 9, '2')).toEqual({
      priority: {
        prompts: [
          { name: 'Bugs', prompt: 'Bugs first.' },
          { name: 'Security', prompt: 'Now.' },
        ],
        active: 'Bugs',
        count: 2,
      },
    })
  })
})

describe('freshName', () => {
  it('starts at New prompt, then numbers the ones already taken', () => {
    expect(freshName([])).toBe('New prompt')
    expect(freshName([named('New prompt', '')])).toBe('New prompt 2')
    expect(freshName([named('  new prompt  ', ''), named('New prompt 2', 'x')])).toBe('New prompt 3')
  })
})
