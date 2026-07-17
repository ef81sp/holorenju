/**
 * Texel 流ロジスティック回帰（純粋ロジック）。
 *
 * 空点プロスペクト基底の重み（カテゴリ×手番 = 34個）を、教師局面への
 * ロジスティック回帰で決めるための計算部分。docs/plans/eval-basis-prospect-2026-07-13.md
 * §4 と docs/plans/prospect-texel-p3-2026-07-15.md（P3-c）に対応する。
 *
 * 損失: Σ (sigmoid(w·x / K) − label)² 。sigmoid∘線形結合の合成は局所的には
 * 滑らかで、全バッチ勾配降下で実用上安定して解ける（本モジュールが担う範囲）。
 *
 * ノート（標準化）: 特徴列は値域が大きく異なる（カテゴリにより計数は0〜数百）ため、
 * 内部で列ごとに標準偏差でスケーリングしてから勾配降下する。返す重みは
 * 呼び出し側の契約どおり生の特徴空間（w·features/K が意味を保つ）に変換して返す。
 */

/** シグモイド関数。 */
export function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/** Rapfi 教師ラベル: 評価値(stm視点)を sigmoid(eval/K) で勝率スケールに変換する。 */
export function rapfiTeacherLabel(evalStm: number, K: number): number {
  return sigmoid(evalStm / K);
}

/** 平均二乗損失: mean((sigmoid(w·x/K) − label)²)。 */
export function meanSquaredLoss(
  X: number[][],
  labels: number[],
  weights: number[],
  K: number,
): number {
  const n = X.length;
  if (n === 0) {
    return 0;
  }
  let total = 0;
  for (let i = 0; i < n; i++) {
    const p = sigmoid(dot(weights, X[i]!) / K);
    const err = p - labels[i]!;
    total += err * err;
  }
  return total / n;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i]! * b[i]!;
  }
  return s;
}

/** 平均勾配: d/dw mean((sigmoid(w·x/K) − label)²)。 */
function meanGradient(
  X: number[][],
  labels: number[],
  weights: number[],
  K: number,
): number[] {
  const n = X.length;
  const d = weights.length;
  const grad = new Array<number>(d).fill(0);
  for (let i = 0; i < n; i++) {
    const xi = X[i]!;
    const p = sigmoid(dot(weights, xi) / K);
    const err = p - labels[i]!;
    // d(sigmoid(z))/dz = p(1-p), z = w·x/K なので dz/dw_j = x_j/K
    const coeff = (2 * err * p * (1 - p)) / K;
    for (let j = 0; j < d; j++) {
      grad[j]! += coeff * xi[j]!;
    }
  }
  for (let j = 0; j < d; j++) {
    grad[j] = grad[j]! / n;
  }
  return grad;
}

export interface FitLogisticOptions {
  /**
   * 標準化済み空間での初期学習率。既定は K（sigmoid の勾配に 1/K が乗るため、
   * lr=K でおおむね O(1) の初期ステップに揃う）。成功ステップごとに拡大、
   * 失敗（損失が悪化）時は縮小するバックトラック方式（bold driver）で
   * 単一の初期値からでも安定して適切なステップ幅に収束する。
   */
  learningRate?: number;
  /** 最大反復数。既定 5000。 */
  maxIterations?: number;
  /** 収束判定: 損失の相対変化がこれを下回ったら停止。既定 1e-10。 */
  tolerance?: number;
}

export interface FitLogisticResult {
  /** 生の特徴空間での重み（w·features/K がそのまま意味を保つ）。 */
  weights: number[];
  trainLoss: number;
  iterations: number;
}

/**
 * 全バッチ勾配降下でロジスティック回帰を解く。
 *
 * 内部で特徴を列ごとに標準化（標準偏差でスケーリング、分散ゼロの列はスケール1に
 * フォールバック）してから勾配降下し、収束後に生の特徴空間の重みへ変換して返す。
 * 学習率は bold driver 方式（成功ステップで拡大 ×1.1、悪化ステップで縮小 ×0.5
 * して同じ勾配で再試行）で単一の初期値からでも安定して収束する。
 */
export function fitLogistic(
  X: number[][],
  labels: number[],
  K: number,
  opts: FitLogisticOptions = {},
): FitLogisticResult {
  const n = X.length;
  if (n === 0) {
    throw new Error("fitLogistic: 空のデータセット");
  }
  if (labels.length !== n) {
    throw new Error("fitLogistic: X と labels の長さが不一致");
  }
  const d = X[0]!.length;

  const initialLearningRate = opts.learningRate ?? K;
  const maxIterations = opts.maxIterations ?? 5000;
  const tolerance = opts.tolerance ?? 1e-10;

  const scale = computeColumnScales(X, d);
  const Xs = X.map((row) => row.map((v, j) => v / scale[j]!));

  let w = new Array<number>(d).fill(0);
  let loss = meanSquaredLoss(Xs, labels, w, K);
  let lr = initialLearningRate;
  let iterations = 0;

  for (; iterations < maxIterations; iterations++) {
    const grad = meanGradient(Xs, labels, w, K);
    const candidate = applyStep(w, grad, lr);
    const candidateLoss = meanSquaredLoss(Xs, labels, candidate, K);

    if (candidateLoss > loss) {
      lr *= 0.5;
      if (lr < 1e-12) {
        break;
      }
      continue;
    }

    const relChange = loss > 0 ? (loss - candidateLoss) / loss : 0;
    w = candidate;
    loss = candidateLoss;
    lr *= 1.1;
    if (relChange < tolerance) {
      iterations++;
      break;
    }
  }

  const weights = w.map((wj, j) => wj / scale[j]!);
  return { weights, trainLoss: loss, iterations };
}

/** w - lr*grad の要素ごとの候補ステップ（loop 内クロージャを避けるため関数として分離）。 */
function applyStep(w: number[], grad: number[], lr: number): number[] {
  return w.map((wj, j) => wj - lr * grad[j]!);
}

/** 列ごとの標準偏差スケール（分散ゼロの列は1にフォールバックし0除算を避ける）。 */
function computeColumnScales(X: number[][], d: number): number[] {
  const n = X.length;
  const scale = new Array<number>(d).fill(1);
  for (let j = 0; j < d; j++) {
    let mean = 0;
    for (let i = 0; i < n; i++) {
      mean += X[i]![j]!;
    }
    mean /= n;
    let variance = 0;
    for (let i = 0; i < n; i++) {
      const diff = X[i]![j]! - mean;
      variance += diff * diff;
    }
    variance /= n;
    const std = Math.sqrt(variance);
    scale[j] = std > 1e-9 ? std : 1;
  }
  return scale;
}

/**
 * 決定的な擬似乱数生成器（mulberry32）。テスト用の合成データ生成・groupKFold の
 * シャッフルに使う（Math.random は非決定的なため使用禁止）。
 */
export function createSeededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Fold {
  train: number[];
  val: number[];
}

/**
 * グループ（対局）単位の k-fold 分割。同一グループの要素は必ず同じ fold 内で
 * train/val のどちらか一方にまとまる（局面リークを避ける）。
 *
 * 決定的シード付きシャッフルでユニークグループを fold に割り当てるため、
 * 同一入力からは常に同一分割を返す。
 */
export function groupKFold(groups: string[], k: number, seed = 42): Fold[] {
  if (k < 2) {
    throw new Error(`groupKFold: k は2以上である必要があります（got ${k}）`);
  }
  const uniqueGroups = [...new Set(groups)];
  if (uniqueGroups.length < k) {
    throw new Error(
      `groupKFold: グループ数(${uniqueGroups.length})が k(${k})未満です`,
    );
  }

  const rng = createSeededRandom(seed);
  const shuffled = [...uniqueGroups];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = tmp;
  }

  const groupToFold = new Map<string, number>();
  shuffled.forEach((g, i) => groupToFold.set(g, i % k));

  const folds: Fold[] = Array.from({ length: k }, () => ({
    train: [] as number[],
    val: [] as number[],
  }));
  groups.forEach((g, idx) => {
    const foldOfGroup = groupToFold.get(g)!;
    for (let f = 0; f < k; f++) {
      if (f === foldOfGroup) {
        folds[f]!.val.push(idx);
      } else {
        folds[f]!.train.push(idx);
      }
    }
  });

  return folds;
}
