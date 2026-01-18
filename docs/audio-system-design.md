# BGM・効果音再生機能 設計ドキュメント

## 概要

連珠学習アプリにBGMと効果音を追加し、より没入感のある学習体験を提供する。

## アーキテクチャ

```
preferencesStore.ts  ─── 音量・有効/無効設定（localStorage永続化）
         │
audioStore.ts  ──────── 再生制御・Audio インスタンス管理（新規作成）
         │
PreferencesDialog.vue ─ サウンド設定UI（セクション追加）
```

### 技術選定

- **HTML5 Audio API** を使用（外部依存なし、シンプル）
- 音声ファイルは別途用意

## 詳細設計

### 1. preferencesStore への追加

`src/stores/preferencesStore.ts` に audio 設定を追加：

```typescript
interface Preferences {
  animation: { ... };
  display: { ... };
  audio: {
    enabled: boolean;       // 音を再生する（マスタースイッチ）
    hasBeenAsked: boolean;  // 初回確認済みフラグ
    masterVolume: number;   // 0.0 - 1.0（全体音量）
    bgmEnabled: boolean;    // BGM有効/無効
    bgmVolume: number;      // 0.0 - 1.0
    sfxEnabled: boolean;    // 効果音有効/無効
    sfxVolume: number;      // 0.0 - 1.0
  };
}
```

デフォルト値：

```typescript
audio: {
  enabled: false,        // 初回確認まではオフ
  hasBeenAsked: false,   // 初回確認前
  masterVolume: 0.8,
  bgmEnabled: true,
  bgmVolume: 0.5,
  sfxEnabled: true,
  sfxVolume: 0.7,
}
```

実効音量の計算：

- BGM: `masterVolume * bgmVolume`
- 効果音: `masterVolume * sfxVolume`

### 2. audioStore（新規作成）

`src/stores/audioStore.ts` を新規作成：

```typescript
// BGMトラック定義
interface BgmTrack {
  id: string;
  url: string;
  category: "top" | "menu" | "scenario";
}

// 効果音の種類
type SfxType =
  | "stone-place" // 石配置
  | "correct" // 正解
  | "incorrect" // 不正解
  | "dialog-advance" // 会話送り
  | "button-click"; // ボタンクリック

// 主要API
interface AudioStore {
  // BGM制御
  playBgm(category: BgmCategory, options?: { trackId?: string }): void;
  stopBgm(): void;
  fadeBgm(duration: number): Promise<void>;

  // 効果音制御
  playSfx(type: SfxType): void;
  preloadSfx(): void;

  // 状態
  currentBgm: string | null;
  isPlaying: boolean;
}
```

#### BGM再生ロジック

- カテゴリ内に複数曲がある場合はランダム選択
- シーン切り替え時はフェードアウト後に新BGMを再生
- ループ再生を基本とする

#### 効果音再生ロジック

- 同じ効果音が連続で呼ばれた場合は重複再生を許可
- 事前にプリロードしてレイテンシを最小化

### 3. 音声ファイル構成

```
public/audio/
├── bgm/
│   ├── top/           # トップ画面用
│   │   └── top-01.mp3
│   ├── menu/          # メニュー画面用
│   │   └── menu-01.mp3
│   └── scenario/      # シナリオプレイ用
│       └── scenario-01.mp3
└── sfx/
    ├── stone-place.mp3      # 石配置音
    ├── correct.mp3          # 正解音
    ├── incorrect.mp3        # 不正解音
    ├── dialog-advance.mp3   # 会話送り音
    └── button-click.mp3     # ボタンクリック音
```

### 4. 初回サウンド確認ダイアログ

アプリ初回起動時（`hasBeenAsked === false`）に確認ダイアログを表示する。

**ダイアログ内容：**

- タイトル：「サウンド設定」
- メッセージ：「音を再生しますか？」
- 補足：「この設定は後から設定画面で変更できます」
- ボタン：
  - 「再生する」→ `enabled: true`, `hasBeenAsked: true`
  - 「再生しない」→ `enabled: false`, `hasBeenAsked: true`

**実装場所：**

- `src/components/common/AudioConfirmDialog.vue`（新規作成）
- `MainView.vue` の onMounted で `hasBeenAsked` をチェックし、未確認なら表示

**目的：**

- ブラウザの Autoplay Policy 対策（ユーザー操作を経て音声再生を許可）
- ユーザーに音声再生の選択権を与える

### 5. PreferencesDialog 追加セクション

`src/components/common/PreferencesDialog.vue` に「サウンド」セクションを追加：

| コントロール                 | 説明                                  |
| ---------------------------- | ------------------------------------- |
| 音を再生するチェックボックス | 全音声のオン/オフ（マスタースイッチ） |
| マスター音量スライダー       | 0〜100%の全体音量調整                 |
| BGM有効チェックボックス      | BGMのオン/オフ切り替え                |
| BGM音量スライダー            | 0〜100%の音量調整                     |
| 効果音有効チェックボックス   | 効果音のオン/オフ切り替え             |
| 効果音音量スライダー         | 0〜100%の音量調整                     |

音量変更時は即座に反映される。
「音を再生する」がオフの場合、他のコントロールは無効化（グレーアウト）される。

### 6. 統合ポイント

| タイミング         | ファイル                                      | 音声                 |
| ------------------ | --------------------------------------------- | -------------------- |
| トップ画面表示     | `MainView.vue`                                | BGM (top)            |
| メニュー画面表示   | appStore scene変更時                          | BGM (menu)           |
| シナリオプレイ開始 | `ScenarioPlayer.vue` onMounted                | BGM (scenario)       |
| 石配置             | `useQuestionSolver` / `useScenarioNavigation` | SFX (stone-place)    |
| 正解カットイン     | `ScenarioPlayer` showCorrectCutin             | SFX (correct)        |
| 不正解カットイン   | `ScenarioPlayer` showIncorrectCutin           | SFX (incorrect)      |
| 会話送り           | `useScenarioNavigation` advanceDialog         | SFX (dialog-advance) |
| ボタンクリック     | 共通ボタンコンポーネント                      | SFX (button-click)   |

## 修正対象ファイル

| ファイル                                                                       | 変更内容                                                 |
| ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `src/stores/preferencesStore.ts`                                               | audio設定追加（enabled, hasBeenAsked, masterVolume含む） |
| `src/stores/audioStore.ts`                                                     | 新規作成                                                 |
| `src/components/common/AudioConfirmDialog.vue`                                 | 新規作成（初回確認ダイアログ）                           |
| `src/components/common/PreferencesDialog.vue`                                  | サウンドセクション追加                                   |
| `src/components/MainView.vue`                                                  | BGM再生制御、初回確認ダイアログ表示                      |
| `src/components/scenarios/ScenarioPlayer/ScenarioPlayer.vue`                   | BGM・効果音統合                                          |
| `src/components/scenarios/ScenarioPlayer/composables/useQuestionSolver.ts`     | 石配置効果音                                             |
| `src/components/scenarios/ScenarioPlayer/composables/useScenarioNavigation.ts` | デモ石配置・会話送り効果音                               |
| `src/components/common/SettingsButton.vue`                                     | ボタンクリック効果音                                     |
| `src/components/scenarios/ScenarioPlayer/BackButton.vue`                       | ボタンクリック効果音                                     |
| その他ボタン要素を持つコンポーネント                                           | ボタンクリック効果音                                     |

## 実装手順

1. ✅ 設計ドキュメント作成（本ドキュメント）
2. preferencesStore に audio 設定追加
3. audioStore を新規作成
4. AudioConfirmDialog を新規作成（初回確認ダイアログ）
5. PreferencesDialog にサウンド設定UI追加
6. 音声ファイルを public/audio/ に配置
7. 各コンポーネントで統合

## 検証項目

- [ ] 初回起動時に「音を再生しますか？」ダイアログが表示される
- [ ] ダイアログで「再生する」を選択すると音声が有効になる
- [ ] ダイアログで「再生しない」を選択すると音声が無効になる
- [ ] 2回目以降の起動では初回確認ダイアログが表示されない
- [ ] 「音を再生する」チェックボックスで全音声のオン/オフが切り替わる
- [ ] 「音を再生する」オフ時、他のサウンド設定がグレーアウトされる
- [ ] マスター音量変更がBGM・効果音両方に即座に反映される
- [ ] 設定ダイアログで各音量変更が即座に反映される
- [ ] BGMがシーン切り替え時に適切に変更される
- [ ] 効果音が各アクション時に再生される
  - [ ] 石配置音
  - [ ] 正解・不正解音
  - [ ] 会話送り音
  - [ ] ボタンクリック音
- [ ] 設定がlocalStorageに保存され、リロード後も維持される
- [ ] BGM/効果音の無効化が正しく動作する

## 注意事項

- ブラウザのAutoplay Policyにより、ユーザー操作前にBGMが再生されない場合がある
  - → 初回確認ダイアログでユーザー操作を経ることで対策済み
- モバイルブラウザでは特にこの制限が厳しいため、初回確認ダイアログの応答後に音声再生を開始する
