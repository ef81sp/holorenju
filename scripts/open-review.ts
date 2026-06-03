#!/usr/bin/env node
/**
 * 振り返り画面を棋譜つきで開く
 *
 * 使用例:
 *   pnpm review:open "H8 G9 G8 F8 H10 H9 I9 F9 J8 G11"
 *   pnpm review:open --ps=w "H8 G9 G8"
 *   pnpm review:open --port=5174 --no-open "H8 G9"
 *
 * 出力: URL（stdout 1行目）。--no-open でなければ macOS `open` で起動。
 */

import { execFileSync } from "node:child_process";

import { validateGameRecord } from "@/logic/gameRecordValidator";

interface Args {
  kifu: string;
  playerSide: "b" | "w" | "both";
  port: number | null;
  noOpen: boolean;
}

const VITE_PORT_RANGE = [5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180];

async function probeHolorenjuPort(port: number): Promise<boolean> {
  // ホロ連珠の index.html が返るかを確認 (他プロジェクトの vite を弾く)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 400);
  try {
    const res = await fetch(`http://localhost:${port}/`, {
      signal: controller.signal,
    });
    if (!res.ok) {
      return false;
    }
    const body = await res.text();
    return body.includes("ホロ連珠") || body.includes("holorenju");
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function detectLiveDevPort(): Promise<number | null> {
  for (const port of VITE_PORT_RANGE) {
    if (await probeHolorenjuPort(port)) {
      return port;
    }
  }
  return null;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const positional: string[] = [];
  let playerSide: Args["playerSide"] = "both";
  let port: number | null = null;
  let noOpen = false;

  for (const arg of argv) {
    if (arg === "--no-open") {
      noOpen = true;
    } else if (arg.startsWith("--ps=")) {
      const v = arg.slice(5);
      if (v === "b" || v === "w" || v === "both") {
        playerSide = v;
      } else {
        console.error(`不正な --ps 値: ${v} (b | w | both)`);
        process.exit(1);
      }
    } else if (arg.startsWith("--port=")) {
      port = Number(arg.slice(7));
      if (!Number.isFinite(port)) {
        console.error(`不正な --port 値: ${arg.slice(7)}`);
        process.exit(1);
      }
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          'Usage: pnpm review:open [options] "<kifu>"',
          "",
          "  <kifu>     スペース区切りまたは. 区切りの棋譜 (例: 'H8 G9 G8')",
          "  --ps=b|w|both  振り返り視点 (default: both)",
          "  --port=N   dev サーバーのポート (default: 稼働中の vite を自動検出)",
          "  --no-open  ブラウザを開かず URL のみ出力",
        ].join("\n"),
      );
      process.exit(0);
    } else if (arg.startsWith("--")) {
      console.error(`不明なオプション: ${arg}`);
      process.exit(1);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length === 0) {
    console.error("棋譜が指定されていません。--help を参照してください。");
    process.exit(1);
  }

  // 位置引数を結合（"H8 G9" でも "H8" "G9" でも受け付ける）
  const rawKifu = positional.join(" ").replace(/\./g, " ");
  const validation = validateGameRecord(rawKifu);
  if (!validation.valid) {
    console.error(`棋譜が不正: ${validation.error}`);
    process.exit(1);
  }

  return {
    kifu: validation.normalizedRecord,
    playerSide,
    port,
    noOpen,
  };
}

function buildUrl(args: Args & { port: number }): string {
  const g = args.kifu.replace(/ /g, ".");
  return `http://localhost:${args.port}/#cpuReview?g=${g}&ps=${args.playerSide}`;
}

function openInBrowser(url: string): void {
  if (process.platform !== "darwin") {
    console.error(
      `自動オープンは macOS のみ対応。手動でこの URL を開いてください: ${url}`,
    );
    return;
  }
  try {
    execFileSync("open", [url]);
  } catch (err) {
    console.error(`open コマンド失敗: ${(err as Error).message}`);
  }
}

async function resolvePort(requested: number | null): Promise<number> {
  if (requested !== null) {
    return requested;
  }
  const detected = await detectLiveDevPort();
  if (detected !== null) {
    return detected;
  }
  console.error(
    "稼働中の dev サーバーを検出できませんでした。--port で指定するか pnpm dev を起動してください。",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const port = await resolvePort(args.port);
  const url = buildUrl({ ...args, port });
  console.log(url);
  if (!args.noOpen) {
    openInBrowser(url);
  }
}

main();
