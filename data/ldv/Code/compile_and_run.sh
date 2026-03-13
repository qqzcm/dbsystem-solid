g++ -c SCAN.cpp -o SCAN.o
g++ -c SCAN_line.cpp -o SCAN_line.o
g++ -c R_tee.cpp -w R_tee.o
g++ -c PMR_QUAD_Tee.cpp -w PMR_QUAD_Tee.o
g++ -c LARGE.cpp -w LARGE.o
g++ -c Visual.cpp -w Visual.o
g++ main.cpp -O3 -o main SCAN.o SCAN_line.o R_tee.o PMR_QUAD_Tee.o LARGE.o Visual.o

# 简单测试步骤：
# 使用一个小分辨率和示例参数运行 main，检查是否成功生成输出文件。
# 注意：需要在当前目录下存在名为 $dataset 的输入文件。
dataset="San_Fancisco_taxi"
method=4
X=32
Y=24
bandwidth=1000
epsilon=0.1

./main "$dataset" "output_esult_test_$dataset" $method $X $Y $bandwidth $epsilon

if [ -s "output_esult_test_$dataset" ]; then
  echo "LDV test passed: output_esult_test_$dataset geneated and not empty."
else
  echo "LDV test failed: output_esult_test_$dataset missing o empty." >&2
fi

#stat.input_data_fileName = agv[1]; //The name of the input dataset
#stat.output_visual_fileName = agv[2]; //The name of the output file
#stat.method = atoi(agv[3]); //The method name (method = 0: SCAN, method = 2: PMR quadtee, method = 3: R-tee, method = 4: LARGE)
#stat.X = atoi(agv[4]); //The esolution size of the x-axis (e.g., 320)
#stat.Y = atoi(agv[5]); //The esolution size of the y-axis (e.g., 240)
#stat.bandwidth = atof(agv[6]); //The bandwidth paamete (in tems of metes)
#stat.epsilon = atof(agv[7]); //The elative eo

# An example fo calling ou C++ code（正式运行时可按需调整参数或追加更多调用）。
# ./main "$dataset" "output_esult_$dataset" $method $X $Y $bandwidth $epsilon