/// 詰み木アリーナ（review 専用・collect_branches 時のみ構築）
///
/// 追詰（VCT / Mise-VCF / 両ミセ）の AND-OR 木を、ポインタを使わず
/// フラット配列＋index 参照（アリーナ）で表現する。
///
/// - node = 攻め手 + その後の受け選択肢（defenses）の範囲
/// - defense = 受け手 + 継続ノード index（TERMINAL = 攻め手で勝ち確定）
/// - 終端は `defense_count = 0`（next:null は持たない）に一本化
///
/// 探索は候補手ごとにノードを積み、worse/失敗候補は snapshot/rollback で破棄する。
/// 破棄しきれない superseded best は dead node として残るため、シリアライズ時に
/// root から到達可能なノードのみを compact して書き出す（serializeCompact）。

const threats = @import("threats.zig");

const Position = threats.Position;

pub const TREE_TERMINAL: u16 = 0xFFFF;
pub const MAX_TREE_NODES: u16 = 2000;
pub const MAX_TREE_DEFENSES: u16 = 4000;
/// 1ノードあたりの受け手の最大数
///
/// 木の生成側（`vct.zig` の `MAX_DEFENSE_ENTRIES` / `mise_vcf.zig` の分岐数）と
/// シリアライズ側のバッファ長の SSoT。生成側がこれを超える受けを持つ局面では
/// 超過分が木から落ちる（`Arena.defense_truncated` で観測できる）。
pub const MAX_DEFENSES_PER_NODE = 20;

pub const TreeNode = struct {
    attacker: Position,
    defense_start: u16,
    defense_count: u16,
};

pub const TreeDefense = struct {
    defender: Position,
    /// 継続ノード index。TREE_TERMINAL = 継続なし（この防御後に攻め側即勝ち）
    child_node: u16,
};

pub const Arena = struct {
    nodes: [MAX_TREE_NODES]TreeNode = undefined,
    node_count: u16 = 0,
    defenses: [MAX_TREE_DEFENSES]TreeDefense = undefined,
    defense_count: u16 = 0,
    /// 上限超過が起きたか（超過枝は terminal に倒す）
    overflow: bool = false,
    /// 1ノードの受けが `MAX_DEFENSES_PER_NODE` を超えて切り捨てられたか（issue #122）
    ///
    /// 詰み判定そのものは壊れないが、表示の受け分岐が欠ける。受け点を増やす修正
    /// （#115 / #121）で到達確率が上がったので観測できるようにしてある。
    /// 立てるのは木の生成側（`vct.zig`）。
    defense_truncated: bool = false,

    pub fn reset(self: *Arena) void {
        self.node_count = 0;
        self.defense_count = 0;
        self.overflow = false;
        self.defense_truncated = false;
    }

    pub fn snapshot(self: *const Arena) Snapshot {
        return .{ .nodes = self.node_count, .defenses = self.defense_count };
    }

    pub fn rollback(self: *Arena, s: Snapshot) void {
        self.node_count = s.nodes;
        self.defense_count = s.defenses;
    }

    /// 受け手1件を defenses 配列末尾に追記。
    /// 呼び出し側は同一ノードの defenses を連続して追記すること（contiguous 前提）。
    pub fn addDefense(self: *Arena, defender: Position, child: u16) void {
        if (self.defense_count >= MAX_TREE_DEFENSES) {
            self.overflow = true;
            return;
        }
        self.defenses[self.defense_count] = .{ .defender = defender, .child_node = child };
        self.defense_count += 1;
    }

    /// 攻め手ノードを確保。defense_start/count は事前に追記済みの defenses 範囲を指す。
    /// 上限超過時は TREE_TERMINAL を返す（呼び出し側は terminal として扱う）。
    pub fn addNode(self: *Arena, attacker: Position, def_start: u16, def_count: u16) u16 {
        if (self.node_count >= MAX_TREE_NODES) {
            self.overflow = true;
            return TREE_TERMINAL;
        }
        const idx = self.node_count;
        self.nodes[idx] = .{
            .attacker = attacker,
            .defense_start = def_start,
            .defense_count = def_count,
        };
        self.node_count += 1;
        return idx;
    }

    /// 受け手一覧から攻め手ノードを 1 つ構築する（メインライン前出し）。
    ///
    /// 詰み木の規約は「`defenses[0]` の連鎖がメイン PV」なので、`main_idx` の受けを
    /// 先頭に積み直してから残りを元の順で積む。`defenses` は contiguous でなければ
    /// ならず（`addDefense` の前提）、この関数の中でまとめて積むことでその制約を
    /// 呼び出し側から隠す。`vct.zig` に 2 箇所、`mise_vcf.zig` に 1 箇所あった
    /// 同じ手続きの複製を集約したもの。
    ///
    /// `main_idx` が範囲外なら 0（＝最初の受け）にフォールバックする
    /// （受けが切り捨てられてメインラインが載らなかった場合に起こりうる）。
    /// `MAX_TREE_DEFENSES` 超過で積めなかったぶんは `defense_count` に含めない。
    pub fn addNodeMainFirst(
        self: *Arena,
        attacker: Position,
        node_defenses: []const TreeDefense,
        main_idx: usize,
    ) u16 {
        if (node_defenses.len == 0) return self.addNode(attacker, 0, 0);
        const main: usize = if (main_idx < node_defenses.len) main_idx else 0;

        const def_start = self.defense_count;
        self.addDefense(node_defenses[main].defender, node_defenses[main].child_node);
        for (node_defenses, 0..) |d, i| {
            if (i == main) continue;
            self.addDefense(d.defender, d.child_node);
        }
        // 上限で積めなかったぶんを count に含めると他ノードの範囲を指してしまう
        const added = self.defense_count - def_start;
        return self.addNode(attacker, def_start, added);
    }

    /// 線形手順（分岐なし）からチェインを構築し root node index を返す。
    /// positions は攻め始まり交互 [a0, d0, a1, d1, a2, ...]。
    /// len==0 なら TREE_TERMINAL。
    pub fn buildLinearChain(self: *Arena, positions: []const Position, len: u8) u16 {
        return self.buildChainFrom(positions, 0, len);
    }

    fn buildChainFrom(self: *Arena, positions: []const Position, i: u8, len: u8) u16 {
        if (i >= len) return TREE_TERMINAL;
        // 攻め手 positions[i]
        if (i + 1 >= len) {
            // 受けがない＝終端
            return self.addNode(positions[i], 0, 0);
        }
        // 子（次の攻め手 positions[i+2] 以降）を先に構築
        const child = self.buildChainFrom(positions, i + 2, len);
        const def_start = self.defense_count;
        self.addDefense(positions[i + 1], child);
        return self.addNode(positions[i], def_start, 1);
    }
};

pub const Snapshot = struct {
    nodes: u16,
    defenses: u16,
};

/// 攻め側/受け側の役割を保持したまま、root から到達可能なノードのみを
/// out_nodes / out_defenses に compact コピーする。戻り値は書き込んだ
/// (node_count, defense_count)。root が TREE_TERMINAL の場合は (0,0)。
///
/// 出力では root が index 0 になる（pre-order）。dead node は除外される。
pub fn serializeCompact(
    arena: *const Arena,
    root: u16,
    out_nodes: []TreeNode,
    out_defenses: []TreeDefense,
) struct { node_count: u16, defense_count: u16 } {
    var w = CompactWriter{
        .arena = arena,
        .out_nodes = out_nodes,
        .out_defenses = out_defenses,
        .node_count = 0,
        .defense_count = 0,
    };
    if (root != TREE_TERMINAL and root < arena.node_count) {
        _ = w.copyNode(root);
    }
    return .{ .node_count = w.node_count, .defense_count = w.defense_count };
}

const CompactWriter = struct {
    arena: *const Arena,
    out_nodes: []TreeNode,
    out_defenses: []TreeDefense,
    node_count: u16,
    defense_count: u16,

    /// src ノードを出力にコピーし、出力上の index を返す。
    fn copyNode(self: *CompactWriter, src: u16) u16 {
        const src_node = self.arena.nodes[src];
        // このノードのスロットを先に確保（pre-order）
        if (self.node_count >= self.out_nodes.len) return TREE_TERMINAL;
        const my_idx = self.node_count;
        self.node_count += 1;

        const n = src_node.defense_count;
        // 子を先にコピーして index を得る
        var child_indices: [MAX_DEFENSES_PER_NODE]u16 = undefined;
        const cap: u16 = @min(n, MAX_DEFENSES_PER_NODE);
        var i: u16 = 0;
        while (i < cap) : (i += 1) {
            const d = self.arena.defenses[src_node.defense_start + i];
            child_indices[i] = if (d.child_node == TREE_TERMINAL)
                TREE_TERMINAL
            else
                self.copyNode(d.child_node);
        }
        // defenses を contiguous に書き出し
        const def_start = self.defense_count;
        var written: u16 = 0;
        i = 0;
        while (i < cap) : (i += 1) {
            if (self.defense_count >= self.out_defenses.len) break;
            const d = self.arena.defenses[src_node.defense_start + i];
            self.out_defenses[self.defense_count] = .{
                .defender = d.defender,
                .child_node = child_indices[i],
            };
            self.defense_count += 1;
            written += 1;
        }
        self.out_nodes[my_idx] = .{
            .attacker = src_node.attacker,
            .defense_start = def_start,
            .defense_count = written,
        };
        return my_idx;
    }
};

// =============================================================================
// Tests
// =============================================================================

const std = @import("std");
const testing = std.testing;

fn p(row: u8, col: u8) Position {
    return .{ .row = row, .col = col };
}

test "buildLinearChain: 攻め始まり交互で線形チェインを作る" {
    var arena = Arena{};
    arena.reset();
    const positions = [_]Position{ p(0, 0), p(1, 1), p(2, 2) }; // a0,d0,a1
    const root = arena.buildLinearChain(&positions, 3);

    var out_nodes: [16]TreeNode = undefined;
    var out_defs: [16]TreeDefense = undefined;
    const r = serializeCompact(&arena, root, &out_nodes, &out_defs);

    try testing.expectEqual(@as(u16, 2), r.node_count);
    try testing.expectEqual(@as(u16, 1), r.defense_count);
    // root: a0, 防御1件
    try testing.expectEqual(@as(u8, 0), out_nodes[0].attacker.row);
    try testing.expectEqual(@as(u16, 1), out_nodes[0].defense_count);
    // 防御 d0 → child
    try testing.expectEqual(@as(u8, 1), out_defs[0].defender.row);
    const child = out_defs[0].child_node;
    try testing.expect(child != TREE_TERMINAL);
    // child: a1, 終端（防御0件）
    try testing.expectEqual(@as(u8, 2), out_nodes[child].attacker.row);
    try testing.expectEqual(@as(u16, 0), out_nodes[child].defense_count);
}

test "addNode/addDefense: 複数防御ノードと compact" {
    var arena = Arena{};
    arena.reset();
    // 2つの終端子ノード
    const c0 = arena.addNode(p(5, 5), 0, 0);
    const c1 = arena.addNode(p(6, 6), 0, 0);
    // 親の防御ブロック（contiguous）
    const def_start = arena.defense_count;
    arena.addDefense(p(1, 1), c0);
    arena.addDefense(p(2, 2), c1);
    const root = arena.addNode(p(0, 0), def_start, 2);

    var out_nodes: [16]TreeNode = undefined;
    var out_defs: [16]TreeDefense = undefined;
    const r = serializeCompact(&arena, root, &out_nodes, &out_defs);

    try testing.expectEqual(@as(u16, 3), r.node_count);
    try testing.expectEqual(@as(u16, 2), r.defense_count);
    // root は index 0、防御2件、defense_start=0（pre-order で子の後に書かれる）
    try testing.expectEqual(@as(u8, 0), out_nodes[0].attacker.row);
    try testing.expectEqual(@as(u16, 2), out_nodes[0].defense_count);
    // 2件の防御がそれぞれ別の子を指す
    const d0 = out_defs[out_nodes[0].defense_start];
    const d1 = out_defs[out_nodes[0].defense_start + 1];
    try testing.expectEqual(@as(u8, 1), d0.defender.row);
    try testing.expectEqual(@as(u8, 2), d1.defender.row);
    try testing.expect(d0.child_node != d1.child_node);
    try testing.expectEqual(@as(u8, 5), out_nodes[d0.child_node].attacker.row);
    try testing.expectEqual(@as(u8, 6), out_nodes[d1.child_node].attacker.row);
}

test "snapshot/rollback: dead node が compact で除外される" {
    var arena = Arena{};
    arena.reset();
    // best 候補（残す）
    const keep = arena.addNode(p(9, 9), 0, 0);
    const snap = arena.snapshot();
    // worse 候補（捨てる）
    _ = arena.addNode(p(8, 8), 0, 0);
    _ = arena.addNode(p(7, 7), 0, 0);
    arena.rollback(snap);
    try testing.expectEqual(@as(u16, 1), arena.node_count);

    var out_nodes: [16]TreeNode = undefined;
    var out_defs: [16]TreeDefense = undefined;
    const r = serializeCompact(&arena, keep, &out_nodes, &out_defs);
    try testing.expectEqual(@as(u16, 1), r.node_count);
    try testing.expectEqual(@as(u8, 9), out_nodes[0].attacker.row);
}

test "addNodeMainFirst: main_idx の受けを defenses[0] に前出しする" {
    var arena = Arena{};
    arena.reset();
    const defs = [_]TreeDefense{
        .{ .defender = p(1, 1), .child_node = TREE_TERMINAL },
        .{ .defender = p(2, 2), .child_node = TREE_TERMINAL },
        .{ .defender = p(3, 3), .child_node = TREE_TERMINAL },
    };
    const root = arena.addNodeMainFirst(p(7, 7), &defs, 2);
    const node = arena.nodes[root];
    try testing.expectEqual(@as(u16, 3), node.defense_count);
    // main（index 2）が先頭、残りは元の順
    try testing.expectEqual(@as(u8, 3), arena.defenses[node.defense_start].defender.row);
    try testing.expectEqual(@as(u8, 1), arena.defenses[node.defense_start + 1].defender.row);
    try testing.expectEqual(@as(u8, 2), arena.defenses[node.defense_start + 2].defender.row);
}

test "addNodeMainFirst: 範囲外の main_idx は 0 に丸める（配列外参照を作らない）" {
    // 受けが MAX_DEFENSES_PER_NODE で切り捨てられ、メインラインが木に載らなかった
    // ケースに相当する。丸めずに読むと未初期化領域を参照する（#122 レビュー must-1）。
    var arena = Arena{};
    arena.reset();
    const defs = [_]TreeDefense{
        .{ .defender = p(1, 1), .child_node = TREE_TERMINAL },
        .{ .defender = p(2, 2), .child_node = TREE_TERMINAL },
    };
    const root = arena.addNodeMainFirst(p(7, 7), &defs, 99);
    const node = arena.nodes[root];
    try testing.expectEqual(@as(u16, 2), node.defense_count);
    try testing.expectEqual(@as(u8, 1), arena.defenses[node.defense_start].defender.row);
    try testing.expectEqual(@as(u8, 2), arena.defenses[node.defense_start + 1].defender.row);
}

test "addNodeMainFirst: 受け 0 件は終端ノード" {
    var arena = Arena{};
    arena.reset();
    const root = arena.addNodeMainFirst(p(7, 7), &[_]TreeDefense{}, 0);
    try testing.expectEqual(@as(u16, 0), arena.nodes[root].defense_count);
}

test "addNodeMainFirst: defenses 上限で積めなかったぶんは defense_count に含めない" {
    // count に含めると他ノードの範囲を指す木になる
    var arena = Arena{};
    arena.reset();
    arena.defense_count = MAX_TREE_DEFENSES - 1;
    const defs = [_]TreeDefense{
        .{ .defender = p(1, 1), .child_node = TREE_TERMINAL },
        .{ .defender = p(2, 2), .child_node = TREE_TERMINAL },
        .{ .defender = p(3, 3), .child_node = TREE_TERMINAL },
    };
    const root = arena.addNodeMainFirst(p(7, 7), &defs, 0);
    try testing.expectEqual(@as(u16, 1), arena.nodes[root].defense_count);
    try testing.expect(arena.overflow);
}

test "reset: defense_truncated も戻す" {
    var arena = Arena{};
    arena.defense_truncated = true;
    arena.overflow = true;
    arena.reset();
    try testing.expect(!arena.defense_truncated);
    try testing.expect(!arena.overflow);
}
