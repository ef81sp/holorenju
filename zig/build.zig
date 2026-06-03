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
    test_step.dependOn(&b.addRunArtifact(test_bitboard).step);
    test_step.dependOn(&b.addRunArtifact(test_line_lookup).step);
    test_step.dependOn(&b.addRunArtifact(test_line_potential).step);
    test_step.dependOn(&b.addRunArtifact(test_forced_win_tree).step);
}
