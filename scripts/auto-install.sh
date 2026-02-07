#!/bin/bash

##############################################################################
# Web3 Indexer Demo - Auto Installation Script
#
# This script automatically detects your Linux distribution and installs
# Docker, Docker Compose, and other dependencies.
#
# Supported: Ubuntu, Debian, Fedora, CentOS, RHEL
##############################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
print_header() {
    echo -e "\n${BLUE}======================================================================${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}======================================================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Detect Linux distribution
detect_distro() {
    print_header "Detecting Linux Distribution"

    if [ -f /etc/os-release ]; then
        . /etc/os-release
        DISTRO=$ID
        VERSION=$VERSION_ID
        print_success "Detected: $PRETTY_NAME"
    else
        print_error "Cannot detect Linux distribution"
        exit 1
    fi
}

# Check if running as root
check_root() {
    if [ "$EUID" -eq 0 ]; then
        print_warning "Running as root. This is not recommended."
        read -p "Continue anyway? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
        SUDO=""
    else
        SUDO="sudo"
    fi
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Install Docker and Docker Compose on Ubuntu/Debian
install_docker_ubuntu() {
    print_header "Installing Docker on Ubuntu/Debian"

    # Update package index
    print_info "Updating package index..."
    $SUDO apt-get update

    # Install prerequisites
    print_info "Installing prerequisites..."
    $SUDO apt-get install -y \
        ca-certificates \
        curl \
        gnupg \
        lsb-release

    # Add Docker's official GPG key
    print_info "Adding Docker GPG key..."
    $SUDO mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/$DISTRO/gpg | $SUDO gpg --dearmor -o /etc/apt/keyrings/docker.gpg

    # Set up repository
    print_info "Adding Docker repository..."
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$DISTRO \
      $(lsb_release -cs) stable" | $SUDO tee /etc/apt/sources.list.d/docker.list > /dev/null

    # Install Docker Engine
    print_info "Installing Docker Engine..."
    $SUDO apt-get update
    $SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

    # Install docker-compose (standalone) for compatibility
    if ! command_exists docker-compose; then
        print_info "Installing docker-compose standalone..."
        $SUDO apt-get install -y docker-compose
    fi

    print_success "Docker installed successfully"
}

# Install Docker and Docker Compose on Fedora
install_docker_fedora() {
    print_header "Installing Docker on Fedora"

    # Remove conflicting packages
    print_info "Removing conflicting packages..."
    $SUDO dnf remove -y docker docker-client docker-client-latest docker-common \
        docker-latest docker-latest-logrotate docker-logrotate docker-engine \
        podman podman-compose 2>/dev/null || true

    # Add Docker repository (compatible with DNF 5)
    print_info "Adding Docker repository..."
    # Try dnf5 config-manager syntax first
    if $SUDO dnf config-manager addrepo --from-repofile=https://download.docker.com/linux/fedora/docker-ce.repo 2>/dev/null; then
        print_success "Added repository using DNF5 syntax"
    elif $SUDO dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo 2>/dev/null; then
        print_success "Added repository using legacy syntax"
    else
        print_info "Falling back to manual repository creation..."
        $SUDO tee /etc/yum.repos.d/docker-ce.repo >/dev/null <<EOF
[docker-ce-stable]
name=Docker CE Stable - \$basearch
baseurl=https://download.docker.com/linux/fedora/\$releasever/stable/\$basearch
enabled=1
gpgcheck=1
gpgkey=https://download.docker.com/linux/fedora/gpg
EOF
    fi

    # Install Docker CE
    print_info "Installing Docker CE..."
    $SUDO dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

    # Install docker-compose standalone for compatibility
    if ! command_exists docker-compose; then
        print_info "Installing docker-compose standalone..."
        $SUDO dnf install -y docker-compose
    fi

    print_success "Docker installed successfully"

    # Note: On Fedora, use "docker compose" (v2) instead of "docker-compose"
    print_info "Note: On Fedora, use 'docker compose' (v2) instead of 'docker-compose'"
}

# Install Docker and Docker Compose on CentOS/RHEL
install_docker_centos() {
    print_header "Installing Docker on CentOS/RHEL"

    # Remove conflicting packages
    print_info "Removing conflicting packages..."
    $SUDO yum remove -y docker docker-client docker-client-latest docker-common \
        docker-latest docker-latest-logrotate docker-logrotate docker-engine podman 2>/dev/null || true

    # Add Docker repository
    print_info "Adding Docker repository..."
    $SUDO yum install -y yum-utils
    $SUDO yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo

    # Install Docker CE
    print_info "Installing Docker CE..."
    $SUDO yum install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

    print_success "Docker installed successfully"
}

# Install Node.js and npm
install_nodejs() {
    print_header "Installing Node.js and npm"

    if command_exists node && command_exists npm; then
        print_success "Node.js $(node --version) and npm $(npm --version) already installed"
        return
    fi

    case $DISTRO in
        ubuntu|debian)
            print_info "Installing Node.js via NodeSource..."
            curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash -
            $SUDO apt-get install -y nodejs
            ;;
        fedora)
            print_info "Installing Node.js via dnf..."
            $SUDO dnf install -y nodejs npm
            ;;
        centos|rhel)
            print_info "Installing Node.js via NodeSource..."
            curl -fsSL https://rpm.nodesource.com/setup_20.x | $SUDO bash -
            $SUDO yum install -y nodejs npm
            ;;
        *)
            print_warning "Please install Node.js manually from https://nodejs.org/"
            ;;
    esac

    print_success "Node.js $(node --version) and npm $(npm --version) installed"
}

# Start and enable Docker service
start_docker() {
    print_header "Starting Docker Service"

    if systemctl is-active --quiet docker; then
        print_success "Docker service is already running"
    else
        print_info "Starting Docker service..."
        $SUDO systemctl start docker
        $SUDO systemctl enable docker
        print_success "Docker service started and enabled"
    fi
}

# Add user to docker group
add_user_to_docker_group() {
    print_header "Adding User to Docker Group"

    if [ "$EUID" -eq 0 ]; then
        print_warning "Running as root, skipping user group configuration"
        return
    fi

    if groups $USER | grep -q '\bdocker\b'; then
        print_success "User $USER is already in docker group"
    else
        print_info "Adding user $USER to docker group..."
        $SUDO usermod -aG docker $USER
        print_success "User added to docker group"
        print_warning "You need to log out and log back in for this to take effect"
        print_info "Or run: newgrp docker"
    fi
}

# Verify installation
verify_installation() {
    print_header "Verifying Installation"

    # Check Docker
    if command_exists docker; then
        print_success "Docker: $(docker --version)"
    else
        print_error "Docker not found"
        return 1
    fi

    # Check docker-compose
    if command_exists docker-compose; then
        print_success "docker-compose: $(docker-compose --version)"
    elif docker compose version >/dev/null 2>&1; then
        print_success "docker compose (v2): $(docker compose version)"
    else
        print_error "docker-compose not found"
        return 1
    fi

    # Check Node.js
    if command_exists node; then
        print_success "Node.js: $(node --version)"
    else
        print_error "Node.js not found"
        return 1
    fi

    # Check npm
    if command_exists npm; then
        print_success "npm: $(npm --version)"
    else
        print_error "npm not found"
        return 1
    fi

    # Test Docker
    print_info "Testing Docker with hello-world..."
    if $SUDO docker run --rm hello-world >/dev/null 2>&1; then
        print_success "Docker test successful"
    else
        print_error "Docker test failed"
        return 1
    fi
}

# Main installation flow
main() {
    print_header "Web3 Indexer Demo - Auto Installation"

    # Check root
    check_root

    # Detect distribution
    detect_distro

    # Install Docker based on distribution
    case $DISTRO in
        ubuntu|debian)
            install_docker_ubuntu
            ;;
        fedora)
            install_docker_fedora
            ;;
        centos|rhel)
            install_docker_centos
            ;;
        *)
            print_error "Unsupported distribution: $DISTRO"
            print_info "Please install Docker manually from https://docs.docker.com/"
            exit 1
            ;;
    esac

    # Install Node.js
    install_nodejs

    # Start Docker
    start_docker

    # Add user to docker group
    add_user_to_docker_group

    # Verify installation
    verify_installation

    # Next steps
    print_header "Installation Complete!"

    echo -e "${GREEN}✅ All dependencies installed successfully!${NC}\n"

    echo -e "${BLUE}Next steps:${NC}"
    echo "  1. Log out and log back in (if user was added to docker group)"
    echo "  2. Navigate to project directory: cd web3indexerDemo2602"
    echo "  3. Copy environment file: cp .env.example .env"
    echo "  4. Start services: docker-compose up -d"
    echo "  5. Initialize database: npm run db:init"
    echo "  6. Start indexer + API: make dev-with-demo"
    echo ""
    echo -e "${YELLOW}Note: If you just added your user to the docker group,${NC}"
    echo -e "${YELLOW}you need to log out and log back in for the changes to take effect.${NC}"
    echo ""
    echo -e "${BLUE}For more information, see:${NC}"
    echo "  • QUICKSTART.md - Quick start guide"
    echo "  • INSTALL.md   - Detailed installation instructions"
}

# Run main function
main
