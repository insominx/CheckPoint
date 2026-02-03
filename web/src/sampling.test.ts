import { describe, it, expect } from 'vitest'
import { weightedSampleWithoutReplacement } from './sampling'

describe('weightedSampleWithoutReplacement', () => {
	it('skips non-finite weights instead of biasing', () => {
		const items = [
			{ item: 'a', weight: Number.NaN },
			{ item: 'b', weight: 1 },
		]

		const result = weightedSampleWithoutReplacement(items, 1, { seed: 'fixed' })
		expect(result).toEqual(['b'])
	})

	it('returns empty when all weights are non-positive or invalid', () => {
		const items = [
			{ item: 'a', weight: Number.NaN },
			{ item: 'b', weight: -1 },
			{ item: 'c', weight: 0 },
		]

		const result = weightedSampleWithoutReplacement(items, 2, { seed: 'fixed' })
		expect(result).toEqual([])
	})
})
