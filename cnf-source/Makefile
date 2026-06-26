# ============================================================================
# CNF v1.0.1 Makefile
# 数据库：MySQL 8.0 / MariaDB 10.5+（DSN 见 .env.example 的 CNF_MYSQL_DSN）。
# 注意：cnf-server 与 cnf-agent 都依赖 libvirt-go(CGO)，必须在装有
#       libvirt-devel 的 Rocky Linux 9 / RHEL 9 上编译：
#         dnf install -y libvirt-devel gcc
# ============================================================================
VERSION := 1.0.1
LDFLAGS := -X main.Version=$(VERSION) -s -w
GO      := go

# 数据库迁移依赖 mysql 客户端与 DSN 中的连接信息。
# 直接复用 server 读取的 CNF_MYSQL_DSN（go-sql-driver 格式），
# 但 mysql CLI 需要拆分参数，因此单独提供 CNF_MYSQL_* 覆盖项。
CNF_MYSQL_HOST ?= 127.0.0.1
CNF_MYSQL_PORT ?= 3306
CNF_MYSQL_USER ?= cnf
CNF_MYSQL_PASS ?= cnf
CNF_MYSQL_DB   ?= cnf

.PHONY: all build server agent test fmt vet clean dist migrate

all: build

## 编译 server + agent（均需 CGO，因 internal/virt 依赖 libvirt）
build: server agent

## 控制面（依赖 libvirt-go，需 CGO 开启）
server:
	CGO_ENABLED=1 $(GO) build -ldflags "$(LDFLAGS)" -o bin/cnf-server ./cmd/cnf-server

## 宿主机代理（需 libvirt-devel，CGO 开启）
agent:
	CGO_ENABLED=1 $(GO) build -ldflags "$(LDFLAGS)" -o bin/cnf-agent ./cmd/cnf-agent

## 单元测试（含 libvirt XML 生成器，覆盖率 >70%）
test:
	CGO_ENABLED=1 $(GO) test ./... -cover

vet:
	CGO_ENABLED=1 $(GO) vet ./...

fmt:
	$(GO) fmt ./...

## 应用数据库迁移（MySQL）。需本机有 mysql 客户端。
## 用法：make migrate CNF_MYSQL_HOST=... CNF_MYSQL_USER=... CNF_MYSQL_PASS=... CNF_MYSQL_DB=...
## 说明：cnf-server 启动时会自动调用 RunMigrations 做幂等迁移，
##       本目标仅用于手工/CI 场景。迁移目录为 migrations/mysql。
migrate:
	@for f in migrations/mysql/*.up.sql; do \
		echo "应用 $$f"; \
		mysql -h"$(CNF_MYSQL_HOST)" -P"$(CNF_MYSQL_PORT)" -u"$(CNF_MYSQL_USER)" \
			-p"$(CNF_MYSQL_PASS)" "$(CNF_MYSQL_DB)" < "$$f"; \
	done

## 打包发布物（二进制 + 脚本 + 迁移 + systemd）
dist: build
	mkdir -p dist/cnfv1
	cp bin/cnf-server bin/cnf-agent dist/cnfv1/ 2>/dev/null || true
	cp -r migrations deploy/systemd scripts/install.sh scripts/upgrade.sh dist/cnfv1/ 2>/dev/null || true
	cd dist && tar -czf cnfv1-$(VERSION).tar.gz cnfv1
	@echo "发布包: dist/cnfv1-$(VERSION).tar.gz"

clean:
	rm -rf bin dist
