#!/usr/bin/env python3
"""
为 NKDV 网络数据集添加时间维度
将原始格式：dist_n1 dist_n2
转换为时空格式：dist_n1 dist_n2 time

时间值将在 [t_min, t_max] 范围内随机生成
"""

import sys
import random

def add_time_dimension(input_file, output_file, t_min=1.0, t_max=30.0):
    """
    为网络数据集添加时间维度，使用不均匀的时间分布以产生更明显的时间变化
    
    策略：
    1. 不同边的时间分布不同（模拟不同区域在不同时间有不同活动）
    2. 使用加权随机分布，让某些时间点有更多数据点
    
    Args:
        input_file: 输入文件路径（原始格式）
        output_file: 输出文件路径（包含时间维度）
        t_min: 最小时间值
        t_max: 最大时间值
    """
    import numpy as np
    random.seed(42)  # 固定随机种子以确保可重复性
    np.random.seed(42)
    
    with open(input_file, 'r') as fin, open(output_file, 'w') as fout:
        # 读取边的数量
        num_edges = int(fin.readline().strip())
        fout.write(f"{num_edges}\n")
        
        print(f"Processing {num_edges} edges...")
        print(f"Time range: [{t_min}, {t_max}]")
        
        for edge_idx in range(num_edges):
            # 读取边信息：n1 n2 length num_points
            line = fin.readline().strip()
            if not line:
                break
            
            parts = line.split()
            if len(parts) < 4:
                print(f"Warning: Invalid edge format at edge {edge_idx}: {line}")
                continue
            
            n1, n2, length, num_points = parts[0], parts[1], parts[2], int(parts[3])
            fout.write(f"{n1} {n2} {length} {num_points}\n")
            
            # 为每条边分配一个"主要时间窗口"（模拟不同区域在不同时间有不同活动）
            # 使用边索引来决定主要时间窗口，这样不同边会有不同的时间分布
            edge_time_center = t_min + (edge_idx % 10) * (t_max - t_min) / 10.0
            edge_time_spread = (t_max - t_min) / 5.0  # 每条边的时间分布范围
            
            # 为每个点添加时间维度
            for point_idx in range(num_points):
                point_line = fin.readline().strip()
                if not point_line:
                    print(f"Warning: Missing point data at edge {edge_idx}, point {point_idx}")
                    break
                
                # 原始格式：dist_n1 dist_n2
                # 新格式：dist_n1 dist_n2 time
                dist_parts = point_line.split()
                if len(dist_parts) >= 2:
                    dist_n1, dist_n2 = dist_parts[0], dist_parts[1]
                    
                    # 使用加权随机分布：70% 的数据点在主要时间窗口内，30% 随机分布
                    if random.random() < 0.7:
                        # 主要时间窗口内（使用正态分布）
                        time_value = np.random.normal(edge_time_center, edge_time_spread / 3.0)
                        time_value = max(t_min, min(t_max, time_value))  # 限制在范围内
                    else:
                        # 随机分布在整个时间范围内
                        time_value = random.uniform(t_min, t_max)
                    
                    # 四舍五入到整数（因为时间通常是整数天）
                    time_value = round(time_value)
                    time_value = max(int(t_min), min(int(t_max), time_value))
                    
                    fout.write(f"{dist_n1} {dist_n2} {time_value}\n")
                else:
                    print(f"Warning: Invalid point format at edge {edge_idx}, point {point_idx}: {point_line}")
            
            if (edge_idx + 1) % 1000 == 0:
                print(f"Processed {edge_idx + 1} edges...")
        
        # 读取节点信息（如果有）
        remaining_lines = fin.readlines()
        for line in remaining_lines:
            fout.write(line)
    
    print(f"Successfully added time dimension with non-uniform distribution. Output saved to: {output_file}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python add_time_dimension.py <input_file> <output_file> [t_min] [t_max]")
        print("Example: python add_time_dimension.py San_Francisco_network San_Francisco_network_spatiotemporal 7 14")
        sys.exit(1)
    
    input_file = sys.argv[1]
    output_file = sys.argv[2]
    t_min = float(sys.argv[3]) if len(sys.argv) > 3 else 7.0
    t_max = float(sys.argv[4]) if len(sys.argv) > 4 else 14.0
    
    add_time_dimension(input_file, output_file, t_min, t_max)
