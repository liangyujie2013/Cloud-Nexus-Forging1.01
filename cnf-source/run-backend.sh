#!/bin/bash
# 启动 CNF 后端（固定环境，便于本地开发/测试）
cd /webapp/webapp/cnf-source
export CNF_LISTEN_ADDR=":8090"
export CNF_MYSQL_DSN='cnf:cnf@tcp(127.0.0.1:3306)/cnf?parseTime=true&charset=utf8mb4&loc=Local'
export CNF_REDIS_ADDR="127.0.0.1:6379"
export CNF_MIGRATIONS_DIR="/webapp/webapp/cnf-source/migrations/mysql"
export CNF_STORAGE_LOCAL_PATH="/var/lib/cnf/images"
export CNF_OFFLINE_PKG_PATH="/var/lib/cnf/offline-packages"
export CNF_JWT_SECRET="cnf-prod-fixed-secret-2026"
exec ./bin/cnf-server
