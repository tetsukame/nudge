/**
 * NDG-100 (v0.25 A2): worker のエントリポイント。
 *
 * OTel の auto-instrumentation は require フック方式なので、instrumentation
 * 対象モジュール (pg / http 等) が import される前に SDK を起動する必要が
 * ある。ここが本物の入口で、SDK 起動後に dynamic import で main.ts を読む。
 *
 * package.json の "worker" スクリプトはこのファイルを指す。
 */
import 'dotenv/config';
import { initOtel } from '@/lib/otel';
import { initSentry } from '@/lib/sentry';

await initOtel();
await initSentry();
await import('./main');
