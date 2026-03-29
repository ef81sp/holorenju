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

    const test_step = b.step("test", "Run unit tests");
    test_step.dependOn(&b.addRunArtifact(test_board).step);
    test_step.dependOn(&b.addRunArtifact(test_patterns).step);
    test_step.dependOn(&b.addRunArtifact(test_evaluate).step);
    test_step.dependOn(&b.addRunArtifact(test_jump_patterns).step);
    test_step.dependOn(&b.addRunArtifact(test_forbidden).step);
}
