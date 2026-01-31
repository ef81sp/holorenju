/**
 * Node.js カスタムローダー
 * @/ パスエイリアスを src/ に解決し、.ts 拡張子を自動補完する
 */

import { existsSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = pathResolve(__dirname, "..");

interface ResolveContext {
  parentURL?: string;
  conditions?: string[];
}

interface ResolveResult {
  url: string;
  shortCircuit?: boolean;
}

type NextResolve = (
  specifier: string,
  context: ResolveContext,
) => Promise<ResolveResult>;

export function resolve(
  specifier: string,
  context: ResolveContext,
  nextResolve: NextResolve,
): Promise<ResolveResult> | ResolveResult {
  // @/ を src/ に変換
  if (specifier.startsWith("@/")) {
    const relativePath = specifier.slice(2);
    const resolved = pathResolve(projectRoot, "src", relativePath);
    const withExt = addTsExtension(resolved);
    return {
      url: pathToFileURL(withExt).href,
      shortCircuit: true,
    };
  }

  // 相対パスの .ts 拡張子補完
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !specifier.endsWith(".ts") &&
    !specifier.endsWith(".js") &&
    context.parentURL
  ) {
    const parentPath = fileURLToPath(context.parentURL);
    const parentDir = dirname(parentPath);
    const resolved = pathResolve(parentDir, specifier);
    const withExt = addTsExtension(resolved);
    if (withExt !== resolved) {
      return {
        url: pathToFileURL(withExt).href,
        shortCircuit: true,
      };
    }
  }

  return nextResolve(specifier, context);
}

function addTsExtension(filePath: string): string {
  // 既に拡張子がある場合はそのまま
  if (filePath.endsWith(".ts") || filePath.endsWith(".js")) {
    return filePath;
  }

  // .ts を試す
  const tsPath = `${filePath}.ts`;
  if (existsSync(tsPath)) {
    return tsPath;
  }

  // index.ts を試す
  const indexPath = pathResolve(filePath, "index.ts");
  if (existsSync(indexPath)) {
    return indexPath;
  }

  // 見つからない場合は .ts を付けて返す
  return tsPath;
}
