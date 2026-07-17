const std = @import("std");

pub fn build(b: *std.Build) void {
    const wasm_target = b.resolveTargetQuery(.{
        .cpu_arch = .wasm32,
        .os_tag = .freestanding,
    });

    const root_module = b.createModule(.{
        .root_source_file = b.path("src/main.zig"),
        .target = wasm_target,
        .optimize = .ReleaseFast,
    });

    const lib = b.addExecutable(.{
        .name = "cpu-engine",
        .root_module = root_module,
    });
    lib.entry = .disabled;
    lib.rdynamic = true;

    b.installArtifact(lib);

    // 禁手専用 thin wasm（#37 P1。メインスレッド用。forbidden.zig を唯一の真実とする2つ目の出力）
    const forbidden_module = b.createModule(.{
        .root_source_file = b.path("src/forbidden_wasm.zig"),
        .target = wasm_target,
        .optimize = .ReleaseFast,
    });
    const forbidden_lib = b.addExecutable(.{
        .name = "forbidden",
        .root_module = forbidden_module,
    });
    forbidden_lib.entry = .disabled;
    forbidden_lib.rdynamic = true;
    b.installArtifact(forbidden_lib);

    // 脅威分類専用 thin wasm（#37 P3 PR2。review/メイン用。vct.classifyThreat を唯一の真実とする3つ目の出力）
    //
    // 3つ目以降の thin wasm 追加チェックリスト:
    //   1. 依存は board + 真実関数の到達グラフのみ（Zig のデッドコード削除で thin に保つ）
    //   2. bitboard.global_bb に依存する関数（line_lookup 経由）を使うなら syncBitboard を export
    //   3. TS 側 loader は src/logic/cpu/wasm/loader.ts:loadWasmBuffer を再利用（DRY）
    const threat_module = b.createModule(.{
        .root_source_file = b.path("src/threat_wasm.zig"),
        .target = wasm_target,
        .optimize = .ReleaseFast,
    });
    const threat_lib = b.addExecutable(.{
        .name = "threat",
        .root_module = threat_module,
    });
    threat_lib.entry = .disabled;
    threat_lib.rdynamic = true;
    b.installArtifact(threat_lib);

    // Native test step (runs on host, not WASM)
    const native_target = b.resolveTargetQuery(.{});

    const test_board = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/board.zig"),
            .target = native_target,
        }),
    });
    const test_patterns = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/patterns.zig"),
            .target = native_target,
        }),
    });

    const test_evaluate = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/evaluate.zig"),
            .target = native_target,
        }),
    });

    const test_jump_patterns = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/jump_patterns.zig"),
            .target = native_target,
        }),
    });

    const test_forbidden = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/forbidden.zig"),
            .target = native_target,
        }),
    });

    const test_threats = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/threats.zig"),
            .target = native_target,
        }),
    });

    const test_move_gen = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/move_gen.zig"),
            .target = native_target,
        }),
    });

    const test_move_order = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/move_order.zig"),
            .target = native_target,
        }),
    });

    const test_position_eval = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/position_eval.zig"),
            .target = native_target,
        }),
    });

    const test_zobrist = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/zobrist.zig"),
            .target = native_target,
        }),
    });

    const test_tt = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/tt.zig"),
            .target = native_target,
        }),
    });

    const test_quiescence = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/quiescence.zig"),
            .target = native_target,
        }),
    });

    const test_minimax = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/minimax.zig"),
            .target = native_target,
        }),
    });

    const test_search = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/search.zig"),
            .target = native_target,
        }),
    });

    const test_vcf = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/vcf.zig"),
            .target = native_target,
        }),
    });

    const test_vct = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/vct.zig"),
            .target = native_target,
        }),
    });

    const test_incremental_eval = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/incremental_eval.zig"),
            .target = native_target,
        }),
    });

    const test_scores = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/scores.zig"),
            .target = native_target,
        }),
    });

    const test_bitboard = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/bitboard.zig"),
            .target = native_target,
        }),
    });

    const test_line_lookup = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/line_lookup.zig"),
            .target = native_target,
        }),
    });

    const test_line_potential = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/line_potential.zig"),
            .target = native_target,
        }),
    });

    const test_forced_win_tree = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/forced_win_tree.zig"),
            .target = native_target,
        }),
    });

    const test_mise_vcf = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/mise_vcf.zig"),
            .target = native_target,
        }),
    });

    const test_prospect = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/prospect.zig"),
            .target = native_target,
        }),
    });

    const test_step = b.step("test", "Run unit tests");
    test_step.dependOn(&b.addRunArtifact(test_board).step);
    test_step.dependOn(&b.addRunArtifact(test_patterns).step);
    test_step.dependOn(&b.addRunArtifact(test_evaluate).step);
    test_step.dependOn(&b.addRunArtifact(test_jump_patterns).step);
    test_step.dependOn(&b.addRunArtifact(test_forbidden).step);
    test_step.dependOn(&b.addRunArtifact(test_threats).step);
    test_step.dependOn(&b.addRunArtifact(test_move_gen).step);
    test_step.dependOn(&b.addRunArtifact(test_move_order).step);
    test_step.dependOn(&b.addRunArtifact(test_position_eval).step);
    test_step.dependOn(&b.addRunArtifact(test_zobrist).step);
    test_step.dependOn(&b.addRunArtifact(test_tt).step);
    test_step.dependOn(&b.addRunArtifact(test_quiescence).step);
    test_step.dependOn(&b.addRunArtifact(test_minimax).step);
    test_step.dependOn(&b.addRunArtifact(test_search).step);
    test_step.dependOn(&b.addRunArtifact(test_vcf).step);
    test_step.dependOn(&b.addRunArtifact(test_vct).step);
    test_step.dependOn(&b.addRunArtifact(test_incremental_eval).step);
    test_step.dependOn(&b.addRunArtifact(test_scores).step);
    test_step.dependOn(&b.addRunArtifact(test_bitboard).step);
    test_step.dependOn(&b.addRunArtifact(test_line_lookup).step);
    test_step.dependOn(&b.addRunArtifact(test_line_potential).step);
    test_step.dependOn(&b.addRunArtifact(test_forced_win_tree).step);
    test_step.dependOn(&b.addRunArtifact(test_mise_vcf).step);
    test_step.dependOn(&b.addRunArtifact(test_prospect).step);

    // 重い統合テスト（実探索を伴う #22 詰み木検証）。pre-commit の高速性を保つため
    // 通常の `test` には含めず、`zig build test-slow` で実行する（ReleaseFast）。
    const test_vct_tree = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/vct_tree_test.zig"),
            .target = native_target,
            .optimize = .ReleaseFast,
        }),
    });
    const test_slow_step = b.step("test-slow", "Run heavy integration tests (#22 forced-win tree)");
    test_slow_step.dependOn(&b.addRunArtifact(test_vct_tree).step);
}
