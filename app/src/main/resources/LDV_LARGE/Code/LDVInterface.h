#pragma once
#ifndef LDV_INTERFACE_H
#define LDV_INTERFACE_H

#include "Visual.h"

// 统一对外的 LDV 计算接口：
// - input_data_fileName: 线段数据文件路径
// - method: 0~9, 对应原有 visual_algorithm 中的方法选择
// - X, Y: 栅格分辨率（行、列）
// - x_L, x_U, y_L, y_U: 当前可视窗口的边界（与输入数据同一坐标系）
// - bandwidth, epsilon: 算法参数
// 返回值：每行一条 "x y density\n" 的字符串，用于前端或上层解析
std::string computeLDV(
    const char* input_data_fileName,
    int method,
    int X, int Y,
    double x_L, double x_U,
    double y_L, double y_U,
    double bandwidth,
    double epsilon
);

#endif

