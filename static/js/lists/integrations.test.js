// @ts-check
import { hasIntegration, integrationsLabel, matchesIntegrations, sectionValues } from './integrations.js'

/** Every choice ticked. */
const all = { codeRabbit: null, vercel: null, github: null, canvas: null }
const on = { codeRabbit: true, vercel: true }

describe('the Integrations filter', () => {
  it('names what is ticked: All, None, or how many of the choices shown', () => {
    expect(integrationsLabel(all, on)).toBe('All')
    expect(integrationsLabel({ codeRabbit: [], vercel: [], github: [], canvas: [] }, on)).toBe('None')
    // 4 CodeRabbit, 3 Vercel, 6 GitHub and 3 Canvas choices.
    expect(integrationsLabel({ ...all, canvas: ['Stale'] }, on)).toBe('14 of 16')
    // A section the repo does not use is not counted.
    expect(integrationsLabel({ ...all, vercel: [] }, { ...on, vercel: false })).toBe('All')
  })

  it('counts a PR under the one choice of each kind it has', () => {
    const pr = {
      codeRabbit: 'Ready',
      health: { ci: /** @type {const} */ ('passing'), failing: 0, stuck: null, conflict: true },
    }
    expect(hasIntegration(pr, 'codeRabbit', 'Ready')).toBe(true)
    expect(hasIntegration(pr, 'github', 'passing')).toBe(true)
    expect(hasIntegration(pr, 'github', 'failing')).toBe(false)
    expect(hasIntegration(pr, 'github', 'conflict')).toBe(true)
    expect(hasIntegration(pr, 'vercel', 'vercelReady')).toBe(false)
  })

  it('keeps a PR with any ticked choice, from any section', () => {
    const pr = {
      canvas: 'Ready',
      codeRabbit: 'Outdated',
      health: { ci: /** @type {const} */ ('failing'), failing: 1, stuck: null, conflict: false },
    }
    const none = { codeRabbit: [], vercel: [], github: [], canvas: [] }
    expect(matchesIntegrations(pr, all, on)).toBe(true)
    expect(matchesIntegrations(pr, none, on)).toBe(false)
    expect(matchesIntegrations(pr, { ...none, github: ['failing'] }, on)).toBe(true)
    expect(matchesIntegrations(pr, { ...none, github: ['stuck'] }, on)).toBe(false)
    expect(matchesIntegrations(pr, { ...none, github: ['stuck'], canvas: ['Ready'] }, on)).toBe(true)
    expect(matchesIntegrations(pr, { ...none, codeRabbit: ['Ready'], canvas: ['Pending'] }, on)).toBe(false)
    expect(matchesIntegrations(pr, { ...none, vercel: ['vercelReady'] }, on)).toBe(false)
    // A service the repo does not use is not shown: its choices neither keep nor narrow.
    const off = { codeRabbit: false, vercel: true }
    expect(matchesIntegrations(pr, { ...none, codeRabbit: ['Outdated'] }, off)).toBe(false)
    expect(matchesIntegrations(pr, { ...all, codeRabbit: [] }, off)).toBe(true)
    // A PR no sync has read yet has only its CodeRabbit and Canvas states.
    expect(matchesIntegrations({}, all, on)).toBe(true)
    expect(matchesIntegrations({}, { ...none, github: ['failing', 'passing'] }, on)).toBe(false)
  })

  it('knows each section’s values, and none for one it does not know', () => {
    expect(sectionValues('vercel')).toEqual(['vercelReady', 'vercelRunning', 'vercelFailed'])
    expect(sectionValues('canvas')).toEqual(['Ready', 'Stale', 'Pending'])
    expect(sectionValues(/** @type {any} */ ('elsewhere'))).toEqual([])
  })
})
