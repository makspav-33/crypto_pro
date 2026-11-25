// With p <= 65537, every modular product fits exactly in a JS number.
export const maxPrime = 65537

export function modPow(base: number, exponent: number, modulus: number): number {
  let result = 1
  let factor = base % modulus
  while (exponent > 0) {
    if (exponent % 2 === 1) result = result * factor % modulus
    exponent = Math.floor(exponent / 2)
    factor = factor * factor % modulus
  }
  return result
}

function readInteger(raw: string, name: string, min: number, max: number) {
  const value = Number(raw)
  if (!raw || /[^0-9]/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Введіть ціле число ${name} від ${min} до ${max}.`)
  }
  return value
}

function primeFactors(value: number) {
  const factors: number[] = []
  for (let divisor = 2; divisor * divisor <= value; divisor++) {
    if (value % divisor !== 0) continue
    factors.push(divisor)
    while (value % divisor === 0) value /= divisor
  }
  if (value > 1) factors.push(value)
  return factors
}

export function parameters(rawP: string, rawG: string) {
  const p = readInteger(rawP, 'p', 3, maxPrime)
  if (primeFactors(p)[0] !== p) throw new Error('Число p має бути простим.')
  const g = readInteger(rawG, 'g', 2, p - 1)
  // g has order p−1 iff g^((p−1)/q) != 1 for every prime divisor q of p−1.
  if (primeFactors(p - 1).some(q => modPow(g, (p - 1) / q, p) === 1)) {
    throw new Error('Число g має породжувати всю мультиплікативну групу за модулем p.')
  }
  return { p, g }
}

export function privateKey(raw: string, name: string, p: number) {
  return readInteger(raw, name, 1, p - 2)
}

export function generatePrivateKey(p: number) {
  const count = p - 2
  const limit = 2 ** 32 - (2 ** 32 % count)
  const sample = new Uint32Array(1)
  do { crypto.getRandomValues(sample) } while (sample[0] >= limit)
  return 1 + sample[0] % count
}
