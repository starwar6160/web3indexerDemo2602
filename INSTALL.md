# Installation Guide

## Prerequisites

This project requires Docker and Docker Compose to run PostgreSQL and Anvil (local blockchain node).

## 🐧 Ubuntu/Debian (WSL2)

```bash
# Update package list
sudo apt-get update

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo apt-get install docker-compose

# Add your user to docker group (optional, avoids sudo)
sudo usermod -aG docker $USER

# Verify installation
docker --version
docker-compose --version
```

## 🐧 Fedora

Fedora uses **Podman** by default instead of Docker. You have two options:

### Option 1: Use Podman (Recommended for Fedora)

```bash
# Podman is usually pre-installed on Fedora
podman --version

# Install docker-compose compatibility
sudo dnf install docker-compose

# Create alias for docker-compose to use podman
echo 'alias docker-compose=podman-compose' >> ~/.bashrc
source ~/.bashrc

# Or use podman-compose directly
sudo dnf install podman-compose
```

### Option 2: Install Docker CE on Fedora

```bash
# Remove existing Podman/Docker packages
sudo dnf remove docker-ce podman docker-compose docker-compose-plugin

# Add Docker repository
sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo

# Install Docker CE
sudo dnf install docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Enable and start Docker service
sudo systemctl enable --now docker

# Verify installation
docker --version
docker compose version  # Note: Docker CE uses "docker compose" (v2)
```

## 🍎 macOS

```bash
# Install Docker Desktop (includes Docker Compose)
# Download from: https://www.docker.com/products/docker-desktop/

# Or use Homebrew
brew install --cask docker

# Start Docker Desktop application
# Verify installation
docker --version
docker-compose --version
```

## 🪟 Windows (WSL2)

```bash
# Install Docker Desktop for Windows
# Download from: https://www.docker.com/products/docker-desktop/

# During installation, enable WSL2 integration
# Verify installation in WSL2 terminal
docker --version
docker-compose --version
```

## 🔍 Verify Installation

```bash
# Check Docker
docker --version
# Expected output: Docker version 20.x.x or later

# Check Docker Compose
docker-compose --version
# Expected output: docker-compose version 2.x.x

# Test Docker
docker run hello-world
# Expected output: "Hello from Docker!"

# Check running containers
docker ps
# Should show empty list or running containers
```

## 🐳 Troubleshooting

### "Permission denied" error

```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Log out and log back in, or run:
newgrp docker
```

### "docker-compose: command not found"

```bash
# Ubuntu/Debian
sudo apt-get install docker-compose

# Fedora (using Podman)
sudo dnf install podman-compose
alias docker-compose=podman-compose

# macOS
# Reinstall Docker Desktop
```

### Docker service not running

```bash
# Linux (systemd)
sudo systemctl start docker
sudo systemctl enable docker

# Check status
sudo systemctl status docker
```

### Port conflicts (5432, 58545, 3001)

```bash
# Check what's using the ports
sudo lsof -i :5432  # PostgreSQL
sudo lsof -i :58545 # Anvil RPC
sudo lsof -i :3001  # API Server

# Kill conflicting processes
sudo lsof -ti :PORT | xargs kill -9
```

## 📋 Quick Start After Installation

```bash
# 1. Clone repository
git clone <your-repo>
cd web3indexerDemo2602

# 2. Start services
docker-compose up -d

# 3. Verify services are running
docker-compose ps

# 4. Initialize database
npm run db:init

# 5. Start indexer + API
make dev-with-demo
```

## 🔗 Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Podman Documentation](https://docs.podman.io/)
