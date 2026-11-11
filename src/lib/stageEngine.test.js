import { describe, it, expect } from 'vitest'
import { detectStage } from './stageEngine'

// 11 Nov 2026 audit: a typed "2.8M" fell through to 'Startup', so a $2.8M,
// 18-person company was described to Solomon and every tool as a startup.
describe('detectStage', () => {
  it('reads the dropdown labels', () => {
    expect(detectStage('$1M – $5M')).toBe('Scaling')
    expect(detectStage('Pre-revenue')).toBe('Startup')
  })
  it('reads a typed figure', () => {
    expect(detectStage('2.8M')).toBe('Scaling')
    expect(detectStage('$450k')).toBe('Early Growth')
    expect(detectStage('12,000,000')).toBe('Enterprise')
  })
  it('falls back to Startup for nothing or nonsense', () => {
    expect(detectStage('')).toBe('Startup')
    expect(detectStage(null)).toBe('Startup')
    expect(detectStage('lots')).toBe('Startup')
  })
})
