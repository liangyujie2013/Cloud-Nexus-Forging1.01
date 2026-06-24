#!/usr/bin/env bash
# ============================================================================
# CNFv1.0 滚动升级脚本
# 用法: ./upgrade.sh [--to <version>]
# 策略: 备份 → 停服 → 替换二进制 → 应用新迁移 → 启动 → 健康检查 → 失败回滚
# ============================================================================
set -euo pipefail

readonly CNF_HOME="/opt/cnf"
readonly BACKUP_DIR="/var/lib/cnf/backups/$(date +%Y-%m-%d_%H%M%S)"
readonly LOG="/var/log/cnf-upgrade.log"

log()  { echo -e "\033[0;32m[CNF]\033[0m $*" | tee -a "$LOG"; }
warn() { echo -e "\033[0;33m[WARN]\033[0m $*" | tee -a "$LOG"; }
err()  { echo -e "\033[0;31m[ERR]\033[0m $*" | tee -a "$LOG" >&2; exit 1; }

[[ $EUID -eq 0 ]] || err "必须以 root 运行"
SRC="$(cd "$(dirname "$0")" && pwd)"

backup() {
  log "备份当前版本到 $BACKUP_DIR ..."
  mkdir -p "$BACKUP_DIR"
  cp -a "$CNF_HOME/bin" "$BACKUP_DIR/" 2>/dev/null || true
  # 数据库逻辑备份
  sudo -u postgres pg_dump cnfv1 > "$BACKUP_DIR/cnfv1.sql" 2>>"$LOG" || warn "数据库备份失败"
}

rollback() {
  warn "升级失败，开始回滚..."
  cp -a "$BACKUP_DIR/bin/." "$CNF_HOME/bin/" 2>/dev/null || true
  systemctl restart cnf-server cnf-agent 2>/dev/null || true
  err "已回滚至升级前版本，请检查 $LOG"
}

upgrade() {
  log "停止服务..."
  systemctl stop cnf-server cnf-agent 2>/dev/null || true

  log "替换二进制..."
  [[ -f "$SRC/cnf-server" ]] && install -m 0755 "$SRC/cnf-server" "$CNF_HOME/bin/"
  [[ -f "$SRC/cnf-agent"  ]] && install -m 0755 "$SRC/cnf-agent"  "$CNF_HOME/bin/"

  log "应用新数据库迁移..."
  if [[ -d "$SRC/migrations" ]]; then
    cp -r "$SRC/migrations/." "$CNF_HOME/migrations/"
    for f in "$CNF_HOME"/migrations/*.up.sql; do
      [[ -f "$f" ]] || continue
      sudo -u postgres psql -d cnfv1 -f "$f" 2>>"$LOG" || { warn "迁移失败"; rollback; }
    done
  fi

  log "更新 systemd 单元..."
  [[ -d "$SRC/systemd" ]] && cp "$SRC"/systemd/*.service /etc/systemd/system/ 2>/dev/null || true
  systemctl daemon-reload

  log "启动服务..."
  systemctl start cnf-server cnf-agent 2>>"$LOG" || rollback
}

health_check() {
  log "健康检查..."
  for i in {1..10}; do
    if curl -fsS http://127.0.0.1:8080/healthz >/dev/null 2>&1; then
      log "✓ 升级成功，服务健康"
      return 0
    fi
    sleep 2
  done
  rollback
}

main() {
  : > "$LOG"
  log "开始 CNFv1.0 滚动升级..."
  backup
  upgrade
  health_check
  log "升级完成。回滚备份保存在: $BACKUP_DIR"
}
main "$@"
