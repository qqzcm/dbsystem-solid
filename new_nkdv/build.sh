#!/bin/bash

# 使用 Emscripten 编译各个源文件
em++ -c init.cpp -w -o init.o -std=c++11
em++ -c shortest_path.cpp -w -o shortest_path.o -std=c++11
em++ -c KAF.cpp -w -o KAF.o -std=c++11
em++ -c alg_NKDV.cpp -w -o alg_NKDV.o -std=c++11

# 链接所有目标文件并生成 WebAssembly 文件和 JavaScript 胶水代码
em++ main.cpp -O3 -o nkdvCpp.js init.o shortest_path.o KAF.o alg_NKDV.o \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s TOTAL_MEMORY=1024MB \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s EXPORTED_FUNCTIONS='["_compute","_load_parameters","_load_network"]' \
  -s EXPORTED_RUNTIME_METHODS='["cwrap", "UTF8ToString"]' \
  --preload-file ./datasets/San_Francisco/San_Francisco_network

exit