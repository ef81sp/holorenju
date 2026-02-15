# CPUアルゴリズム解説

このドキュメントでは、連珠（五目並べ）CPUの思考ロジックを、プログラミング初心者向けに解説します。

## 目次

1. [概要](#概要)
2. [基本的な考え方](#基本的な考え方)
3. [主要アルゴリズムの説明](#主要アルゴリズムの説明)
4. [処理の流れ](#処理の流れ)
5. [評価関数（スコアの付け方）](#評価関数スコアの付け方)
6. [難易度パラメータの効き方](#難易度パラメータの効き方)
7. [ファイル構成](#ファイル構成)

---

## 概要

CPUは「次にどこに石を置くか」を以下の手順で決定します。

1. **開局フェーズ**: 最初の3手は定石パターン（珠型）から選択
2. **即勝ち検出**: 五連を完成できるかチェック
3. **必須防御**: 相手の活四・止め四を検出し、必須の防御手を特定
4. **強制勝ち探索**: VCF → Mise-VCF → VCTの順で勝ち筋を探索
5. **Minimax探索**: 数手先を読んで最善手を選択

### 使用している主要なアルゴリズム

| アルゴリズム                  | ひとことで言うと                                   |
| ----------------------------- | -------------------------------------------------- |
| Minimax                       | 「自分は最大、相手は最小を選ぶ」ゲーム木探索       |
| Alpha-Beta剪定                | 「調べなくても結果が変わらない手は省略」する最適化 |
| Iterative Deepening           | 「時間内でできるだけ深く読む」仕組み               |
| Aspiration Windows            | 「前回のスコア付近だけ調べる」高速化テクニック     |
| Transposition Table（置換表） | 「同じ局面の計算結果を覚えておく」キャッシュ       |
| Zobrist Hashing               | 「盤面を数値1つで表す」ハッシュ技術                |
| Move Ordering                 | 「良さそうな手から先に調べる」と効率UP             |
| Killer Moves                  | 「前に効果的だった手を優先」するヒューリスティック |
| History Heuristic             | 「過去の統計から良い手を予測」する手法             |
| Late Move Reductions (LMR)    | 「後半の手は浅く調べる」省略テクニック             |
| Null Move Pruning (NMP)       | 「パスして悪くならないなら安全」と判断する剪定     |
| Futility Pruning              | 「逆転不可能な局面は調べない」末端剪定             |
| VCF探索                       | 「四追い勝ち」の専用探索                           |
| Mise-VCF探索                  | 「ミセ手→VCF勝ち」の複合探索                       |
| VCT探索                       | 「三・四連続勝ち」の専用探索                       |

---

## 基本的な考え方

### 先読みの概念

CPUは将棋や囲碁のAIと同じように「先読み」をします。

```
自分が A に打ったら、相手は B に打つだろう。
そうしたら自分は C に打って、相手は D に打つだろう。
その結果、自分は三々が作れるから有利になる。
→ だから A に打とう！
```

このように、数手先まで「自分が打ったら、相手はこう打つだろう」という予測の連鎖を繰り返し、最も良い結果になる手を選びます。

### スコアによる評価

「良い」「悪い」を数値（スコア）で表します。

- **高いスコア**: CPUにとって有利な局面
- **低いスコア**: CPUにとって不利な局面
- **100000点**: 五連完成（勝利確定）
- **-100000点**: 相手が五連完成（負け確定）

---

## 主要アルゴリズムの説明

### 1. Minimax（ミニマックス）

**ひとことで言うと**: 「自分は最大、相手は最小を選ぶ」という考え方でゲーム木を探索するアルゴリズム

#### なぜ必要か

ゲームでは自分だけでなく相手も最善を尽くします。「相手は自分にとって最悪の手を打ってくる」と仮定して、その中で最も良い結果になる手を選ぶ必要があります。

#### 考え方

```
自分の手番: 自分にとって最大（MAX）のスコアになる手を選ぶ
相手の手番: 自分にとって最小（MIN）のスコアになる手を選ぶ
              ↑ 相手にとっては最大だが、自分視点では最小
```

#### 数式

```
minimax(局面, 深さ, 最大化プレイヤーか) =
  if 深さ = 0 または 終端局面:
    return 評価値

  if 最大化プレイヤー:
    return max(minimax(子局面, 深さ-1, false) for 各候補手)
  else:
    return min(minimax(子局面, 深さ-1, true) for 各候補手)
```

**式の意味**:

- `深さ = 0`: これ以上先読みしない
- `終端局面`: 勝敗が決まった状態
- `最大化プレイヤー`: 自分の手番（スコアを最大化したい）
- `子局面`: ある手を打った後の盤面

#### 具体例

```
現在の局面（自分の手番）
├── 手A を打つ → スコア +100
│   ├── 相手が B1 を打つ → スコア +50
│   └── 相手が B2 を打つ → スコア +150
│   → 相手は最小を選ぶので +50
├── 手B を打つ → スコア +80
│   ├── 相手が C1 を打つ → スコア +70
│   └── 相手が C2 を打つ → スコア +90
│   → 相手は最小を選ぶので +70
└── 自分は最大を選ぶので、手B（+70）を選択
```

---

### 2. Alpha-Beta剪定（アルファベータ枝刈り）

**ひとことで言うと**: 「調べなくても結果が変わらない手は省略」して探索を高速化する技術

#### なぜ必要か

Minimaxは全ての手を調べるため、候補手が多いと計算量が爆発的に増えます。Alpha-Beta剪定を使うと、調べる必要のない手をスキップできます。

#### 考え方

```
α（アルファ）: 最大化プレイヤーが保証できる最低スコア
β（ベータ）  : 最小化プレイヤーが保証できる最高スコア

α >= β になったら、それ以上調べても結果は変わらないのでスキップ（剪定）
```

#### 数式

```
alphabeta(局面, 深さ, α, β, 最大化か) =
  if 深さ = 0 または 終端:
    return 評価値

  if 最大化プレイヤー:
    for 各候補手:
      α = max(α, alphabeta(子局面, 深さ-1, α, β, false))
      if β <= α:
        break  // β剪定（これ以上調べても無駄）
    return α
  else:
    for 各候補手:
      β = min(β, alphabeta(子局面, 深さ-1, α, β, true))
      if β <= α:
        break  // α剪定（これ以上調べても無駄）
    return β
```

**式の意味**:

- `α = max(α, スコア)`: 自分が保証できる最低スコアを更新
- `β = min(β, スコア)`: 相手が保証できる最高スコアを更新
- `β <= α`: 相手がこの手を選ばないことが確定（剪定可能）

#### 具体例

```
自分の手番（最大化）
├── 手A → 相手の応手を調べ中... → スコア +70 確定
│   → α = 70 に更新
├── 手B → 相手の応手を調べ中...
│   ├── 相手が B1 → スコア +50
│   │   → β = 50 に更新
│   │   → α(70) >= β(50) なので剪定！
│   │   → 手B は +50 以下が確定、手A(+70)より悪いので調べる意味なし
│   └── 相手が B2 → 調べない（剪定済み）
└── 結果: 手A を選択
```

---

### 3. Iterative Deepening（反復深化）

**ひとことで言うと**: 「時間内でできるだけ深く読む」仕組み

#### なぜ必要か

- 探索深度が深いほど良い手が見つかるが、時間がかかる
- 時間制限があるので、深すぎると間に合わない
- 最適な深度は局面によって変わる

#### 考え方

```
深さ1で探索 → 結果を保存
深さ2で探索 → 結果を更新（Aspiration Windows使用）
深さ3で探索 → 結果を更新（Aspiration Windows使用）
...
時間切れ → 最後に完了した深さの結果を使用
```

#### メリット

1. **時間管理**: 常に「前の深さの結果」があるので、時間切れでも手を返せる
2. **Move Ordering改善**: 浅い探索で見つけた最善手を、深い探索で先に調べられる
3. **Transposition Table活用**: 浅い探索の結果を深い探索で再利用

```typescript
// 実装の概要（iterativeDeepening.ts）
function findBestMoveIterativeWithTT(board, color, maxDepth, timeLimit) {
  // 事前チェック（即勝ち・必須防御・VCF・Mise-VCF・VCT）
  const preSearch = findPreSearchMove(board, color, ...);
  if (preSearch.immediateMove) return preSearch.immediateMove;

  let bestResult = findBestMoveWithTT(board, color, 1); // 深さ1で開始
  let completedDepth = 1;

  for (let depth = 2; depth <= maxDepth; depth++) {
    if (経過時間 > dynamicTimeLimit * 0.8) {
      break; // 残り時間が少ないので中断
    }

    // Aspiration Windowsで探索（前回スコア ± 75 の範囲で高速探索）
    bestResult = findBestMoveWithTT(board, color, depth, aspirationWindow);
    completedDepth = depth;
  }

  return { ...bestResult, completedDepth };
}
```

---

### 4. Aspiration Windows（アスピレーションウィンドウ）

**ひとことで言うと**: 「前回のスコア付近だけ調べる」高速化テクニック

#### なぜ必要か

Alpha-Beta探索のウィンドウ（α, β）を狭めると、剪定がより多く発生して高速化します。前回の深さで得たスコアが大きく変わらないと仮定し、その付近だけ探索します。

#### アルゴリズム

```
前回のスコア = 500

ウィンドウ幅 = 75
α = 500 - 75 = 425
β = 500 + 75 = 575

→ この範囲で探索（高速）

結果がウィンドウ外 → フルウィンドウで再探索（通常速度）
```

#### パラメータ（本実装）

```typescript
ASPIRATION_WINDOW = 75; // ウィンドウ幅
```

---

### 5. Transposition Table（置換表）

**ひとことで言うと**: 「同じ局面の計算結果を覚えておく」キャッシュ

#### なぜ必要か

連珠では、異なる手順で同じ局面に到達することがあります。

```
手順1: A → B → C → D
手順2: A → D → C → B
→ 同じ局面！
```

同じ局面を何度も評価するのは無駄なので、結果を保存して再利用します。

#### データ構造

```typescript
interface TTEntry {
  hash: bigint; // 盤面のハッシュ値（識別用）
  score: number; // 評価スコア
  depth: number; // 探索した深さ
  type: ScoreType; // スコアの種類（後述）
  bestMove: Position; // この局面での最善手
  generation: number; // 世代番号（古いエントリ置換用）
}
```

#### スコアタイプの意味

```
EXACT      : 正確な評価値（α < score < β で求まった）
LOWER_BOUND: 下限値（β剪定で打ち切られた = 実際はこれ以上）
UPPER_BOUND: 上限値（α剪定で打ち切られた = 実際はこれ以下）
```

---

### 6. Zobrist Hashing（ゾブリストハッシュ）

**ひとことで言うと**: 「盤面を数値1つで表す」技術

#### なぜ必要か

Transposition Tableで盤面を検索するには、盤面を識別するキーが必要です。15×15の盤面をそのまま比較すると遅いので、数値1つに変換します。

#### XOR演算とは

```
XOR（排他的論理和）の性質:
- A XOR B = C
- C XOR B = A  // 同じ値を2回XORすると元に戻る

例: 0b1010 XOR 0b1100 = 0b0110
    0b0110 XOR 0b1100 = 0b1010  // 元に戻る
```

#### 仕組み

1. 各マス × 各色（黒/白）に対して、ランダムな64ビット数値を事前に生成
2. 盤面のハッシュ = 全ての石のランダム値をXORした結果

```typescript
// zobrist.ts の実装
const zobristTable = [[[ランダム値, ランダム値], ...]...]  // [row][col][color]

function computeBoardHash(board) {
  let hash = 0n;  // BigInt
  for (各マス (row, col)) {
    if (石がある) {
      hash ^= zobristTable[row][col][colorIndex];  // XOR
    }
  }
  return hash;
}
```

#### 差分更新

石を1つ置く/取る場合、全体を再計算する必要はありません。

```typescript
function updateHash(hash, row, col, color) {
  // XORの性質: 同じ値を2回XORすると元に戻る
  // → 石を置く: XOR で追加
  // → 石を取る: XOR で削除（同じ操作）
  return hash ^ zobristTable[row][col][colorIndex];
}
```

**例**: 黒石を H8 に置く場合

```
新ハッシュ = 旧ハッシュ XOR zobristTable[7][7][黒]
```

---

### 7. Move Ordering（手の並び替え）

**ひとことで言うと**: 「良さそうな手から先に調べる」と効率UP

#### なぜ必要か

Alpha-Beta剪定の効果は、良い手を先に調べるほど大きくなります。

```
最良の手を最初に調べた場合:
├── 手A（最善）→ スコア +100 → α = 100
├── 手B → スコア +50 < α → 剪定しやすい
└── 手C → スコア +30 < α → 剪定しやすい

最悪の手を最初に調べた場合:
├── 手C（最悪）→ スコア +30 → α = 30
├── 手B → スコア +50 > α → 剪定できない、全探索
└── 手A → スコア +100 > α → 剪定できない、全探索
```

#### 優先度（高い順）

1. **TT最善手**: 前回の探索で見つかった最善手（+1,000,000）
2. **Killer Moves**: 同じ深さで剪定を引き起こした手（+100,000 / +90,000）
3. **静的評価**: 盤面を見て「良さそう」と判断した手（Lazy Evaluation対応）
4. **History Heuristic**: 過去に剪定を引き起こした手の統計

#### Lazy Evaluation

候補手が多い場合、全ての手を静的評価するのはコストが高い。そこで、TT・Killer・Historyで事前ソートし、上位N手のみ静的評価を実行して高速化する。

---

### 8. Killer Moves（キラームーブ）

**ひとことで言うと**: 「前に効果的だった手を優先」するヒューリスティック

#### 考え方

ある深さでBeta剪定（相手の応手で打ち切り）を引き起こした手は、同じ深さの他の局面でも有効な可能性が高い。

```
深さ3で、手 H8 が剪定を引き起こした
→ 同じ深さ3の他の局面でも、H8 を優先的に調べる
```

#### データ構造

```typescript
// 各深さに対して、最大2手を記憶
KillerMoves[深さ][0] = 最も新しいKiller Move
KillerMoves[深さ][1] = 2番目に新しいKiller Move
```

---

### 9. History Heuristic（ヒストリーヒューリスティック）

**ひとことで言うと**: 「過去の統計から良い手を予測」する手法

#### 考え方

過去の探索で剪定を引き起こした手の「成功回数」を記録し、成功率が高い手を優先的に調べます。

```typescript
// History Table: [row][col] => スコア
HistoryTable[7][7] = 1500; // H8 は過去に多く剪定を引き起こした

// 剪定を引き起こした時に更新
function updateHistory(history, move, depth) {
  // 深い探索での成功ほど重要 → depth² で重み付け
  history[move.row][move.col] += depth * depth;
}
```

#### Killer Moves との違い

| 項目     | Killer Moves | History Heuristic |
| -------- | ------------ | ----------------- |
| 記憶範囲 | 同じ深さのみ | 全探索を通じて    |
| 記憶数   | 各深さ2手    | 全マス            |
| 更新方法 | 上書き       | 累積              |
| 局面依存 | 深さのみ     | 位置のみ          |

---

### 10. Late Move Reductions (LMR)

**ひとことで言うと**: 「後半の手は浅く調べる」省略テクニック

#### なぜ必要か

Move Orderingにより、良い手は前の方に来ます。つまり、後ろの方の手は「あまり良くない」可能性が高い。あまり良くない手を深く調べるのは無駄なので、浅く調べて本当に良さそうなら再探索します。

#### アルゴリズム

```typescript
for (let i = 0; i < moves.length; i++) {
  if (i >= 3 && depth >= 3 && !isTacticalMove(move)) {
    // 4手目以降 かつ 深さ3以上 かつ 戦術手でないなら、1手浅く探索
    score = search(depth - 1 - 1);  // 削減量 = 1

    if (score が有望) {
      // 有望なら通常の深さで再探索
      score = search(depth - 1);
    }
  } else {
    // 最初の3手・戦術手は通常の深さで探索
    score = search(depth - 1);
  }
}
```

#### パラメータ（本実装）

```typescript
LMR_MOVE_THRESHOLD = 3; // 4手目以降（インデックス3以上）で適用
LMR_MIN_DEPTH = 3; // 深さ3以上で適用
LMR_REDUCTION = 1; // 削減量
```

#### 戦術手の除外

連珠では一手で形勢が激変するため、以下の手はLMRから除外される:

- **連続四を作る手**: count === 4 で片端以上が開いている
- **跳び四を作る手**: checkJumpFourで検出

---

### 11. Null Move Pruning (NMP)

**ひとことで言うと**: 「パスしても悪くならないなら安全な局面」と判断する剪定テクニック

#### なぜ必要か

手番を持つことは通常有利です。もし手番をパス（何もしない）しても十分良いスコアが出るなら、その局面は相手にとって不利なはず。この場合、深く調べなくても安全と判断できます。

#### アルゴリズム

```
if 深さ >= 3 かつ 相手に即座の脅威（四）がない:
  パスした後の局面を 深さ-3 で探索
  if スコアが十分高い（β以上）:
    return β  // 剪定
```

#### パラメータ（本実装）

```typescript
NMP_MIN_DEPTH = 3; // 深さ3以上で適用
NMP_REDUCTION = 2; // 削減量（パス + 2手分浅く探索）
```

---

### 12. Futility Pruning（枝刈り）

**ひとことで言うと**: 「逆転不可能な局面は調べない」末端剪定

#### なぜ必要か

探索末端（浅い深さ）で、現在の評価値と候補手の最大限の改善を足しても、目標スコアに届かない場合、その手は調べる価値がありません。

#### 仕組み

```
if 静的評価 + マージン < α:
  この手は調べない（剪定）
```

#### パラメータ（本実装）

手番によってマージンを分離し、精度を高めています。

```typescript
// 自分の手番: 静的評価が正確なので積極的に刈る
FUTILITY_MARGINS_SELF = [0, 1000, 200, 1000]; // 深さ1,2,3

// 相手の手番: 防御手・カウンター脅威は探索で判明するので慎重に刈る
FUTILITY_MARGINS_OPPONENT = [0, 4100, 1300, 3000]; // 深さ1,2,3
```

---

### 13. VCF探索（Victory by Continuous Fours）

**ひとことで言うと**: 「四追い勝ち」の専用探索

#### 四追い勝ちとは

四（あと1手で五連になる形）を連続で作り続け、相手が止めている間に最終的に五連を完成させる勝ち方。

```
自分: 四を作る（・●●●●・）
相手: 止める（○●●●●・）
自分: 別の四を作る（・●●●●○）
相手: 止める
...
自分: 最後の四を作る → 相手が止められない → 勝利
```

#### 白番の特殊ケース

連珠では黒には禁手（三三、四四、長連）があります。白が四を作った時、黒の防御位置が禁手なら、黒は止められないので白の勝利となります。

```typescript
// vcf.ts の実装概要
function hasVCF(board, color, depth) {
  if (depth >= 8) return false;  // 探索上限

  for (四を作れる各手) {
    四を作った盤面を生成;

    if (五連完成) return true;

    防御位置 = 四を止める位置を取得;

    if (防御位置がない) return true;  // 活四（両端開き）

    if (color === "white" && 防御位置が禁手) {
      return true;  // 黒が止められない
    }

    相手が防御した盤面を生成;

    if (hasVCF(相手が防御した盤面, color, depth + 1)) {
      return true;  // 四追いが続く
    }
  }

  return false;
}
```

#### パラメータ

```typescript
VCF_MAX_DEPTH = 8; // 最大探索深度
VCF_TIME_LIMIT = 150; // 時間制限（ミリ秒）
```

---

### 14. Mise-VCF探索（ミセ手→VCF勝ち）

**ひとことで言うと**: 「ミセ手で相手を誘導してからVCFで仕留める」複合探索

#### なぜ必要か

通常のVCF探索では検出できない勝ち筋がある。ミセ手（次に四三を作れる手）を打つと、相手は四三を防御するしかない。その応手の後にVCFが成立すれば勝利。

```
例:
自分: G7（ミセ手 = 次に四三を狙う）
相手: J7（四三の点を防御するしかない）
自分: H4（VCF開始）→ ... → 勝ち
```

#### アルゴリズム

```typescript
function findMiseVCFMove(board, color) {
  for (ミセ手候補) {
    ミセ手を打った盤面を生成;
    四三防御点 = ミセ手の脅威を止める位置;

    相手が防御した盤面を生成;

    if (VCF探索(相手が防御した盤面, color)) {
      return ミセ手;  // 勝ち確定
    }
  }
  return null;
}
```

#### パラメータ

```typescript
DEFAULT_TIME_LIMIT = 500; // 全体の時間制限（ミリ秒）
// VCF探索: maxDepth=12, timeLimit=300
```

---

### 15. VCT探索（Victory by Continuous Threats）

**ひとことで言うと**: 「三・四連続勝ち」の専用探索

#### VCFとの違い

| 項目         | VCF                     | VCT                            |
| ------------ | ----------------------- | ------------------------------ |
| 使える脅威   | 四のみ                  | 四 + 活三                      |
| 相手の選択肢 | 1通り（止めるしかない） | 複数（どちらを止めるか選べる） |
| 計算量       | 少ない                  | 多い                           |
| 探索深度     | 8手                     | 4手                            |
| 適用条件     | 常時                    | 終盤のみ（14石以上）           |

#### アルゴリズム

```typescript
function hasVCT(board, color, depth) {
  if (depth >= 4) return false;

  // VCFがあればVCT成立（VCF ⊂ VCT）
  if (hasVCF(board, color)) return true;

  for (脅威（四・活三）を作れる各手) {
    脅威を作った盤面を生成;

    防御位置リスト = 脅威を止める位置を全て取得;

    if (防御位置がない) {
      return true;  // 活四など、止められない
    }

    // 全ての防御に対してVCTが続くか確認
    全防御成功 = true;
    for (各防御位置) {
      相手が防御した盤面を生成;
      if (!hasVCT(相手が防御した盤面, color, depth + 1)) {
        全防御成功 = false;
        break;
      }
    }

    if (全防御成功) return true;
  }

  return false;
}
```

#### パラメータ

```typescript
VCT_MAX_DEPTH = 4; // 最大探索深度
VCT_TIME_LIMIT = 150; // 時間制限（ミリ秒）
VCT_STONE_THRESHOLD = 14; // 終盤判定の石数閾値
```

---

## 処理の流れ

```mermaid
flowchart TD
    Start[CPUの手番] --> OpeningCheck{開局フェーズ？<br>3手目以内}

    OpeningCheck -->|Yes| Opening[珠型パターンから選択]
    OpeningCheck -->|No| PreSearch[事前チェック<br>パイプライン]

    Opening --> Return[着手を返す]

    PreSearch --> EmergencyTimeout{絶対時間制限<br>超過？}
    EmergencyTimeout -->|Yes| Fallback[緊急フォールバック<br>上位候補手を返す]
    Fallback --> Return

    EmergencyTimeout -->|No| ImmediateWin{五連を<br>作れる？}
    ImmediateWin -->|Yes| Return

    ImmediateWin -->|No| MustDefend{相手に<br>活四・止め四？}
    MustDefend -->|Yes| DefendFour[四を止める]
    DefendFour --> Return

    MustDefend -->|No| SelfVCF{自分にVCF<br>四追い勝ち？}
    SelfVCF -->|Yes| Return

    SelfVCF -->|No| MiseVCF{Mise-VCF？<br>ミセ→VCF勝ち}
    MiseVCF -->|Yes| Return

    MiseVCF -->|No| VCTHint{VCTヒント？<br>三四連続勝ち}
    VCTHint -->|ヒントあり| PrioritizeVCT[候補手先頭に配置<br>minimax検証に委ねる]

    VCTHint -->|なし| CheckRestrictions{候補手制限？}
    PrioritizeVCT --> CheckRestrictions

    CheckRestrictions -->|相手VCFあり| RestrictVCFDefense[カウンターフォー<br>+ブロック手に制限]
    CheckRestrictions -->|相手活三あり| RestrictOpenThree[防御位置に制限]
    CheckRestrictions -->|なし| NormalMoves[通常の候補手生成]

    RestrictVCFDefense --> DynamicTime
    RestrictOpenThree --> DynamicTime
    NormalMoves --> DynamicTime

    DynamicTime[動的時間配分<br>序盤50%・少候補30%]

    DynamicTime --> IterativeDeepening[Iterative Deepening<br>深さ1から開始]

    IterativeDeepening --> Depth1[深さ1で探索]
    Depth1 --> SaveResult1[結果を保存]
    SaveResult1 --> TimeCheck1{時間に余裕あり？}

    TimeCheck1 -->|Yes| DepthN[深さNで探索<br>Aspiration Windows使用]
    TimeCheck1 -->|No| Return

    DepthN --> TimeCheckN{時間内 かつ<br>最大深度未満？}
    TimeCheckN -->|Yes| DepthN
    TimeCheckN -->|No| Return
```

### 動的時間配分

局面に応じて時間制限を動的に調整します。

| 条件                      | 時間倍率 |
| ------------------------- | -------- |
| 唯一の候補手              | 即座     |
| 序盤（6手以下）           | 50%      |
| 候補手が少ない（3手以下） | 30%      |
| 通常                      | 100%     |

---

## 評価関数（スコアの付け方）

### パターンスコア一覧

評価関数は、盤面上の石のパターンにスコアを付けて「良し悪し」を数値化します。

| パターン                     | スコア  | 説明                                        |
| ---------------------------- | ------- | ------------------------------------------- |
| **五連（FIVE）**             | 100,000 | 勝利確定                                    |
| **活四（OPEN_FOUR）**        | 10,000  | 両端が開いた四連。相手は止められない        |
| **禁手追い込み強**           | 8,000   | 白の四の防御点が黒の禁手                    |
| **四三ボーナス**             | 5,000   | 四と活三を同時に作る（基本スコアに加算）    |
| **禁手追い込み三**           | 3,000   | 三の達四点の一方が禁手                      |
| **末端四三脅威**             | 3,000   | 探索末端で次の1手に四三がある（保守的評価） |
| **禁手追い込みセットアップ** | 1,500   | 活三の延長点が禁手                          |
| **止め四（FOUR）**           | 1,500   | 片端だけ開いた四連（絶対先手）              |
| **ミセ手ボーナス**           | 1,000   | 次に四三を作れる手                          |
| **活三（OPEN_THREE）**       | 1,000   | 両端が開いた三連（相対先手）                |
| **複数方向脅威ボーナス**     | 500     | 2方向以上で脅威を作る                       |
| **防御交差点ボーナス**       | 300     | 相手が2方向以上の脅威を作る位置の防御価値   |
| **活二（OPEN_TWO）**         | 50      | 両端が開いた二連                            |
| **止め三（THREE）**          | 30      | 片端だけ開いた三連                          |
| **連携度ボーナス**           | 30      | 2方向以上にパターンを持つ石への加点/方向    |
| **止め二（TWO）**            | 10      | 片端だけ開いた二連                          |
| **中央ボーナス**             | 0〜5    | 中央に近いほど高い                          |

#### 止め四 > 活三 の理由

止め四（1,500）が活三（1,000）より高い理由は、絶対先手と相対先手の質的差異にある。四は三では止められないが、活三はカウンターフォーで反撃される。複数のOSS実装・大会優勝AI（Rapfi等）の調査結果に基づく設計。

#### 特殊な倍率・係数

| 倍率                 | 値    | 説明                                     |
| -------------------- | ----- | ---------------------------------------- |
| カウンターフォー倍率 | 1.5x  | 防御しながら四を作る手の防御スコアに適用 |
| 斜めボーナス係数     | 1.05x | 斜め連は隣接空き点が多く効率が良い       |

### 禁手脆弱性評価（黒番の弱点検出）

白番がhard難易度の場合、黒の禁手に由来する脆弱性を評価して攻撃に活用します。

| パターン       | スコア | 説明                               |
| -------------- | ------ | ---------------------------------- |
| 脆弱性（強）   | 800    | 三の延長点が禁手で白の攻撃ライン上 |
| 脆弱性（弱）   | 300    | 三の延長点が禁手（白の攻撃なし）   |
| 脆弱性合計上限 | 1,500  | ペナルティの累積制限               |

### 攻撃と防御のバランス

```
最終スコア = 攻撃スコア + 防御スコア + 各種ボーナス

攻撃スコア = 自分のパターンスコア合計
防御スコア = 相手のパターンに応じた脅威レベル別の倍率で計算
```

防御倍率は方向ごとの脅威レベルに応じて `directionAnalysis.ts` の `DEFENSE_MULTIPLIERS` で分化されている。

### 単発四ペナルティ

後続脅威のない単独の四は、攻撃リソースの浪費になる。難易度に応じて四のスコアを減額する。

```
残存倍率 0.0 = 四のスコアを全て打ち消す（hard）
残存倍率 0.3 = 70%減点（medium）
残存倍率 0.6 = 40%減点（easy）
残存倍率 1.0 = ペナルティなし（beginner）
```

### 連珠特有の用語

| 用語         | 意味                                 | 例          |
| ------------ | ------------------------------------ | ----------- |
| **活四**     | 両端が開いた四連。次に必ず五連になる | `・●●●●・`  |
| **止め四**   | 片端だけ開いた四連。止められる       | `○●●●●・`   |
| **活三**     | 両端が開いた三連。次に活四になる     | `・●●●・`   |
| **止め三**   | 片端だけ開いた三連                   | `○●●●・`    |
| **跳び四**   | 1マス空きの四連                      | `●●・●●`    |
| **跳び三**   | 1マス空きの三連                      | `・●・●●・` |
| **フクミ手** | 次にVCF（四追い勝ち）がある手        |             |
| **ミセ手**   | 次に四三（四と活三同時）を作れる手   |             |
| **四三**     | 四と活三を同時に作ること。防御不可能 |             |
| **三三**     | 活三を2つ同時に作ること。黒の禁手    |             |
| **四四**     | 四を2つ同時に作ること。黒の禁手      |             |
| **長連**     | 6つ以上連続。黒の禁手                |             |

### スコア計算の流れ

```typescript
function evaluatePosition(board, row, col, color) {
  // 1. 五連チェック（最優先）
  if (checkFive(...)) return 100000;

  // 2. 仮想的に石を置いて評価
  testBoard = copyBoard(board);
  testBoard[row][col] = color;

  // 3. 攻撃スコア（自分のパターン）
  attackScore = evaluateStonePatterns(testBoard, row, col, color);

  // 4. 防御スコア（相手のパターンを阻止、脅威レベル別倍率）
  testBoard[row][col] = opponentColor;
  defenseScore = evaluateDefense(testBoard, row, col, ...);

  // 5. 各種ボーナス
  fourThreeBonus = (四と活三を同時) ? 5000 : 0;
  miseBonus = (次に四三可能) ? 1000 : 0;
  centerBonus = getCenterBonus(row, col);
  singleFourPenalty = (後続脅威なし) ? -FOUR * (1 - multiplier) : 0;
  forbiddenVulnerability = (黒番の禁手脆弱性) ? ... : 0;
  ...

  // 6. 合計
  return attackScore + defenseScore + fourThreeBonus + miseBonus
       + centerBonus + singleFourPenalty + forbiddenVulnerability + ...;
}
```

---

## 難易度パラメータの効き方

### パラメータ一覧

| パラメータ       | 説明                                                   |
| ---------------- | ------------------------------------------------------ |
| `depth`          | 最大探索深度。深いほど強い                             |
| `timeLimit`      | 時間制限（ミリ秒）。長いほど深く読める                 |
| `randomFactor`   | ランダム要素（0〜1）。高いほど悪手を打ちやすい         |
| `maxNodes`       | 探索ノード数上限。多いほど広く読める                   |
| `scoreThreshold` | ランダム選択時の許容スコア差。広いほど悪手候補が増える |
| 評価オプション   | 評価関数の機能ON/OFF                                   |

### 難易度別の設定比較

| パラメータ        | beginner | easy      | medium    | hard       |
| ----------------- | -------- | --------- | --------- | ---------- |
| 探索深度          | 1        | 2         | 3         | 4          |
| 時間制限          | 1秒      | 2秒       | 4秒       | 8秒        |
| ランダム要素      | 80%      | 25%       | 10%       | 0%         |
| ノード上限        | 10,000   | 50,000    | 200,000   | 600,000    |
| スコア閾値        | 1,200    | 200       | 150       | 0          |
| フクミ手評価      | ✗        | ✗         | ✗         | ✓          |
| ミセ手評価        | ✗        | ✓         | ✓         | ✓          |
| 禁手追い込み      | ✗        | ✗         | ✗         | ✓          |
| 複数方向脅威      | ✗        | ✓         | ✓         | ✓          |
| カウンターフォー  | ✗        | ✗         | ✓         | ✓          |
| VCT探索           | ✗        | ✗         | ✓         | ✓          |
| 必須防御          | ✗        | ✓         | ✓         | ✓          |
| 単発四ペナルティ  | ✗ (100%) | ✓ (40%減) | ✓ (70%減) | ✓ (100%減) |
| ミセ脅威対応      | ✗        | ✗         | ✓         | ✓          |
| Null Move Pruning | ✗        | ✗         | ✗         | ✓          |
| Futility Pruning  | ✗        | ✗         | ✓         | ✓          |
| 禁手脆弱性評価    | ✗        | ✗         | ✗         | ✓          |

### なぜその設定で強さが変わるか

#### 探索深度の効果

```
深さ1: 次の1手だけ見る → 目先の良さだけで判断
深さ3: 自→相→自 の3手先まで見る → 相手の応手を考慮
深さ4: 4手先まで見る → 複雑な読み合い + 枝刈りの効率化
```

#### ランダム要素の効果

```
randomFactor = 0%: 常に最善手を選択
randomFactor = 80%: 80%の確率で次善以下の手を選択
→ 初心者向けに意図的に弱い手を打つ
```

#### 評価オプションの効果

| オプション        | 効果                                 |
| ----------------- | ------------------------------------ |
| フクミ手評価      | 四追い勝ちにつながる手を高評価       |
| 必須防御          | 相手の脅威を見逃さない               |
| 単発四ペナルティ  | 後続のない四を低評価（無駄打ち防止） |
| VCT探索           | 三・四連続勝ちを読み切る             |
| Null Move Pruning | 探索の中断率を削減し深く読める       |
| Futility Pruning  | 末端の無駄な探索を削減               |
| 禁手脆弱性評価    | 黒番の禁手を利用した攻撃を計画       |

---

## ファイル構成

```
src/logic/cpu/
├── index.ts                # 公開API（export）
├── evaluation.ts           # 評価関数（互換リダイレクト）
├── moveGenerator.ts        # 候補手生成
├── moveOrdering.ts         # Move Ordering（Killer・History・Lazy Evaluation）
├── zobrist.ts              # Zobrist Hashing（盤面ハッシュ）
├── transpositionTable.ts   # Transposition Table（置換表）
├── opening.ts              # 開局（珠型）ロジック
├── cpu.worker.ts           # Web Worker（メインスレッドをブロックしない）
├── review.worker.ts        # 分析用Worker（局面レビュー）
│
├── evaluation/             # 評価関数群
│   ├── index.ts            # バレルモジュール
│   ├── patternScores.ts    # スコア定数・評価オプション（SSoT）
│   ├── positionEvaluation.ts # 位置評価（evaluatePosition）
│   ├── boardEvaluation.ts  # 盤面評価（探索末端用）
│   ├── stonePatterns.ts    # 石のパターン解析（連・端の判定）
│   ├── directionAnalysis.ts # 方向別脅威分析・防御倍率
│   ├── threatDetection.ts  # 脅威検出（活四・活三・ミセ手）
│   ├── forbiddenTactics.ts # 禁手追い込み戦術（白番専用）
│   ├── jumpPatterns.ts     # 跳びパターン検出（跳び三・跳び四）
│   ├── miseTactics.ts      # ミセ手戦術
│   ├── tactics.ts          # 複合戦術（四三判定等）
│   ├── followUpThreats.ts  # 後続脅威分析（単発四ペナルティ用）
│   └── breakdownUtils.ts   # スコア内訳ユーティリティ
│
├── search/                 # 探索アルゴリズム群
│   ├── index.ts            # 探索API（バレルモジュール）
│   ├── minimax.ts          # Minimax（バレルモジュール）
│   ├── minimaxCore.ts      # Minimax + Alpha-Beta（TT統合版）
│   ├── minimaxSimple.ts    # Minimax（TT無し簡易版）
│   ├── iterativeDeepening.ts # Iterative Deepening + 事前チェック
│   ├── context.ts          # 探索コンテキスト（時間・ノード管理）
│   ├── results.ts          # 結果集約・Time-Pressure Fallback
│   ├── techniques.ts       # LMR・NMP・Futility・Aspiration定数
│   ├── vcf.ts              # VCF探索（四追い勝ち）
│   ├── vct.ts              # VCT探索（三・四連続勝ち）
│   ├── vctHelpers.ts       # VCT補助関数
│   ├── miseVcf.ts          # Mise-VCF探索（ミセ→VCF複合）
│   ├── threatMoves.ts      # 脅威手検出（四・活三を作る手）
│   ├── threatPatterns.ts   # 脅威パターンユーティリティ
│   └── pvValidation.ts     # PV（最善手列）検証
│
├── core/                   # 基盤ユーティリティ
│   ├── constants.ts        # 定数（方向ベクトルなど）
│   ├── boardUtils.ts       # 盤面操作ユーティリティ
│   └── lineAnalysis.ts     # ライン解析（連の端を調べる）
│
├── cache/                  # キャッシュ
│   └── forbiddenCache.ts   # 禁手判定キャッシュ
│
├── patterns/               # パターン解析
│   └── threatAnalysis.ts   # 脅威パターン解析
│
├── profiling/              # プロファイリング
│   └── counters.ts         # 探索統計カウンター
│
└── benchmark/              # ベンチマーク
    ├── index.ts            # ベンチマーク実行
    ├── gameRunner.ts       # 対局実行エンジン
    ├── rating.ts           # レーティング計算
    ├── statistics.ts       # 統計ユーティリティ
    └── headless.ts         # ヘッドレステスト用
```

### 各ファイルの役割

| ファイル                | 役割                                            |
| ----------------------- | ----------------------------------------------- |
| `patternScores.ts`      | スコア定数・評価オプション型の一元管理（SSoT）  |
| `positionEvaluation.ts` | 候補手の位置評価スコアを計算                    |
| `boardEvaluation.ts`    | 探索末端での盤面全体の評価                      |
| `directionAnalysis.ts`  | 方向別の脅威レベル分析と防御倍率の適用          |
| `moveGenerator.ts`      | 候補手を生成（既存石の近傍を列挙）              |
| `moveOrdering.ts`       | 候補手を優先度順にソート（TT・Killer・History） |
| `zobrist.ts`            | 盤面をハッシュ値に変換                          |
| `transpositionTable.ts` | 計算結果をキャッシュ                            |
| `iterativeDeepening.ts` | 反復深化・事前チェックパイプライン              |
| `minimaxCore.ts`        | Minimax探索の本体（TT・NMP・Futility統合）      |
| `techniques.ts`         | 探索テクニックの定数と判定関数                  |
| `vcf.ts`                | 四追い勝ちの探索                                |
| `miseVcf.ts`            | ミセ手→VCF勝ちの複合探索                        |
| `vct.ts`                | 三・四連続勝ちの探索                            |
| `forbiddenTactics.ts`   | 白番の禁手追い込み戦術                          |
| `followUpThreats.ts`    | 単発四ペナルティ用の後続脅威分析                |
| `opening.ts`            | 開局定石（珠型）の選択                          |

---

## 参考文献

- [Minimax Algorithm - Wikipedia](https://en.wikipedia.org/wiki/Minimax)
- [Alpha-beta pruning - Wikipedia](https://en.wikipedia.org/wiki/Alpha%E2%80%93beta_pruning)
- [Iterative deepening depth-first search - Wikipedia](https://en.wikipedia.org/wiki/Iterative_deepening_depth-first_search)
- [Zobrist hashing - Wikipedia](https://en.wikipedia.org/wiki/Zobrist_hashing)
- [Transposition table - Chess Programming Wiki](https://www.chessprogramming.org/Transposition_Table)
- [Null-move pruning - Chess Programming Wiki](https://www.chessprogramming.org/Null_Move_Pruning)
- [Futility pruning - Chess Programming Wiki](https://www.chessprogramming.org/Futility_Pruning)
- [Aspiration windows - Chess Programming Wiki](https://www.chessprogramming.org/Aspiration_Windows)
