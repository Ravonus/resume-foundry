const pool = (process.env.SCRAPER_PROXY_POOL ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

let poolIndex = 0;

const nextPoolProxy = () => {
  if (pool.length === 0) return undefined;
  const proxy = pool[poolIndex % pool.length];
  poolIndex += 1;
  return proxy;
};

export const resolveProxy = (requestProxy?: string) => {
  if (requestProxy) return requestProxy;
  if (process.env.SCRAPER_PROXY_URL) return process.env.SCRAPER_PROXY_URL;
  return nextPoolProxy();
};
