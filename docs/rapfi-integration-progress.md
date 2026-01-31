# Rapfi統合 作業記録

## 概要

既存のJavaScript AI（弱めのCPU用）を残しつつ、Rapfiエンジン（WebAssembly）を強いCPU用に導入する。

## 完了した作業

### 1. 型定義の拡張

**ファイル**: `src/types/cpu.ts`

- `EngineType`型を追加: `'builtin' | 'rapfi'`
- `DifficultyParams`に`engine`フィールドを追加
- 難易度ごとのエンジン割り当て:
  - beginner/easy: `builtin`
  - medium/hard: `rapfi`

### 2. useCpuPlayerの拡張

**ファイル**: `src/components/cpu/composables/useCpuPlayer.ts`

- 難易度に応じてbuiltinとrapfiのWorkerを切り替えるロジックを追加
- Rapfi Workerは`/rapfi/rapfi.worker.js`から通常のWorkerとして読み込み

### 3. InfoDialogにライセンス表示追加

**ファイル**: `src/components/common/InfoDialog.vue`

- GPL v3ライセンスに従い、Rapfiのクレジットを情報ダイアログに追加

### 4. Rapfi WebAssemblyビルド

**ソース**: https://github.com/dhbloo/rapfi (tag: 250615)

#### ビルド環境

- Emscripten: 5.0.0 (Homebrew)
- CMake: 4.2.3
- Platform: macOS arm64

#### 適用したパッチ

`public/rapfi/PATCHES.md`に記録済み

**パッチ1**: CMakeLists.txt - TEXTDECODER修正

```diff
-            "-s TEXTDECODER=0 "
+            "-s TEXTDECODER=2 "
```

理由: Emscripten 5.0.0で`TEXTDECODER=0`のサポートが削除された

**パッチ2**: search/searchthread.cpp - シングルスレッドビルド修正

```diff
 void ThreadPool::waitForIdle()
 {
+#ifdef MULTI_THREADING
     for (auto &th : *this)
         if (th->thread.get_id() != std::this_thread::get_id())
             th->waitForIdle();
+#endif
 }
```

理由: `NO_MULTI_THREADING=ON`でビルドすると`th->thread`が存在しないためコンパイルエラー

#### ビルドコマンド（シングルスレッド版）

```bash
cd /tmp/rapfi-build
mkdir -p Rapfi/build/wasm-single-simd128 && cd Rapfi/build/wasm-single-simd128
emcmake cmake ../.. -DCMAKE_BUILD_TYPE=Release -DNO_COMMAND_MODULES=ON -DUSE_WASM_SIMD=ON -DUSE_WASM_SIMD_RELAXED=OFF -DNO_MULTI_THREADING=ON
emmake cmake --build . -j4
```

#### 生成されたファイル

- `rapfi-single-simd128.js` (38KB) - JSローダー
- `rapfi-single-simd128.wasm` (1.1MB) - WASMバイナリ
- `rapfi-single-simd128.data` (38MB) - NNUEモデルデータ

### 5. Worker実装

**ファイル**: `public/rapfi/rapfi.worker.js`

Rapfi公式ビルド版のインターフェース:

- `Module.sendCommand(cmd)` - コマンド送信
- `Module.onReceiveStdout(callback)` - 出力受信

## 未解決の問題

### Rapfiが即座に終了する

**エラー**: `ExitStatus: Program terminated with exit(0)`

`await Rapfi()`で初期化後、`sendCommand("START 15")`を呼び出すと、プログラムが`exit(0)`で終了してしまう。

**試したこと**:

1. 初期化時にコマンドを送信しない → 同じエラー
2. `START`の応答を待ってから次のコマンドを送信 → 同じエラー

**考えられる原因**:

- `noExitRuntime`が正しく機能していない
- Emscriptenのバージョン互換性問題
- Worker環境での特殊な動作

**次のステップ案**:

1. Emscriptenのバージョンを下げる（emsdk 3.1.x系）
2. マルチスレッド版を使用（COOP/COEPヘッダーの設定が必要）
3. gomocalcのコードを参考に、Worker通信の方法を変更

## ファイル構成

```
public/rapfi/
├── PATCHES.md                  # パッチ記録
├── rapfi-single-simd128.js     # JSローダー
├── rapfi-single-simd128.wasm   # WASMバイナリ
├── rapfi-single-simd128.data   # NNUEモデル
└── rapfi.worker.js             # Worker用ラッパー

src/types/cpu.ts                # EngineType追加済み
src/components/cpu/composables/useCpuPlayer.ts  # エンジン切替実装済み
src/components/common/InfoDialog.vue            # ライセンス表示追加済み
```

## 参考資料

- [Rapfi GitHub](https://github.com/dhbloo/rapfi)
- [gomoku-calculator](https://github.com/dhbloo/gomoku-calculator) - gomocalc.comのソース
- [Piskvork Protocol](https://plastovicka.github.io/protocl2en.htm)
- [Emscripten Settings Reference](https://emscripten.org/docs/tools_reference/settings_reference.html)

## ビルド済みファイルの場所

```
/tmp/rapfi-build/Rapfi/build/wasm-single-simd128/  # シングルスレッド版
/tmp/rapfi-build/Rapfi/build/wasm-multi-simd128/   # マルチスレッド版
```
