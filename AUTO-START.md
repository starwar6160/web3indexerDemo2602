# 🚀 Zero-Touch Setup Guide

## One-Command Setup (Auto-Install Dependencies)

This guide shows you how to set up the entire Web3 Indexer Demo with a single command on Linux systems (Ubuntu, Fedora, CentOS).

### Quick Start (3 Commands)

```bash
# 1. Clone repository
git clone https://github.com/starwar6160/web3indexerDemo2602.git
cd web3indexerDemo2602

# 2. Auto-install all dependencies (Docker, Node.js, etc.)
make install-deps

# 3. Start everything (deploy demo contract + start indexer + API)
make dev-with-demo
```

That's it! 🎉 Your dashboard will be at: **http://localhost:3001/dashboard**

---

## What Does `make install-deps` Do?

The automated installation script:

✅ **Detects your Linux distribution** (Ubuntu, Fedora, CentOS, RHEL)
✅ **Installs Docker CE** (latest version)
✅ **Installs Docker Compose** (both v1 and v2)
✅ **Installs Node.js 20.x** and npm
✅ **Starts Docker service**
✅ **Adds your user to docker group** (no more sudo!)
✅ **Verifies installation** with test run

### Supported Distributions

| Distribution | Version | Status |
|--------------|---------|--------|
| Ubuntu | 18.04, 20.04, 22.04, 24.04 | ✅ Fully Supported |
| Debian | 10, 11, 12 | ✅ Fully Supported |
| Fedora | 38, 39, 40, 41 | ✅ Fully Supported |
| CentOS | 7, 8, 9 | ✅ Fully Supported |
| RHEL | 8, 9 | ✅ Fully Supported |

---

## Detailed Steps

### Step 1: Clone Repository

```bash
git clone https://github.com/starwar6160/web3indexerDemo2602.git
cd web3indexerDemo2602
```

### Step 2: Run Auto-Install Script

```bash
make install-deps
```

**What happens:**
1. Script detects your Linux distribution
2. Prompts for sudo password (required for system packages)
3. Downloads and installs Docker CE
4. Downloads and installs Node.js 20.x
5. Configures Docker service
6. Adds your user to `docker` group
7. Tests installation with `hello-world` container

**Expected output:**
```
======================================================================
  Web3 Indexer Demo - Auto Installation
======================================================================

✅ Detected: Ubuntu 24.04 LTS
...
✅ Docker installed successfully
✅ Node.js 20.x.x and npm 10.x.x installed
✅ Docker service started and enabled
✅ User added to docker group
✅ Docker test successful

Next steps:
  1. Log out and log back in (if user was added to docker group)
  ...
```

### Step 3: Log Out and Log Back In

**Important**: If you were added to the `docker` group, you need to log out and log back in for the group membership to take effect.

```bash
# Option 1: Log out and log back in completely
# Option 2: Use newgrp to refresh group membership
newgrp docker
```

### Step 4: Start Everything

```bash
make dev-with-demo
```

This command:
1. ✅ Starts PostgreSQL and Anvil (in Docker)
2. ✅ Deploys SimpleBank ERC20 contract
3. ✅ Generates 12 demo transfers
4. ✅ Starts indexer (syncing blocks)
5. ✅ Starts API server (port 3001)

---

## Manual Verification

If you want to verify each component:

```bash
# Check Docker
docker --version
# Expected: Docker version 29.x.x or later

# Check Docker Compose
docker-compose --version
# Expected: docker-compose version 2.x.x

# Check Node.js
node --version
# Expected: v20.x.x or later

# Check npm
npm --version
# Expected: 10.x.x or later

# Test Docker
docker run --rm hello-world
# Expected: "Hello from Docker!"
```

---

## Troubleshooting

### "Permission denied" Error

**Problem**: Docker commands require `sudo`

**Solution**:
```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Log out and log back in
# Or use newgrp
newgrp docker
```

### "docker-compose: command not found"

**Problem**: Docker Compose not installed

**Solution**:
```bash
# Re-run auto-install script
make install-deps
```

### "Cannot connect to Docker daemon"

**Problem**: Docker service not running

**Solution**:
```bash
# Start Docker service
sudo systemctl start docker
sudo systemctl enable docker

# Check status
sudo systemctl status docker
```

### Port Already in Use (5432, 58545, 3001)

**Problem**: Another process is using the port

**Solution**:
```bash
# Kill conflicting processes
make kill

# Or manually
sudo lsof -ti :5432 | xargs kill -9
sudo lsof -ti :58545 | xargs kill -9
sudo lsof -ti :3001 | xargs kill -9
```

---

## Advanced Usage

### Install System Dependencies Only

```bash
make install-deps    # Install Docker, Node.js, etc.
```

### Install Node.js Dependencies Only

```bash
make install         # Install npm packages
```

### Full Setup (System + Node.js)

```bash
make install-deps    # System dependencies
make install         # Node.js dependencies
```

---

## Fedora Users

Fedora uses **Podman** by default. The auto-install script will:

1. Remove Podman and related packages
2. Install Docker CE from official repository
3. Configure Docker service

**Alternative**: If you prefer to use Podman, see [INSTALL.md](INSTALL.md) for Podman-specific instructions.

---

## What Gets Installed?

### System Packages
- **Docker CE**: Latest version (29.x.x)
- **Docker Compose**: v2 (via plugin) + v1 (standalone)
- **Node.js**: Version 20.x.x (LTS)
- **npm**: Version 10.x.x

### Configuration
- Docker service enabled and started
- User added to `docker` group
- Firewall rules (if needed)

### Verification
- Docker test run with `hello-world` container
- All commands verified and version-checked

---

## Next Steps

After installation:

1. **Check Dashboard**: http://localhost:3001/dashboard
2. **Read QUICKSTART.md**: Quick reference guide
3. **Read README.md**: Detailed architecture documentation
4. **Run Chaos Tests**: `make chaos` (test system resilience)

---

## System Requirements

### Minimum Requirements
- **OS**: Linux (Ubuntu 18.04+, Fedora 38+, Debian 10+, CentOS 7+)
- **RAM**: 2 GB (4 GB recommended)
- **Disk**: 10 GB free space
- **Internet**: Required for downloading packages

### Recommended Requirements
- **OS**: Ubuntu 22.04 LTS or Fedora 40
- **RAM**: 4 GB or more
- **Disk**: 20 GB SSD
- **CPU**: 2+ cores

---

## Security Notes

- The script requires `sudo` privileges to install system packages
- Docker daemon runs as root (standard configuration)
- Your user is added to the `docker` group (allows running docker without sudo)
- All packages are downloaded from official repositories

---

## Uninstallation

To remove everything:

```bash
# Stop all services
make down

# Remove Docker (Ubuntu/Debian)
sudo apt-get purge docker-ce docker-ce-cli containerd.io
sudo apt-get autoremove

# Remove Docker (Fedora)
sudo dnf remove docker-ce docker-ce-cli containerd.io

# Remove Node.js
sudo apt-get remove nodejs npm  # Ubuntu/Debian
sudo dnf remove nodejs npm      # Fedora

# Remove project directory
cd ..
rm -rf web3indexerDemo2602
```

---

## Support

For issues or questions:
- Check [INSTALL.md](INSTALL.md) for detailed installation guide
- Check [QUICKSTART.md](QUICKSTART.md) for quick reference
- Open an issue on GitHub: https://github.com/starwar6160/web3indexerDemo2602/issues

---

**Happy Indexing! 🚀**
