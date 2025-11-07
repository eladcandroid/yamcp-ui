# YAMCP UI Dashboard

A beautiful web-based dashboard for [YAMCP (Yet Another MCP)](https://github.com/hamidra/yamcp) - A Model Context Protocol workspace manager.

## Overview

YAMCP UI provides an intuitive web interface to manage your MCP servers, workspaces, and configurations. Built as a standalone npm package that integrates seamlessly with YAMCP.

## Demo

![YAMCP UI Demo](assets/demo/yamcp-ui-demo.gif)

## Features

- 🎛️ **Server Management**: Add, edit, and delete MCP servers
- 📁 **Workspace Management**: Create and manage workspaces with MCP configurations
- 📊 **Real-time Dashboard**: View statistics and system status
- 📝 **Log Viewing**: Monitor server logs and download log files
- 🎨 **Modern UI**: Beautiful interface with dark/light mode support
- 🔒 **Secure**: Localhost-only access with CORS protection

## Installation & Usage

```bash
# Run directly with npx (recommended)
npx yamcp-ui

# Or install globally
npm install -g yamcp-ui
yamcp-ui
```

The dashboard will be available at `http://localhost:8765`

## Running with Containers (Docker/Podman)

For a consistent and isolated environment, you can run YAMCP UI inside a container. This project includes a multi-stage `Dockerfile` and a build script to automate the process.

### Prerequisites

- A container engine like [Docker](https://www.docker.com/) or [Podman](https://podman.io/).

### Building the Container

A helper script is provided to build the container image. It automatically extracts metadata from `package.json` to create OCI-compliant labels.

```bash
# Build the production image
./scripts/container.sh build
```
This will create two tags: `yamcp-ui:latest` and `yamcp-ui:<version>`.

### Running the Container

#### Production Mode

To run the optimized production container, you need to mount the YAMCP configuration and data directories from your host machine into the container. This ensures that your settings are persisted.

```bash
podman run -it --rm \
  -p 8765:8765 \
  -v "${XDG_CONFIG_HOME:-$HOME/.config}/yamcp:/home/nonroot/.config/yamcp" \
  -v "${XDG_DATA_HOME:-$HOME/.local/share}/yamcp:/home/nonroot/.local/share/yamcp" \
  yamcp-ui:latest
```
*Note: If you are using Docker, replace `podman` with `docker`.*

#### Development Mode

A development image is also available, which supports hot-reloading.

```bash
# 1. Build the development image
podman build -t yamcp-ui:dev --target dev .

# 2. Run the development container
podman run -it --rm \
  -p 8765:8765 \
  -v ./src:/app/src \
  yamcp-ui:dev
```

The dashboard will be available at `http://localhost:8765`.

## Prerequisites

- Node.js 18.0.0 or higher
- YAMCP package (will be automatically installed if missing)

## Automatic YAMCP Installation

If YAMCP is not installed, yamcp-ui will offer to install it automatically:

```
⚠️  yamcp is not installed globally.

Would you like me to install yamcp for you? (Y/n): 
```

Simply press Enter or type 'y' to install the latest version of YAMCP.

## Development

```bash
# Clone the repository
git clone https://github.com/eladcandroid/yamcp-ui.git
cd yamcp-ui

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Technology Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS
- **UI Components**: Radix UI, Lucide React
- **Backend**: Express.js
- **Build Tool**: Vite
- **Charts**: Recharts

## Credits

### Created by
**Elad Cohen**  
LinkedIn: [https://www.linkedin.com/in/eladgocode/](https://www.linkedin.com/in/eladgocode/)

### Built on YAMCP by
**Hamid Alipour**  
GitHub: [https://github.com/hamidra](https://github.com/hamidra)  
YAMCP Repository: [https://github.com/hamidra/yamcp](https://github.com/hamidra/yamcp)

## License

MIT License - see LICENSE file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

If you encounter any issues, please file them in the [GitHub Issues](https://github.com/eladcandroid/yamcp-ui/issues) section.
