#!/usr/bin/env node
/**
 * ベンチマーク棋譜ブラウズ CLI
 *
 * 使用例:
 *   pnpm browse:games                            # 全対局一覧
 *   pnpm browse:games --tag=vcf-available        # タグで絞り込み
 *   pnpm browse:games --matchup=hard             # 難易度で絞り込み
 *   pnpm browse:games --moves=20-40              # 手数で絞り込み
 *   pnpm browse:games --jushu=花月               # 珠型で絞り込み
 *   pnpm browse:games -i                         # インタラクティブモード
 *   pnpm browse:games -i --game=5 --move=15      # 特定対局・手から開始
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";

import type {
  AnalysisResult,
  BrowseFilter,
  GameAnalysis,
  Tag,
} from "./types/analysis.ts";

import {
  formatGameHeader,
  formatMoveInfo,
  gameRecordToAscii,
  gameRecordToEditorFormat,
} from "./lib/boardDisplay.ts";
import { copyToClipboard } from "./lib/clipboardUtils.ts";
import { matchesFilter } from "./lib/gameFilter.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

interface CliOptions {
  interactive: boolean;
  inputDir: string;
  filter: BrowseFilter;
  startGame?: number;
  startMove?: number;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);

  const options: CliOptions = {
    interactive: false,
    inputDir: path.join(PROJECT_ROOT, "analyzed-games"),
    filter: {},
  };

  for (const arg of args) {
    if (arg === "--interactive" || arg === "-i") {
      options.interactive = true;
    } else if (arg.startsWith("--input=")) {
      options.inputDir = arg.slice("--input=".length);
    } else if (arg.startsWith("--tag=")) {
      const tags = arg.slice("--tag=".length).split(",") as Tag[];
      options.filter.tags = tags;
    } else if (arg.startsWith("--matchup=")) {
      options.filter.matchup = arg.slice("--matchup=".length);
    } else if (arg.startsWith("--moves=")) {
      const range = arg.slice("--moves=".length);
      const [min, max] = range.split("-").map(Number);
      if (min !== undefined && !isNaN(min)) {
        options.filter.movesMin = min;
      }
      if (max !== undefined && !isNaN(max)) {
        options.filter.movesMax = max;
      }
    } else if (arg.startsWith("--winner=")) {
      const winner = arg.slice("--winner=".length);
      if (winner === "black" || winner === "white" || winner === "draw") {
        options.filter.winner = winner;
      }
    } else if (arg.startsWith("--jushu=")) {
      options.filter.jushu = arg.slice("--jushu=".length);
    } else if (arg.startsWith("--game=")) {
      options.startGame = parseInt(arg.slice("--game=".length), 10);
    } else if (arg.startsWith("--move=")) {
      options.startMove = parseInt(arg.slice("--move=".length), 10);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
ベンチマーク棋譜ブラウズ CLI

Usage:
  pnpm browse:games [options]

Options:
  -i, --interactive        インタラクティブモード
  --input=<dir>            入力ディレクトリ (default: analyzed-games)
  --tag=<tag1,tag2,...>    タグで絞り込み
  --matchup=<str>          マッチアップで絞り込み（部分一致）
  --moves=<min>-<max>      手数範囲で絞り込み
  --winner=<black|white|draw>  勝者で絞り込み
  --jushu=<name>           珠型で絞り込み
  --game=<n>               開始対局番号（インタラクティブモード用）
  --move=<n>               開始手番号（インタラクティブモード用）
  -h, --help               ヘルプを表示

Examples:
  pnpm browse:games --tag=vcf-available
  pnpm browse:games --matchup=hard --moves=20-40
  pnpm browse:games -i --game=5 --move=15
`);
}

/**
 * 最新の分析結果ファイルを取得
 */
function getLatestAnalysisFile(inputDir: string): string | null {
  if (!fs.existsSync(inputDir)) {
    return null;
  }

  const files = fs
    .readdirSync(inputDir)
    .filter((f) => f.startsWith("analysis-") && f.endsWith(".json"))
    .sort();

  const lastFile = files[files.length - 1];
  return lastFile ? path.join(inputDir, lastFile) : null;
}

/** 勝者文字列を取得 */
function getWinnerString(winner: "A" | "B" | "draw"): string {
  switch (winner) {
    case "A":
      return "B wins";
    case "B":
      return "W wins";
    case "draw":
    default:
      return "draw";
  }
}

/** スリープ用ユーティリティ */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * 対局一覧を表示
 */
function showGameList(games: GameAnalysis[]): void {
  if (games.length === 0) {
    console.log("条件に一致する対局がありません。");
    return;
  }

  console.log(`Found ${games.length} games matching criteria:\n`);

  for (let i = 0; i < games.length; i++) {
    const game = games[i];
    if (!game) {
      continue;
    }
    const winnerStr = getWinnerString(game.winner);
    const tagsStr =
      game.gameTags.length > 0
        ? `[${game.gameTags.slice(0, 5).join(", ")}${game.gameTags.length > 5 ? "..." : ""}]`
        : "";

    console.log(
      `#${String(i + 1).padStart(3)}  ${game.matchup.padEnd(20)} ${winnerStr} (${game.reason}, ${game.totalMoves}手)   ${tagsStr}`,
    );
  }

  console.log("\nUse --interactive or -i to browse interactively");
}

/**
 * readline で引数付きコマンドを入力するためのプロンプト
 */
function rlPrompt(message: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * raw mode で 1 キー読み取り
 */
function readKey(): Promise<string> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      // TTY でない場合は readline にフォールバック
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question("> ", (answer) => {
        rl.close();
        resolve(answer.trim());
      });
      return;
    }
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");
    const onData = (key: string): void => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      resolve(key);
    };
    process.stdin.on("data", onData);
  });
}

/**
 * インタラクティブモードのメインループ
 */
async function interactiveMode(
  games: GameAnalysis[],
  startGame = 1,
  startMove = 1,
): Promise<void> {
  if (games.length === 0) {
    console.log("条件に一致する対局がありません。");
    return;
  }

  let currentGameIndex = Math.max(0, Math.min(startGame - 1, games.length - 1));
  let currentMoveIndex = Math.max(0, startMove - 1);

  const showCurrentState = (): void => {
    const game = games[currentGameIndex];
    if (!game) {
      return;
    }
    currentMoveIndex = Math.max(
      0,
      Math.min(currentMoveIndex, game.moves.length - 1),
    );
    const move = game.moves[currentMoveIndex];
    if (!move) {
      return;
    }

    console.clear();

    // ヘッダー
    console.log(
      formatGameHeader(
        currentGameIndex + 1,
        game.matchup,
        game.winner,
        game.totalMoves,
        game.reason,
        game.gameTags,
      ),
    );
    console.log();

    // 手の情報
    console.log(formatMoveInfo(move, game.totalMoves));
    console.log();

    // 盤面
    console.log(gameRecordToAscii(game.moves, currentMoveIndex + 1));
    console.log();

    // コマンドヘルプ
    console.log(
      "[n]ext [p]rev [f]irst [L]ast [j]ump [g]ame [c]opy [r]ecord [R]ecord-copy [l]ist [q]uit",
    );
  };

  showCurrentState();

  /* oxlint-disable no-await-in-loop -- インタラクティブループのため意図的 */
  while (true) {
    const key = await readKey();

    // Ctrl+C / Ctrl+D
    if (key === "\x03" || key === "\x04") {
      break;
    }

    switch (key) {
      case "q": {
        return;
      }

      case "n":
      case " ":
      case "\r": {
        // 次の手（n / Space / Enter）
        const game = games[currentGameIndex];
        if (game && currentMoveIndex < game.moves.length - 1) {
          currentMoveIndex++;
        } else if (currentGameIndex < games.length - 1) {
          currentGameIndex++;
          currentMoveIndex = 0;
        }
        break;
      }

      case "p": {
        // 前の手
        if (currentMoveIndex > 0) {
          currentMoveIndex--;
        } else if (currentGameIndex > 0) {
          currentGameIndex--;
          const prevGame = games[currentGameIndex];
          currentMoveIndex = prevGame ? prevGame.moves.length - 1 : 0;
        }
        break;
      }

      case "f": {
        // 最初の手へ
        currentMoveIndex = 0;
        break;
      }

      case "L": {
        // 最後の手へ
        const currentGame = games[currentGameIndex];
        currentMoveIndex = currentGame ? currentGame.moves.length - 1 : 0;
        break;
      }

      case "j": {
        // 指定手へジャンプ（引数を入力）
        const moveStr = await rlPrompt("Jump to move: ");
        const moveNum = parseInt(moveStr, 10);
        const currentGame = games[currentGameIndex];
        if (!isNaN(moveNum) && moveNum >= 1 && currentGame) {
          currentMoveIndex = Math.min(
            moveNum - 1,
            currentGame.moves.length - 1,
          );
        }
        break;
      }

      case "g": {
        // 指定対局へ（引数を入力）
        const gameStr = await rlPrompt("Go to game: ");
        const gameNum = parseInt(gameStr, 10);
        if (!isNaN(gameNum) && gameNum >= 1 && gameNum <= games.length) {
          currentGameIndex = gameNum - 1;
          currentMoveIndex = 0;
        }
        break;
      }

      case "c": {
        // 盤面をクリップボードへコピー（エディタ形式）
        const game = games[currentGameIndex];
        if (game) {
          const editorFormat = gameRecordToEditorFormat(
            game.moves,
            currentMoveIndex + 1,
          );
          const success = await copyToClipboard(editorFormat);
          if (success) {
            console.log("盤面をクリップボードにコピーしました");
          } else {
            console.log("クリップボードへのコピーに失敗しました");
          }
        }
        await sleep(1000);
        break;
      }

      case "R": {
        // 棋譜をクリップボードへコピー
        const game = games[currentGameIndex];
        if (game) {
          const success = await copyToClipboard(game.gameRecord);
          if (success) {
            console.log("棋譜をクリップボードにコピーしました");
          } else {
            console.log("クリップボードへのコピーに失敗しました");
          }
        }
        await sleep(1000);
        break;
      }

      case "r": {
        // 棋譜表示
        const game = games[currentGameIndex];
        if (game) {
          console.log("\n棋譜:", game.gameRecord);
        }
        await sleep(2000);
        break;
      }

      case "l": {
        // 対局リスト
        console.clear();
        showGameList(games);
        await rlPrompt("\nPress Enter to continue...");
        break;
      }

      default:
        // 未知のキーは無視
        continue;
    }

    showCurrentState();
  }
  /* oxlint-enable no-await-in-loop */
}

/**
 * メイン処理
 */
async function main(): Promise<void> {
  const options = parseArgs();

  // 分析結果ファイルを取得
  const analysisFile = getLatestAnalysisFile(options.inputDir);
  if (!analysisFile) {
    console.error(`Error: No analysis files found in ${options.inputDir}`);
    console.error("Run 'pnpm analyze:games' first to generate analysis data.");
    process.exit(1);
  }

  console.log(`Loading: ${path.basename(analysisFile)}\n`);

  // 分析結果を読み込み
  const content = fs.readFileSync(analysisFile, "utf-8");
  const result: AnalysisResult = JSON.parse(content);

  // フィルタ適用
  const filteredGames = result.games.filter((game) =>
    matchesFilter(game, options.filter),
  );

  if (options.interactive) {
    await interactiveMode(filteredGames, options.startGame, options.startMove);
  } else {
    showGameList(filteredGames);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
