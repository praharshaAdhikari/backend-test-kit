import type { Redis } from 'ioredis';

export interface Product {
  sku: string;
  name: string;
  priceCents: number;
}

/** Where products really live (the database). The catalog puts a cache in front of it. */
export interface ProductSource {
  find(sku: string): Promise<Product | null>;
  updatePrice(sku: string, priceCents: number): Promise<void>;
}

/**
 * Products, read through a Redis cache. The two things a cache gets wrong are what its
 * integration test is for: serving the old value after a change, and keeping an entry for ever.
 * A unit test with a mocked Redis cannot see either: the mock does not know which key the read
 * used, or what EX means.
 */
export class ProductCatalog {
  constructor(
    private readonly source: ProductSource,
    private readonly redis: Redis,
    private readonly ttlSeconds = 300
  ) {}

  async get(sku: string): Promise<Product | null> {
    const cached = await this.redis.get(keyFor(sku));
    if (cached) return JSON.parse(cached) as Product;

    const product = await this.source.find(sku);
    // A product that does not exist is not cached, so it is found as soon as it is created.
    if (product) await this.redis.set(keyFor(sku), JSON.stringify(product), 'EX', this.ttlSeconds);
    return product;
  }

  async updatePrice(sku: string, priceCents: number): Promise<void> {
    await this.source.updatePrice(sku, priceCents);
    await this.redis.del(keyFor(sku));
  }
}

function keyFor(sku: string): string {
  return `product:${sku}`;
}
