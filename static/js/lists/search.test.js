// @ts-check
// @vitest-environment happy-dom
import {
  addKeyChips,
  fold,
  markMatches,
  parseSearch,
  searchMatch,
  searchSyntax,
  searchTerms,
  textMatch,
} from './search.js'

/** A PR as the search reads it; every name here is made up. */
const pr = (/** @type {Partial<import('./search.js').Searchable>} */ over = {}) => ({
  number: 123,
  title: 'Fix the login redirect',
  head: 'feat/web-7-login',
  base: 'develop',
  keys: ['PROJ-45'],
  ...over,
})

describe('parseSearch', () => {
  it('reads numbers, digits, keys and words, folded', () => {
    expect(parseSearch('  #12 12 proj-9 Café  ')).toEqual([
      [
        { kind: 'number', n: 12 },
        { kind: 'digits', text: '12' },
        { kind: 'key', text: 'proj-9' },
        { kind: 'text', text: 'cafe' },
      ],
    ])
    expect(parseSearch('')).toEqual([])
    // A lone # or a #word is a word.
    expect(parseSearch('# #abc')).toEqual([
      [
        { kind: 'text', text: '#' },
        { kind: 'text', text: '#abc' },
      ],
    ])
  })

  it('splits at OR and drops AND, in capitals only, leaving out operators with no word beside them', () => {
    const words = (/** @type {string} */ q) =>
      parseSearch(q).map(g => g.map(t => (t.kind === 'number' ? `#${t.n}` : t.text)))
    expect(words('cache AND docs OR login')).toEqual([['cache', 'docs'], ['login']])
    expect(words('cache docs OR #7 OR')).toEqual([['cache', 'docs'], ['#7']])
    expect(words('OR AND')).toEqual([])
    // In lower case they are words to find.
    expect(words('this or that and more')).toEqual([['this', 'or', 'that', 'and', 'more']])
  })

  it('reads a pasted GitHub PR or Jira card address as its number or key', () => {
    expect(parseSearch('https://github.com/acme/widgets/pull/88/files')).toEqual([
      [{ kind: 'number', n: 88 }],
    ])
    expect(parseSearch('https://acme.example.test/browse/PROJ-4')).toEqual([
      [{ kind: 'key', text: 'proj-4' }],
    ])
    expect(parseSearch('https://acme.example.test/board?selectedIssue=OPS-2')).toEqual([
      [{ kind: 'key', text: 'ops-2' }],
    ])
    expect(parseSearch('https://example.test/docs')).toEqual([
      [{ kind: 'text', text: 'https://example.test/docs' }],
    ])
  })

  it('folds case and accents', () => expect(fold('ÉLAN Ñ')).toBe('elan n'))
})

describe('searchMatch', () => {
  const match = (/** @type {string} */ q, over = {}, jira = true) =>
    searchMatch(pr(over), parseSearch(q), jira)

  it('matches the title, either branch, the number and the Jira keys, every word somewhere', () => {
    expect(match('LOGIN')).toEqual({ keys: [] })
    expect(match('fix redirect')).toEqual({ keys: [] })
    expect(match('fix AND redirect')).toEqual({ keys: [] })
    expect(match('fix nothing')).toBeNull()
    expect(match('web-7')).toEqual({ keys: [] })
    expect(match('develop')).toEqual({ keys: [] })
    expect(match('#123')).toEqual({ keys: [] })
    expect(match('#12')).toBeNull()
    expect(match('123')).toEqual({ keys: [] })
    // An empty search, or only operators, keeps every PR.
    expect(match('')).toEqual({ keys: [] })
    expect(match('OR')).toEqual({ keys: [] })
  })

  it('keeps a PR that matches any alternative', () => {
    expect(match('nothing OR redirect')).toEqual({ keys: [] })
    expect(match('nothing OR #9')).toBeNull()
    // AND binds first: (fix and nothing) or develop.
    expect(match('fix nothing OR develop')).toEqual({ keys: [] })
    expect(match('fix nothing OR else')).toBeNull()
  })

  it('says which keys alone let a word through, and ignores keys with Jira off', () => {
    expect(match('proj-45')).toEqual({ keys: ['PROJ-45'] })
    expect(match('45')).toEqual({ keys: ['PROJ-45'] })
    expect(match('nothing OR proj-45')).toEqual({ keys: ['PROJ-45'] })
    expect(match('proj-4')).toBeNull()
    expect(match('proj-45', {}, false)).toBeNull()
    // A key the branch carries too is found by the branch.
    expect(match('web-7', { keys: ['WEB-7'] })).toEqual({ keys: [] })
  })
})

describe('searchSyntax', () => {
  it('puts AND and OR in their own spans, keeping every space', () => {
    const parts = searchSyntax(document, 'fix  OR docs AND x or')
    expect(parts.map(p => (typeof p === 'string' ? p : `[${p.textContent}]`)).join('')).toBe(
      'fix  [OR] docs [AND] x or'
    )
    expect(parts.filter(p => typeof p !== 'string').map(p => /** @type {Element} */ (p).className)).toEqual([
      'search-op',
      'search-op',
    ])
  })
})

describe('textMatch', () => {
  it('finds every word of an alternative in plain text, folded, and a #number as written', () => {
    const text = 'Café limit is hard-coded, as #12 said'
    expect(textMatch(text, parseSearch(''))).toBe(true)
    expect(textMatch(text, parseSearch('cafe LIMIT'))).toBe(true)
    expect(textMatch(text, parseSearch('cafe missing'))).toBe(false)
    expect(textMatch(text, parseSearch('missing OR hard'))).toBe(true)
    expect(textMatch(text, parseSearch('#12'))).toBe(true)
    expect(textMatch(text, parseSearch('#13'))).toBe(false)
  })
})

describe('markMatches and addKeyChips', () => {
  it('marks what matched, ignoring case and accents, and a number whole', () => {
    document.body.innerHTML =
      '<div class="pull-text"><button class="pull-title">Café login <span class="pull-number">#7</span></button>' +
      '<span class="pull-branch"><span class="branch-pill">develop</span> <span class="branch-head">login-x</span></span></div>'
    markMatches(document.body, searchTerms(parseSearch('cafe OR LOGIN #7')))
    expect([...document.querySelectorAll('mark')].map(m => m.textContent)).toEqual([
      'Café',
      'login',
      '#7',
      'login',
    ])
    expect(document.querySelector('.pull-title')?.textContent).toBe('Café login #7')
    addKeyChips(document.body, new Map([[7, ['PROJ-1']]]))
    expect(document.querySelector('.pull-branch .search-key-chip')?.textContent).toBe('PROJ-1')
    expect(document.querySelector('.search-key-chip svg')).not.toBeNull()
  })

  it('marks words alone where no number is named', () => {
    document.body.innerHTML = '<p class="words">See #7 and the cache</p>'
    markMatches(document.body, searchTerms(parseSearch('#7 cache')), { text: '.words', number: '' })
    expect([...document.querySelectorAll('mark')].map(m => m.textContent)).toEqual(['cache'])
  })

  it('leaves text alone when nothing matches', () => {
    document.body.innerHTML = '<button class="pull-title">Plain</button>'
    markMatches(document.body, searchTerms(parseSearch('zzz')))
    expect(document.body.innerHTML).toBe('<button class="pull-title">Plain</button>')
  })
})
