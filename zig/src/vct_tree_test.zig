/// #22 詰み木の重い統合テスト（実探索を伴うため pre-commit の `test` からは分離）
///
/// 実行: `zig build test-slow`（ReleaseFast 推奨）
///
/// collect-mode の VCT は depth=6 で全防御を全探索するため debug では数十秒〜
/// 数百秒かかる。pre-commit の高速性を保つため通常の `test` ステップには含めない。

const std = @import("std");
const testing = std.testing;

const bitboard = @import("bitboard.zig");
const board_mod = @import("board.zig");
const ft = @import("forced_win_tree.zig");
const ll = @import("line_lookup.zig");
const vct = @import("vct.zig");

const Cell = board_mod.Cell;
const BOARD_SIZE = board_mod.BOARD_SIZE;
const CELL_COUNT = board_mod.CELL_COUNT;

fn place(cells: []Cell, col_letter: u8, disp_row: u8, color: Cell) void {
    const col: u16 = col_letter - 'A';
    const irow: u16 = 15 - @as(u16, disp_row);
    cells[irow * BOARD_SIZE + col] = color;
}

/// 部分木内にいずれかの分岐(defense_count>=2)が存在するか
fn subtreeHasBranch(node_idx: u16) bool {
    if (node_idx == ft.TREE_TERMINAL or node_idx >= vct.g_tree_arena.node_count) return false;
    const node = vct.g_tree_arena.nodes[node_idx];
    if (node.defense_count >= 2) return true;
    var i: u16 = 0;
    while (i < node.defense_count) : (i += 1) {
        if (subtreeHasBranch(vct.g_tree_arena.defenses[node.defense_start + i].child_node)) return true;
    }
    return false;
}

/// 「side 分岐(非defenses[0])の中に更なる分岐がある」= #22 が捨てていた構造
fn hasDeepSideBranch(node_idx: u16) bool {
    if (node_idx == ft.TREE_TERMINAL or node_idx >= vct.g_tree_arena.node_count) return false;
    const node = vct.g_tree_arena.nodes[node_idx];
    if (node.defense_count >= 2) {
        var i: u16 = 1; // defenses[0] 以外
        while (i < node.defense_count) : (i += 1) {
            if (subtreeHasBranch(vct.g_tree_arena.defenses[node.defense_start + i].child_node)) return true;
        }
    }
    var j: u16 = 0;
    while (j < node.defense_count) : (j += 1) {
        if (hasDeepSideBranch(vct.g_tree_arena.defenses[node.defense_start + j].child_node)) return true;
    }
    return false;
}

test "ISSUE22: VCT詰み木 - 既定経路がsequenceと一致し深いside分岐を保持する" {
    ll.init();
    var cells = [_]Cell{.empty} ** CELL_COUNT;
    const B = Cell.black;
    const W = Cell.white;
    // issue #6 棋譜の8手目まで（9手目=黒番が VCT 必勝・深いside分岐あり）
    place(&cells, 'H', 8, B);
    place(&cells, 'H', 7, W);
    place(&cells, 'F', 6, B);
    place(&cells, 'E', 5, W);
    place(&cells, 'F', 8, B);
    place(&cells, 'F', 7, W);
    place(&cells, 'E', 7, B);
    place(&cells, 'E', 8, W);
    bitboard.initFromCells(&cells);

    // レビュー実設定（REVIEW_VCT_OPTIONS_WITH_BRANCHES）に合わせた depth=6
    const result = vct.findVCTSequence(&cells, B, 6, 0, 500000, true);
    try testing.expect(result.found);
    try testing.expect(result.tree_root != ft.TREE_TERMINAL);

    // 既定経路（defenses[0] 連鎖）== sequence（長さ）
    var chain_len: u8 = 0;
    var node_idx: u16 = result.tree_root;
    while (node_idx != ft.TREE_TERMINAL and node_idx < vct.g_tree_arena.node_count and chain_len < 64) {
        const node = vct.g_tree_arena.nodes[node_idx];
        chain_len += 1; // attacker
        if (node.defense_count == 0) break;
        const d0 = vct.g_tree_arena.defenses[node.defense_start];
        chain_len += 1; // defender
        node_idx = d0.child_node;
    }
    try testing.expectEqual(result.len, chain_len);

    // 既定経路 == sequence（内容）
    node_idx = result.tree_root;
    var k: u8 = 0;
    while (node_idx != ft.TREE_TERMINAL and node_idx < vct.g_tree_arena.node_count and k < result.len) {
        const node = vct.g_tree_arena.nodes[node_idx];
        try testing.expectEqual(result.sequence[k].row, node.attacker.row);
        try testing.expectEqual(result.sequence[k].col, node.attacker.col);
        k += 1;
        if (node.defense_count == 0) break;
        const d0 = vct.g_tree_arena.defenses[node.defense_start];
        try testing.expectEqual(result.sequence[k].row, d0.defender.row);
        try testing.expectEqual(result.sequence[k].col, d0.defender.col);
        k += 1;
        node_idx = d0.child_node;
    }

    // #22 の核心: side 分岐の中に更なる分岐が保持されている
    try testing.expect(hasDeepSideBranch(result.tree_root));
}
