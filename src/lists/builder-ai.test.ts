// The filter builder's Ask AI: what the agent is told, the blocks read from its answer and fitted
// to the page, and the refusals when the agent fails.
import type { FieldSpec } from '../../static/js/lists/filter-builder.js'
import { AppError } from '../server/errors.js'
import {
  askBuilder,
  type BuilderAsk,
  BuilderAskSchema,
  builderPrompt,
  parseBuilderAnswer,
} from './builder-ai.js'
import type { OneShot } from './read-only.js'

const FIELDS: FieldSpec[] = [
  {
    key: 'author',
    label: 'Author',
    multi: false,
    options: [
      ['ana', 'ana'],
      ['bob', 'Bob B.'],
    ],
  },
  { key: 'label', label: 'Label', multi: true, options: [] },
  { key: 'search', label: 'Search', multi: false, options: [], text: true },
]

function ask(over: Partial<BuilderAsk> = {}): BuilderAsk {
  return BuilderAskSchema.parse({
    page: 'pulls',
    messages: [{ from: 'you', text: 'only ana' }],
    fields: FIELDS,
    current: null,
    ...over,
  })
}

describe('BuilderAskSchema', () => {
  it('fills the lists left out, and refuses a conversation that does not end with you', () => {
    expect(ask()).toMatchObject({ saved: [], groups: [] })
    const claudeLast = BuilderAskSchema.safeParse({
      page: 'queue',
      messages: [{ from: 'claude', text: 'hi' }],
      fields: FIELDS,
      current: null,
    })
    expect(claudeLast.success).toBe(false)
    expect(BuilderAskSchema.safeParse({ ...ask(), extra: 1 }).success).toBe(false)
  })
})

describe('builderPrompt', () => {
  it('describes the page, its fields, saved filters, groups, the blocks now and the talk', () => {
    const prompt = builderPrompt(
      'acme/widgets',
      ask({
        page: 'queue',
        messages: [
          { from: 'you', text: 'show bugs' },
          { from: 'claude', text: 'Which label?' },
          { from: 'you', text: 'bug' },
        ],
        saved: [
          { name: 'Mine', blocks: { op: 'and', items: [{ field: 'author', is: 'any', values: ['ana'] }] } },
          { name: 'Broken', blocks: 'not blocks' },
        ],
        groups: [{ name: 'Team', logins: ['ana', 'bob'] }],
      }),
      { op: 'or', items: [] }
    )
    expect(prompt).toContain(
      "other people's pull requests waiting for the developer's review (the Review queue) in acme/widgets"
    )
    expect(prompt).toContain('- author (Author): ana, bob = Bob B.')
    expect(prompt).toContain('- label (Label), a row can have several: no values yet')
    expect(prompt).toContain('- search (Search): typed words, not values; see below')
    expect(prompt).toContain('"search" takes one value')
    expect(prompt).toContain(
      '- "Mine": {"op":"and","items":[{"field":"author","is":"any","values":["ana"]}]}'
    )
    expect(prompt).not.toContain('"Broken"')
    expect(prompt).toContain('- "Team": ana, bob')
    expect(prompt).toContain('The blocks now: {"op":"or","items":[]}')
    expect(prompt).toContain('Developer: show bugs\nYou: Which label?\nDeveloper: bug')
  })

  it('leaves out the typed-words, saved filter and group parts when there are none', () => {
    const prompt = builderPrompt('acme/widgets', ask({ fields: [FIELDS[0] as FieldSpec] }), {
      op: 'and',
      items: [],
    })
    expect(prompt).toContain("the developer's own open pull requests (Your PRs)")
    expect(prompt).not.toContain('takes one value, words to search for')
    expect(prompt).not.toContain('saved filters on this page')
    expect(prompt).not.toContain('saved groups of people')
  })
})

describe('parseBuilderAnswer', () => {
  it('reads the reply and the blocks, fitted to the fields', () => {
    const answer = parseBuilderAnswer(
      'Sure: {"reply":"  Only ana.  ","blocks":{"op":"and","items":[{"field":"author","is":"any","values":["ana","zed"]},{"field":"nope","is":"any","values":["x"]}]}} ok',
      FIELDS
    )
    expect(answer).toEqual({
      reply: 'Only ana.',
      blocks: { op: 'and', items: [{ field: 'author', is: 'any', values: ['ana'] }] },
    })
  })

  it('keeps a question with no blocks, and cuts a long reply', () => {
    expect(parseBuilderAnswer('{"reply":"Which one?","blocks":null}', FIELDS)).toEqual({
      reply: 'Which one?',
      blocks: null,
    })
    const long = parseBuilderAnswer(JSON.stringify({ reply: 'x'.repeat(700), blocks: 'junk' }), FIELDS)
    expect(long?.reply).toHaveLength(600)
    expect(long?.blocks).toBeNull()
  })

  it('is null when the answer holds no such object', () => {
    expect(parseBuilderAnswer('nothing', FIELDS)).toBeNull()
    expect(parseBuilderAnswer('} {', FIELDS)).toBeNull()
    expect(parseBuilderAnswer('{oops}', FIELDS)).toBeNull()
    expect(parseBuilderAnswer('{"blocks":null}', FIELDS)).toBeNull()
  })
})

describe('askBuilder', () => {
  it('asks once with the blocks now and answers with the agent’s', async () => {
    const oneShot = vi.fn<OneShot>(async () => ({
      ok: true,
      text: '{"reply":"Done.","blocks":{"op":"and","items":[{"field":"author","is":"any","values":["bob"]}]}}',
    }))
    const current = { op: 'or', items: [{ field: 'author', is: 'any', values: ['ana'] }] }
    const answer = await askBuilder(oneShot, 'acme/widgets', ask({ current }))
    expect(answer).toEqual({
      reply: 'Done.',
      blocks: { op: 'and', items: [{ field: 'author', is: 'any', values: ['bob'] }] },
    })
    expect(oneShot).toHaveBeenCalledTimes(1)
    expect(oneShot.mock.calls[0]?.[0]).toBe('builder')
    expect(oneShot.mock.calls[0]?.[1]).toContain(`The blocks now: ${JSON.stringify(current)}`)
  })

  it('starts from empty blocks when the page sends none', async () => {
    const oneShot = vi.fn<OneShot>(async () => ({ ok: true, text: '{"reply":"?","blocks":null}' }))
    await askBuilder(oneShot, 'acme/widgets', ask({ current: 'junk' }))
    expect(oneShot.mock.calls[0]?.[1]).toContain('The blocks now: {"op":"and","items":[]}')
  })

  it('refuses with 502 when the agent fails or answers no blocks', async () => {
    const failed = askBuilder(async () => ({ ok: false, message: 'no login' }), 'a/b', ask())
    await expect(failed).rejects.toBeInstanceOf(AppError)
    await expect(failed).rejects.toMatchObject({
      status: 502,
      message: 'AI could not fill the builder: no login',
    })
    await expect(askBuilder(async () => ({ ok: true, text: 'hmm' }), 'a/b', ask())).rejects.toMatchObject({
      status: 502,
      message: 'AI did not answer with blocks',
    })
  })
})
