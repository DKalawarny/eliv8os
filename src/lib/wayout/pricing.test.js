import { describe, it, expect } from 'vitest'
import { priceFor, WAYOUT_REFERRAL_SHARE_LABEL, WAYOUT_REFERRAL_LIVE, WAYOUT_PAYMENTS_LIVE } from './pricing'

describe('price per country (7 Nov 2026: "ok us 19")', () => {
  it('Canadians pay C$19, in CAD', () => {
    expect(priceFor('ca')).toMatchObject({ currency: 'CAD', cents: 1900, label: 'C$19' })
  })
  it('everyone else pays US$19, in USD', () => {
    expect(priceFor('us')).toMatchObject({ currency: 'USD', cents: 1900, label: 'US$19' })
    expect(priceFor('gb').currency).toBe('USD')
    expect(priceFor(undefined).currency).toBe('USD')
  })
})

describe('the invite money switch', () => {
  it('names 20%, and only goes live with payments', () => {
    expect(WAYOUT_REFERRAL_SHARE_LABEL).toBe('20%')
    expect(WAYOUT_REFERRAL_LIVE).toBe(WAYOUT_PAYMENTS_LIVE)
  })
})
