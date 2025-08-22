# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CodeLLDB is a VSCode extension that provides a native debugger powered by LLDB for debugging C++, Rust, and other compiled languages. It consists of:
- A debug adapter written in Rust (`adapter/` directory)
- A VSCode extension written in TypeScript (`extension/` directory)
- LLDB integration components (`lldb/` directory)
- Test suites for both C++ and Rust debugging (`debuggee/` and `tests/`)

## Build System

This project uses CMake as the primary build system with Cargo for Rust components. The build process:

1. **Prerequisites**: Ensure Node.js, Python 3.5+, Rust 1.61+, and a C++ compiler are installed
2. **Configure**: Create build directory and run cmake with appropriate toolchain file
3. **Build**: Use cmake --build or make with specific targets

### Essential Build Commands

```bash
# Initial setup (from project root)
mkdir build
cd build
cmake .. -G Ninja -DCMAKE_TOOLCHAIN_FILE=../cmake/toolchain-<platform>.cmake -DLLDB_PACKAGE=<path_to_lldb_package>

# Build commands (from build directory)
cmake --build . --target dev_debugging  # Build for local development/testing
cmake --build . --target adapter        # Build debug adapter only
cmake --build . --target extension      # Build VSCode extension only
cmake --build . --target debuggee       # Build test programs
cmake --build . --target tests          # Build all test prerequisites
cmake --build . --target check          # Run all tests
cmake --build . --target vsix_full      # Build complete VSIX package
cmake --build . --target xclean         # Thorough clean of build artifacts
```

### Running Tests

```bash
# Run all tests
ninja check

# Run specific test suites
ctest -V -R adapter:       # Test adapter functionality
ctest -V -R cargo_test     # Run Rust cargo tests

# Debug tests
# 1. Launch codelldb with: --multi-session --port=4711
# 2. Run tests with: LLDB_SERVER=4711 make check
```

## Architecture

### Key Components

1. **Debug Adapter** (`adapter/`): Rust-based debug adapter implementing the Debug Adapter Protocol
   - `adapter/codelldb/` - Main adapter implementation
   - `adapter/lldb/` - LLDB bindings and interface
   - `adapter/scripts/` - Python scripts for LLDB customization

2. **Extension** (`extension/`): TypeScript VSCode extension
   - `extension/main.ts` - Extension entry point
   - `extension/novsc/` - Standalone adapter components
   - `extension/cargo.ts` - Cargo integration for Rust projects

3. **Platform Support**: Cross-platform with specific handling for Linux, macOS, and Windows
   - Platform-specific toolchain files in `cmake/`
   - Different build configurations for Windows (GNU and MSVC)

### Communication Flow

The extension communicates with the debug adapter via the Debug Adapter Protocol. The adapter interfaces with LLDB to control debugging sessions and translates between VSCode's protocol and LLDB's native API.

## Development Workflow

### Common Development Tasks

1. **Local Development**: Build with `make dev_debugging` to test extension directly from build directory
2. **Testing Changes**: After modifications, rebuild relevant target and run tests
3. **Extension Testing**: Use `code --extensionDevelopmentPath=${workspaceFolder}/build` to test

### Code Style and Conventions

- Rust code uses standard Rust formatting (rustfmt)
- TypeScript follows the existing patterns in the extension directory
- Python scripts follow LLDB's scripting conventions
- CMake files maintain consistency with existing build configuration

## Important Files and Directories

- `package.json` - VSCode extension manifest (generated from template)
- `Cargo.toml` - Root workspace for Rust components
- `CMakeLists.txt` - Main build configuration
- `.vscode/tasks.json` - VSCode tasks for building various targets
- `BUILDING.md` - Detailed build instructions
- `MANUAL.md` - User manual with debugging features documentation
