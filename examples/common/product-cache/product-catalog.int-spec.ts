import { Redis } from 'ioredis';
import { flushRedis, testRedis } from '../../../../test/helpers/redis.js';
import { type Product, ProductCatalog, type ProductSource } from './product-catalog.js';

// An integration test of a cache: the real Redis that `npm run test:integration` starts (with
// needsRedis = true in test/setup/project.ts), and the app's own client. What is behind the
// cache is faked in memory and counts its reads, so the tests can tell a cached answer from a
// fresh one. It checks what only Redis can: that reads and writes agree on the key, and expiry.

/** Stands in for the database: a map, and how many times it was read. */
class CountingSource implements ProductSource {
  reads = 0;
  private readonly products = new Map<string, Product>();

  add(product: Product): void {
    this.products.set(product.sku, product);
  }

  find(sku: string): Promise<Product | null> {
    this.reads += 1;
    return Promise.resolve(this.products.get(sku) ?? null);
  }

  updatePrice(sku: string, priceCents: number): Promise<void> {
    const product = this.products.get(sku);
    if (product) this.products.set(sku, { ...product, priceCents });
    return Promise.resolve();
  }
}

describe('ProductCatalog (real Redis)', () => {
  let redis: Redis;
  let source: CountingSource;
  let catalog: ProductCatalog;

  beforeAll(() => {
    redis = new Redis(testRedis().url);
  });

  afterAll(async () => {
    await redis.quit(); // an open connection keeps Jest from exiting
  });

  beforeEach(async () => {
    await flushRedis();
    source = new CountingSource();
    source.add({ sku: 'MUG', name: 'Mug', priceCents: 1000 });
    catalog = new ProductCatalog(source, redis, 300);
  });

  it('reads the source once, then answers from the cache', async () => {
    const first = await catalog.get('MUG');
    const second = await catalog.get('MUG');

    expect(first).toEqual({ sku: 'MUG', name: 'Mug', priceCents: 1000 });
    expect(second).toEqual(first);
    expect(source.reads).toBe(1);
  });

  it('serves the new price right after an update, not the cached one', async () => {
    await catalog.get('MUG'); // now cached at 1000

    await catalog.updatePrice('MUG', 800);

    await expect(catalog.get('MUG')).resolves.toMatchObject({ priceCents: 800 });
  });

  it('does not cache a product that does not exist, so it is found once it is added', async () => {
    await expect(catalog.get('BOWL')).resolves.toBeNull();

    source.add({ sku: 'BOWL', name: 'Bowl', priceCents: 1500 });

    await expect(catalog.get('BOWL')).resolves.toMatchObject({ name: 'Bowl' });
  });

  it('gives each entry the time to live it was configured with', async () => {
    await catalog.get('MUG');

    // Asked of Redis, not waited for: a test never sleeps. A second may tick between the two
    // calls, so the answer is 300 or 299, and -1 would mean "never expires".
    const secondsLeft = await redis.ttl('product:MUG');
    expect(secondsLeft).toBeGreaterThanOrEqual(299);
    expect(secondsLeft).toBeLessThanOrEqual(300);
  });

  it('reads the source again once the entry has expired', async () => {
    await catalog.get('MUG');

    await redis.expire('product:MUG', 0); // what Redis does itself when the TTL runs out
    await catalog.get('MUG');

    expect(source.reads).toBe(2);
  });
});
