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
/// 1ノードあたりの受け手の最大数（防御点列挙の上限に余裕を持たせた値）
const MAX_CHILDREN_PER_NODE: u16 = 32;

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

    pub fn reset(self: *Arena) void {
        self.node_count = 0;
        self.defense_count = 0;
        self.overflow = false;
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
        var child_indices: [MAX_CHILDREN_PER_NODE]u16 = undefined;
        const cap: u16 = @min(n, MAX_CHILDREN_PER_NODE);
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
