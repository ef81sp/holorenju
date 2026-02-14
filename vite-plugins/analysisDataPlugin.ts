/**
 * Vite dev サーバー用プラグイン
 * analyzed-games/ 内の分析データを API として配信する
 */

import type { Plugin } from "vite";

import * as fs from "node:fs";
import * as path from "node:path";

export function analysisDataPlugin(): Plugin {
  return {
    name: "analysis-data",
    configureServer(server) {
      const analysisDir = path.resolve(server.config.root, "analyzed-games");

      server.middlewares.use("/api/analysis-files", (_req, res) => {
        if (!fs.existsSync(analysisDir)) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify([]));
          return;
        }
        const files = fs
          .readdirSync(analysisDir)
          .filter((f) => f.startsWith("analysis-") && f.endsWith(".json"))
          .sort();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(files));
      });

      server.middlewares.use("/api/analysis-data/", (req, res) => {
        const filename = req.url?.slice(1); // remove leading "/"
        if (!filename || !/^analysis-.*\.json$/.test(filename)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid filename" }));
          return;
        }
        const filePath = path.join(analysisDir, filename);
        if (!fs.existsSync(filePath)) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found" }));
          return;
        }
        const content = fs.readFileSync(filePath, "utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(content);
      });
    },
  };
}
