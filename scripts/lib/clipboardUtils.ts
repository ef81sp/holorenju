/**
 * クリップボードユーティリティ
 */

import { spawn } from "node:child_process";

/**
 * テキストをクリップボードにコピー（macOS）
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("pbcopy", []);

    proc.on("error", () => {
      resolve(false);
    });

    proc.on("close", (code) => {
      resolve(code === 0);
    });

    proc.stdin.write(text);
    proc.stdin.end();
  });
}
