import os
import subprocess
from pathlib import Path


def run_ldv_once(
    dataset_path: str,
    output_path: str,
    method: int = 4,
    X: int = 64,
    Y: int = 48,
    bandwidth: float = 1000.0,
    epsilon: float = 0.1,
) -> None:
    """
    调用已有的 C++ 可执行文件 main，跑一次 LDV，并简单检查输出结果。

    参数说明与 Visual.cpp 中 init(stat, argc, argv) 一致：
      - dataset_path: 输入数据文件路径（与 C++ 代码中的 argv[1] 对应）
      - output_path: 输出结果文件路径（与 argv[2] 对应）
      - method: 可视化方法编号（0~9）
      - X, Y: 栅格分辨率
      - bandwidth: 带宽参数（单位与数据坐标一致）
      - epsilon: 相对误差参数
    """
    code_dir = Path(__file__).resolve().parent
    main_exe = code_dir / "main"

    if not main_exe.exists():
        raise FileNotFoundError(
            f"未找到可执行文件 {main_exe}，请先在该目录下运行 compile_and_run.sh 完成编译。"
        )

    dataset_path = str(Path(dataset_path).resolve())
    output_path = str(Path(output_path).resolve())

    if not os.path.exists(dataset_path):
        raise FileNotFoundError(f"输入数据文件不存在：{dataset_path}")

    cmd = [
        str(main_exe),
        dataset_path,
        output_path,
        str(method),
        str(X),
        str(Y),
        str(bandwidth),
        str(epsilon),
    ]

    print("运行命令：", " ".join(cmd))
    subprocess.run(cmd, check=True)

    if not os.path.exists(output_path):
        raise RuntimeError(f"LDV 运行后未生成输出文件：{output_path}")

    # 简单检查输出内容
    num_lines = 0
    xs, ys, ds = [], [], []
    with open(output_path, "r", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) != 3:
                continue
            try:
                x, y, d = map(float, parts)
            except ValueError:
                continue
            num_lines += 1
            xs.append(x)
            ys.append(y)
            ds.append(d)

    if num_lines == 0:
        raise RuntimeError(f"输出文件 {output_path} 为空或无法解析。")

    print(f"输出行数: {num_lines}")
    print(f"x 范围: [{min(xs)}, {max(xs)}]")
    print(f"y 范围: [{min(ys)}, {max(ys)}]")
    print(f"density 范围: [{min(ds)}, {max(ds)}]")


if __name__ == "__main__":
    """
    使用示例：
      1. 确保已在本目录运行过 compile_and_run.sh 生成 main 可执行文件；
      2. 修改下面的 dataset_path 为你本地的 LDV 输入数据文件路径；
      3. 在终端中（激活 D:\\anaconda3 的 Python 环境后）运行：
           python test_ldv_compute.py
    """
    # TODO: 将此路径替换为你真实的输入数据文件路径
    dataset_path = "San_Francisco_taxi"

    # 输出文件将生成到当前目录
    output_path = "output_result_python_test.txt"

    run_ldv_once(
        dataset_path=dataset_path,
        output_path=output_path,
        method=4,
        X=64,
        Y=48,
        bandwidth=1000.0,
        epsilon=0.1,
    )

