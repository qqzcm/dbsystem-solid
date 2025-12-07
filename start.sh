#!/bin/bash

# DBSystem 启动脚本
# 使用方法: ./start.sh [start|stop|restart|status]

APP_NAME="app-1.0.0.jar"
APP_PATH="app/target/$APP_NAME"
LOG_FILE="app.log"
PID_FILE="app.pid"

# JVM 参数配置（已禁用 STD 模块，使用较小内存）
JVM_OPTS="-Xms512m -Xmx1g -XX:+UseG1GC"

# 应用参数配置
# 注意：STD 模块已通过 @Profile("std") 禁用
# 如需启用 STD 功能，添加: --spring.profiles.active=std
APP_OPTS="--server.port=8080"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查 Java 是否安装
check_java() {
    if ! command -v java &> /dev/null; then
        echo -e "${RED}错误: 未找到 Java，请先安装 Java 11 或更高版本${NC}"
        exit 1
    fi
    
    JAVA_VERSION=$(java -version 2>&1 | awk -F '"' '/version/ {print $2}' | awk -F '.' '{print $1}')
    if [ "$JAVA_VERSION" -lt 11 ]; then
        echo -e "${RED}错误: Java 版本过低，需要 Java 11 或更高版本${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✓ Java 版本检查通过${NC}"
}

# 检查应用文件是否存在
check_app() {
    if [ ! -f "$APP_PATH" ]; then
        echo -e "${RED}错误: 找不到应用文件 $APP_PATH${NC}"
        echo -e "${YELLOW}请先运行: mvn clean package -DskipTests${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ 应用文件检查通过${NC}"
}

# 获取应用 PID
get_pid() {
    if [ -f "$PID_FILE" ]; then
        cat "$PID_FILE"
    fi
}

# 检查应用是否运行
is_running() {
    local pid=$(get_pid)
    if [ -n "$pid" ] && ps -p "$pid" > /dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# 启动应用
start() {
    echo -e "${YELLOW}正在启动 DBSystem...${NC}"
    
    check_java
    check_app
    
    if is_running; then
        echo -e "${YELLOW}应用已经在运行中 (PID: $(get_pid))${NC}"
        exit 0
    fi
    
    # 启动应用
    nohup java $JVM_OPTS -jar "$APP_PATH" $APP_OPTS > "$LOG_FILE" 2>&1 &
    local pid=$!
    echo $pid > "$PID_FILE"
    
    # 等待启动
    sleep 3
    
    if is_running; then
        echo -e "${GREEN}✓ 应用启动成功！${NC}"
        echo -e "${GREEN}  PID: $(get_pid)${NC}"
        echo -e "${GREEN}  日志: tail -f $LOG_FILE${NC}"
        echo -e "${GREEN}  访问: http://localhost:8080${NC}"
    else
        echo -e "${RED}✗ 应用启动失败，请查看日志: $LOG_FILE${NC}"
        rm -f "$PID_FILE"
        exit 1
    fi
}

# 停止应用
stop() {
    echo -e "${YELLOW}正在停止 DBSystem...${NC}"
    
    if ! is_running; then
        echo -e "${YELLOW}应用未运行${NC}"
        rm -f "$PID_FILE"
        exit 0
    fi
    
    local pid=$(get_pid)
    echo -e "${YELLOW}正在停止进程 $pid...${NC}"
    
    # 优雅关闭
    kill "$pid"
    
    # 等待最多 30 秒
    local count=0
    while is_running && [ $count -lt 30 ]; do
        sleep 1
        count=$((count + 1))
        echo -n "."
    done
    echo ""
    
    if is_running; then
        echo -e "${YELLOW}优雅关闭超时，强制停止...${NC}"
        kill -9 "$pid"
        sleep 1
    fi
    
    if is_running; then
        echo -e "${RED}✗ 停止失败${NC}"
        exit 1
    else
        echo -e "${GREEN}✓ 应用已停止${NC}"
        rm -f "$PID_FILE"
    fi
}

# 重启应用
restart() {
    echo -e "${YELLOW}正在重启 DBSystem...${NC}"
    stop
    sleep 2
    start
}

# 查看状态
status() {
    if is_running; then
        local pid=$(get_pid)
        echo -e "${GREEN}应用正在运行${NC}"
        echo -e "  PID: $pid"
        echo -e "  内存使用: $(ps -p $pid -o rss= | awk '{printf "%.2f MB", $1/1024}')"
        echo -e "  运行时间: $(ps -p $pid -o etime= | xargs)"
        echo -e "  日志文件: $LOG_FILE"
        
        # 检查端口
        if command -v netstat &> /dev/null; then
            local port=$(netstat -tlnp 2>/dev/null | grep "$pid" | awk '{print $4}' | awk -F: '{print $NF}' | head -1)
            if [ -n "$port" ]; then
                echo -e "  监听端口: $port"
            fi
        fi
    else
        echo -e "${RED}应用未运行${NC}"
        if [ -f "$PID_FILE" ]; then
            echo -e "${YELLOW}发现残留的 PID 文件，正在清理...${NC}"
            rm -f "$PID_FILE"
        fi
    fi
}

# 查看日志
logs() {
    if [ -f "$LOG_FILE" ]; then
        tail -f "$LOG_FILE"
    else
        echo -e "${RED}日志文件不存在: $LOG_FILE${NC}"
        exit 1
    fi
}

# 主函数
case "$1" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        restart
        ;;
    status)
        status
        ;;
    logs)
        logs
        ;;
    *)
        echo "使用方法: $0 {start|stop|restart|status|logs}"
        echo ""
        echo "命令说明:"
        echo "  start   - 启动应用"
        echo "  stop    - 停止应用"
        echo "  restart - 重启应用"
        echo "  status  - 查看应用状态"
        echo "  logs    - 查看应用日志"
        exit 1
        ;;
esac

exit 0
