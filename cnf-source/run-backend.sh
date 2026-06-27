#!/bin/bash
# 启动 CNF 控制面后端（cnf-server）—— 本地开发/测试用固定环境。
# 路径由脚本自身位置自动推导，不写死任何环境目录，便于跨机器复用。
set -euo pipefail

# 项目内 cnf-source 目录 = 本脚本所在目录
CNF_SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$CNF_SOURCE_DIR"

export CNF_LISTEN_ADDR=":8090"
export CNF_MYSQL_DSN='cnf:cnf@tcp(127.0.0.1:3306)/cnf?parseTime=true&charset=utf8mb4&loc=Local'
export CNF_REDIS_ADDR="127.0.0.1:6379"
export CNF_MIGRATIONS_DIR="${CNF_SOURCE_DIR}/migrations/mysql"
export CNF_STORAGE_LOCAL_PATH="/var/lib/cnf/images"
export CNF_OFFLINE_PKG_PATH="/var/lib/cnf/offline-packages"
export CNF_JWT_SECRET="cnf-prod-fixed-secret-2026"

exec ./bin/cnf-server
