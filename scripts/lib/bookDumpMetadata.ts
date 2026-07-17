/**
 * --dump-book のメタデータ行（opening-book-2026-07-16.md §1: 再現性要件）。
 *
 * 権威実行の結果が「どのコード・どの重み（wasm ビルド）・どのパラメータで
 * 得られたか」を後から追跡できるよう、実行パラメータ・git rev・wasm ビルド時刻・
 * シードを先頭行に記録する。
 */
import { execSync } from "node:child_process";
import { statSync } from "node:fs";

export interface BookDumpMetadata {
  type: "metadata";
  timestamp: string;
  gitRev: string;
  wasmBuildTime: string;
  seed: number;
  roots: string | null;
  b5: number;
  b7: number;
  hardTimeMs: number | null;
  /** white版（第1段）/black版（★第2段）の判別。 */
  side: "white" | "black";
}

/** 現在の git HEAD のコミットハッシュを取得する（取得失敗時は "unknown"）。 */
export function getGitRev(cwd: string = process.cwd()): string {
  try {
    return execSync("git rev-parse HEAD", { cwd }).toString().trim();
  } catch {
    return "unknown";
  }
}

/** wasm ファイルの最終更新時刻（ビルド時刻の近似）を ISO8601 で取得する。 */
export function getWasmBuildTime(wasmPath: string): string {
  try {
    return statSync(wasmPath).mtime.toISOString();
  } catch {
    return "unknown";
  }
}

/** メタデータ行を組み立てる純粋関数（ユニットテスト用に依存注入可能）。 */
export function buildBookDumpMetadata(params: {
  gitRev: string;
  wasmBuildTime: string;
  seed: number;
  roots: string | null;
  b5: number;
  b7: number;
  hardTimeMs: number | null;
  side?: "white" | "black";
  now?: Date;
}): BookDumpMetadata {
  return {
    type: "metadata",
    timestamp: (params.now ?? new Date()).toISOString(),
    gitRev: params.gitRev,
    wasmBuildTime: params.wasmBuildTime,
    seed: params.seed,
    roots: params.roots,
    b5: params.b5,
    b7: params.b7,
    hardTimeMs: params.hardTimeMs,
    side: params.side ?? "white",
  };
}
