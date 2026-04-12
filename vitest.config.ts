import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 120_000,       // testcontainers 起動待ちを吸収
    hookTimeout: 180_000,       // KC + PG コンテナ 2 つ起動の猶予
    fileParallelism: false,     // 同一 PG コンテナを共有したいので直列実行
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
