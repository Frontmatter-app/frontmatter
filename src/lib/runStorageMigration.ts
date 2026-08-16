/**
 * Runs the storage-key migration, as a side effect, at module evaluation.
 *
 * This exists because of an ordering mistake worth spelling out. The migration
 * was called from the body of `main.tsx`:
 *
 *     import App from './App.tsx';
 *     import { migrateLocalStorageKeys } from './lib/storageMigration';
 *     migrateLocalStorageKeys();          // <- far too late
 *
 * ES module imports are hoisted and the whole graph is evaluated before the
 * first statement of the importing module runs. `App` pulls in the settings
 * store, the auth store, the theme and the plan context, and every one of them
 * reads local storage as its module is evaluated. So the call above ran *after*
 * all of them had already read — and missed — the renamed keys, handing the
 * writer default settings, a default theme and a signed-out session on the
 * first launch after the rename.
 *
 * Imported first, a side-effecting module is evaluated first, which is the one
 * ordering guarantee that actually holds.
 */

import { migrateLocalStorageKeys } from "./storageMigration";

migrateLocalStorageKeys();
