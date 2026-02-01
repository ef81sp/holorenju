/**
 * カスタムローダーを register() API で登録
 * Node.js の --import オプションで読み込む
 */

import { register } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(__dirname, "loader.ts")), import.meta.url);
