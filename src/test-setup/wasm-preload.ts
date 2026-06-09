/**
 * vitest グローバルセットアップ: 連珠ルール判定 thin wasm を preload する（#37 P4 #43 PR-6）。
 *
 * patterns.ts / forbiddenMoves.ts 物理削除に伴い forbiddenAdapter / threatAdapter /
 * patternsAdapter は pure-wasm 化（TS フォールバック撤去）された。テストもこれらを
 * 経由する以上、各テストワーカーで wasm をロード済みにしておく必要がある。
 * 本番(main.ts)のブートゲートと同じく forbidden/threat wasm を await でロードする。
 */
import { preloadForbiddenWasm } from "@/logic/cpu/wasm/forbiddenAdapter";
import { preloadThreatWasm } from "@/logic/cpu/wasm/threatLoader";

await preloadForbiddenWasm();
await preloadThreatWasm();
