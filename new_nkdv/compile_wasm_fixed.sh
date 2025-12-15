#!/bin/bash
# 修复版本的 NKDV WASM 编译脚本

echo "=== NKDV WASM 编译脚本 (修复版) ==="
echo ""

# 方法1: 使用新安装的 Emscripten
if [ -n "$EMSDK_ROOT" ] && [ -d "$EMSDK_ROOT" ]; then
    echo "使用指定的 EMSDK 路径: $EMSDK_ROOT"
    source "$EMSDK_ROOT/emsdk_env.sh"
elif [ -d "/tmp/emsdk_clean/emsdk" ]; then
    echo "使用临时安装的 EMSDK..."
    export EMSDK_ROOT="/tmp/emsdk_clean/emsdk"
    source "$EMSDK_ROOT/emsdk_env.sh"
else
    echo "尝试使用系统 Emscripten..."
    # 方法2: 尝试系统安装
    if command -v emcc &> /dev/null; then
        echo "找到系统 emcc"
    else
        echo "错误: 未找到 Emscripten 环境"
        echo ""
        echo "请先运行: bash fix_emscripten.sh"
        exit 1
    fi
fi

# 验证 emcc
echo "验证 Emscripten 环境..."
if ! command -v emcc &> /dev/null; then
    echo "错误: emcc 仍然不可用"
    exit 1
fi

echo "Emscripten 版本:"
emcc --version
echo ""

# 检查必要文件
echo "检查必要文件..."
REQUIRED_FILES=("main.cpp" "init.cpp" "alg_NKDV.cpp" "KAF.cpp" "shortest_path.cpp")
for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo "错误: 缺少文件 $file"
        exit 1
    fi
    echo "✓ $file"
done

if [ ! -f "edges_geometry.csv" ]; then
    echo "警告: 缺少 edges_geometry.csv，将跳过预加载"
    PRELOAD_FILES="--preload-file datasets"
else
    echo "✓ edges_geometry.csv"
    PRELOAD_FILES="--preload-file datasets --preload-file edges_geometry.csv"
fi

# 清理旧文件
echo ""
echo "清理旧的 WASM 文件..."
rm -f nkdvCpp.js nkdvCpp.wasm nkdvCpp.data

# 编译 WASM
echo ""
echo "编译 NKDV WASM..."
echo "命令: emcc -O3 main.cpp init.cpp alg_NKDV.cpp KAF.cpp shortest_path.cpp -o nkdvCpp.js ..."

emcc -O3 \
  main.cpp init.cpp alg_NKDV.cpp KAF.cpp shortest_path.cpp \
  -o nkdvCpp.js \
  -std=c++11 \
  -s EXPORTED_FUNCTIONS='["_compute","_load_network","_load_geometry","_reset_network","_load_parameters"]' \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=67108864 \
  -s MAXIMUM_MEMORY=536870912 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME='NKDVModule' \
  $PRELOAD_FILES

COMPILE_RESULT=$?

echo ""
if [ $COMPILE_RESULT -eq 0 ]; then
    echo "=== WASM 编译成功! ==="
    echo ""
    echo "生成的文件:"
    ls -la nkdvCpp.*
    echo ""
    echo "文件大小:"
    du -h nkdvCpp.*
    echo ""
    echo "下一步:"
    echo "1. 启动 HTTP 服务器: python -m http.server 8000"
    echo "2. 打开浏览器访问: http://localhost:8000/test_scenario_b.html"
    echo "3. 或者测试 Mock 版本: http://localhost:8000/test_scenario_b_mock.html"
else
    echo "=== WASM 编译失败! ==="
    echo ""
    echo "可能的解决方案:"
    echo "1. 检查 Emscripten 版本是否兼容"
    echo "2. 检查源代码是否有语法错误"
    echo "3. 尝试简化编译选项"
    echo "4. 查看上面的错误信息"
    exit 1
fi