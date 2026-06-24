# ============================================================================
# CNFv1.0 Makefile
# 注意：cnf-agent 依赖 libvirt-go(CGO)，必须在装有 libvirt-devel 的
# Rocky Linux 9 / RHEL 9 上编译。cnf-server 可纯静态交叉编译。
# ============================================================================
VERSION := 1.0.0
LDFLAGS := -X main.Version=$(VERSION) -s -w
GO      := go

.PHONY: all build server agent test fmt vet clean dist migrate

all: build

## 编译 server + agent
build: server agent

## 控制面（可静态编译，无 CGO）
server:
	CGO_ENABLED=0 $(GO) build -ldflags "$(LDFLAGS)" -o bin/cnf-server ./cmd/cnf-server

## 宿主机代理（需 libvirt-devel，CGO 开启）
agent:
	CGO_ENABLED=1 $(GO) build -ldflags "$(LDFLAGS)" -o bin/cnf-agent ./cmd/cnf-agent

## 单元测试（含 libvirt XML 生成器，覆盖率 >70%）
test:
	$(GO) test ./internal/virt/... ./internal/model/... ./internal/storage/... -cover

vet:
	$(GO) vet ./internal/virt/ ./internal/model/ ./internal/storage/

fmt:
	$(GO) fmt ./...

## 应用数据库迁移（需配置 CNF_DATABASE_URL）
migrate:
	@for f in migrations/*.up.sql; do \
		echo "应用 $$f"; \
		psql "$(CNF_DATABASE_URL)" -f "$$f"; \
	done

## 打包发布物（二进制 + 脚本 + 迁移 + systemd）
dist: build
	mkdir -p dist/cnfv1
	cp bin/cnf-server bin/cnf-agent dist/cnfv1/ 2>/dev/null || true
	cp -r migrations deploy/systemd scripts/install.sh scripts/upgrade.sh dist/cnfv1/
	cd dist && tar -czf cnfv1-$(VERSION).tar.gz cnfv1
	@echo "发布包: dist/cnfv1-$(VERSION).tar.gz"

clean:
	rm -rf bin dist
