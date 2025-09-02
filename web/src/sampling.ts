import seedrandom from 'seedrandom'

export interface WeightedItem<T> {
	item: T
	weight: number
}

export interface SamplerOptions {
	seed?: string
}

export function weightedSampleWithoutReplacement<T>(
	items: WeightedItem<T>[],
	sampleSize: number,
	options?: SamplerOptions,
): T[] {
	const rng = seedrandom(options?.seed ?? undefined)
	const pool = items.slice()
	const results: T[] = []
	const k = Math.min(sampleSize, pool.length)
	for (let i = 0; i < k; i++) {
		const totalWeight = pool.reduce((acc, it) => acc + Math.max(it.weight, 0), 0)
		if (totalWeight <= 0) break
		let r = rng.quick() * totalWeight
		let chosenIndex = 0
		for (let j = 0; j < pool.length; j++) {
			const w = Math.max(pool[j].weight, 0)
			if (r < w) {
				chosenIndex = j
				break
			}
			r -= w
		}
		const [chosen] = pool.splice(chosenIndex, 1)
		results.push(chosen.item)
	}
	return results
}


