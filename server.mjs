import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";
import cors from "cors";
import envPaths from "env-paths";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
// Default port 8765, can be overridden with PORT environment variable
// Example: PORT=3000 npx yamcp-ui
const PORT = process.env.PORT || 8765;

// Import YAMCP modules from global package
// Helper function to safely import YAMCP modules
async function importYAMCP(modulePath) {
  try {
    return await import(`yamcp/${modulePath}`);
  } catch (error) {
    console.error(`Failed to load YAMCP module ${modulePath}:`, error.message);
    console.error(
      "Make sure yamcp is installed globally: npm install -g yamcp"
    );
    return null;
  }
}

// Load YAMCP modules (will be loaded asynchronously)
let config = null;
let loadProvidersMap = null;
let loadWorkspaceMap = null;
let addMcpProviders = null;
let removeMcpProvider = null;
let getMcpProviders = null;
let addWorkspace = null;
let removeWorkspace = null;
let getWorkspaces = null;

// Initialize YAMCP modules
async function initializeYAMCP() {
  const configModule = await importYAMCP("dist/config.js");
  if (configModule) config = configModule;

  const loaderModule = await importYAMCP("dist/store/loader.js");
  if (loaderModule) {
    loadProvidersMap = loaderModule.loadProvidersMap;
    loadWorkspaceMap = loaderModule.loadWorkspaceMap;
  }

  const providerModule = await importYAMCP("dist/store/provider.js");
  if (providerModule) {
    addMcpProviders = providerModule.addMcpProviders;
    removeMcpProvider = providerModule.removeMcpProvider;
    getMcpProviders = providerModule.getMcpProviders;
  }

  const workspaceModule = await importYAMCP("dist/store/workspace.js");
  if (workspaceModule) {
    addWorkspace = workspaceModule.addWorkspace;
    removeWorkspace = workspaceModule.removeWorkspace;
    getWorkspaces = workspaceModule.getWorkspaces;
  }
}

// Security: Only allow requests from the same origin (localhost)
app.use(
  cors({
    origin: [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`],
    credentials: true,
  })
);

// Additional security middleware
app.use((req, res, next) => {
  // Only allow API requests from the same host
  const host = req.get("host");
  const allowedHosts = [`localhost:${PORT}`, `127.0.0.1:${PORT}`];

  if (req.path.startsWith("/api/") && !allowedHosts.includes(host)) {
    return res
      .status(403)
      .json({ error: "Access denied: API only accessible from web interface" });
  }

  next();
});

// Serve static files from the React app build directory
app.use(express.static(path.join(__dirname, "dist")));

// Parse JSON bodies
app.use(express.json());

// Helper function to get config paths
function getConfigPaths() {
  if (!config) {
    // Fallback to envPaths if config module fails
    const paths = envPaths("yamcp");
    return {
      providersPath: path.join(paths.data, "providers.json"),
      workspacesPath: path.join(paths.data, "workspaces.json"),
      logDir: paths.log,
    };
  }
  return {
    providersPath: config.PROVIDERS_CONFIG_PATH,
    workspacesPath: config.WORKSPACES_CONFIG_PATH,
    logDir: config.LOG_DIR,
  };
}

// Helper function to safely load JSON file
function loadJSONFile(filePath, defaultValue = {}) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content);
    }
  } catch (error) {
    console.error(`Error loading ${filePath}:`, error.message);
  }
  return defaultValue;
}

// Helper function to get real providers data
function getRealProviders() {
  try {
    if (getMcpProviders) {
      return getMcpProviders();
    }
    // Fallback to direct file loading
    const { providersPath } = getConfigPaths();
    return loadJSONFile(providersPath, {});
  } catch (error) {
    console.error("Error getting providers:", error.message);
    return {};
  }
}

// Helper function to get real workspaces data
function getRealWorkspaces() {
  try {
    if (getWorkspaces) {
      return getWorkspaces();
    }
    // Fallback to direct file loading
    const { workspacesPath } = getConfigPaths();
    return loadJSONFile(workspacesPath, {});
  } catch (error) {
    console.error("Error getting workspaces:", error.message);
    return {};
  }
}

// Helper function to read log files
function getRecentLogs(limit = 50) {
  try {
    const { logDir } = getConfigPaths();
    const logs = [];

    if (!fs.existsSync(logDir)) {
      return [];
    }

    // Get all workspace directories
    const workspaceDirs = fs.readdirSync(logDir).filter((dir) => {
      const dirPath = path.join(logDir, dir);
      return fs.statSync(dirPath).isDirectory();
    });

    // Read logs from each workspace
    for (const workspaceDir of workspaceDirs) {
      const combinedLogPath = path.join(logDir, workspaceDir, "combined.log");

      if (fs.existsSync(combinedLogPath)) {
        try {
          const logContent = fs.readFileSync(combinedLogPath, "utf-8");
          const logLines = logContent
            .trim()
            .split("\n")
            .filter((line) => line.trim());

          // Parse each log line (Winston JSON format)
          for (const line of logLines.slice(-20)) {
            // Get last 20 from each file
            try {
              const logEntry = JSON.parse(line);
              logs.push({
                id: `${workspaceDir}_${logEntry.timestamp}`,
                timestamp: logEntry.timestamp,
                level: logEntry.level,
                server: workspaceDir.split("_")[0], // Extract workspace name
                message: logEntry.message || JSON.stringify(logEntry),
              });
            } catch (parseError) {
              // Skip invalid JSON lines
            }
          }
        } catch (fileError) {
          console.error(
            `Error reading log file ${combinedLogPath}:`,
            fileError.message
          );
        }
      }
    }

    // Sort by timestamp and limit
    return logs
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
  } catch (error) {
    console.error("Error getting logs:", error.message);
    return [];
  }
}

// API Routes
app.get("/api/stats", (req, res) => {
  try {
    const providers = getRealProviders();
    const workspaces = getRealWorkspaces();

    const totalServers = Object.keys(providers).length;
    const totalWorkspaces = Object.keys(workspaces).length;

    // For now, assume all servers are active (we'd need to track actual status)
    const activeServers = totalServers;
    const activeWorkspaces = totalWorkspaces;

    res.json({
      totalServers,
      activeServers,
      totalWorkspaces,
      activeWorkspaces,
      issues: 0, // Could be calculated based on failed scans or connection issues
    });
  } catch (error) {
    console.error("Error getting stats:", error.message);
    res.status(500).json({ error: "Failed to get stats" });
  }
});

app.get("/api/servers", (req, res) => {
  try {
    const providers = getRealProviders();

    const servers = Object.entries(providers).map(([key, provider]) => {
      const isStdio = provider.type === "stdio";

      return {
        id: key,
        name: key,
        namespace: provider.namespace || key,
        type: provider.type,
        ...(isStdio
          ? {
              command: provider.providerParameters.command,
              args: provider.providerParameters.args || [],
              env: provider.providerParameters.env || {},
            }
          : {
              url: provider.providerParameters.url,
            }),
      };
    });

    res.json(servers);
  } catch (error) {
    console.error("Error getting servers:", error.message);
    res.status(500).json({ error: "Failed to get servers" });
  }
});

app.get("/api/workspaces", (req, res) => {
  try {
    const workspaces = getRealWorkspaces();
    const providers = getRealProviders();

    const workspaceList = Object.entries(workspaces).map(
      ([name, serverNames]) => {
        // Validate that all servers in workspace exist
        const validServers = serverNames.filter(
          (serverName) => providers[serverName]
        );

        return {
          id: name,
          name: name,
          description: `Workspace with ${validServers.length} server${
            validServers.length === 1 ? "" : "s"
          }`,
          servers: validServers,
          status: "inactive", // Default status - would need actual tracking
        };
      }
    );

    res.json(workspaceList);
  } catch (error) {
    console.error("Error getting workspaces:", error.message);
    res.status(500).json({ error: "Failed to get workspaces" });
  }
});

app.get("/api/logs", (req, res) => {
  try {
    const logs = getRecentLogs(100);

    // Add some mock logs for testing if no real logs exist
    if (logs.length === 0) {
      const mockLogs = [
        {
          id: "mock_1",
          timestamp: new Date().toISOString(),
          level: "info",
          server: "vibe",
          message: "Server started successfully",
        },
        {
          id: "mock_2",
          timestamp: new Date(Date.now() - 60000).toISOString(),
          level: "error",
          server: "fetch-mcp",
          message: "Connection failed to external service",
        },
        {
          id: "mock_3",
          timestamp: new Date(Date.now() - 120000).toISOString(),
          level: "warn",
          server: "database",
          message: "High memory usage detected",
        },
      ];
      res.json(mockLogs);
    } else {
      res.json(logs);
    }
  } catch (error) {
    console.error("Error getting logs:", error.message);
    res.status(500).json({ error: "Failed to get logs" });
  }
});

// Server actions
app.post("/api/servers/:id/start", (req, res) => {
  const { id } = req.params;
  // TODO: Implement actual server starting logic
  // This would involve spawning the server process and tracking its status
  res.json({
    success: true,
    message: `Server ${id} start requested (not implemented yet)`,
  });
});

app.post("/api/servers/:id/stop", (req, res) => {
  const { id } = req.params;
  // TODO: Implement actual server stopping logic
  // This would involve killing the server process
  res.json({
    success: true,
    message: `Server ${id} stop requested (not implemented yet)`,
  });
});

app.delete("/api/servers/:id", (req, res) => {
  const { id } = req.params;
  try {
    if (removeMcpProvider) {
      removeMcpProvider(id);
      res.json({ success: true, message: `Server ${id} deleted successfully` });
    } else {
      // Fallback to direct file manipulation
      const { providersPath } = getConfigPaths();
      const providers = loadJSONFile(providersPath, {});
      delete providers[id];
      fs.writeFileSync(providersPath, JSON.stringify(providers, null, 2));
      res.json({ success: true, message: `Server ${id} deleted successfully` });
    }
  } catch (error) {
    console.error(`Error deleting server ${id}:`, error.message);
    res.status(500).json({ error: `Failed to delete server ${id}` });
  }
});

// Add new server
app.post("/api/servers", (req, res) => {
  const { name, type, command, args, env, url } = req.body;

  try {
    const newProvider = {
      namespace: name,
      type: type,
      providerParameters:
        type === "stdio"
          ? {
              command,
              args: args || [],
              env: env || {},
            }
          : {
              url,
            },
    };

    if (addMcpProviders) {
      addMcpProviders([newProvider]);
    } else {
      // Fallback to direct file manipulation
      const { providersPath } = getConfigPaths();
      const providers = loadJSONFile(providersPath, {});
      providers[name] = newProvider;
      fs.writeFileSync(providersPath, JSON.stringify(providers, null, 2));
    }

    res.json({ success: true, message: `Server ${name} added successfully` });
  } catch (error) {
    console.error(`Error adding server ${name}:`, error.message);
    res.status(500).json({ error: `Failed to add server ${name}` });
  }
});

// Update server
app.put("/api/servers/:id", (req, res) => {
  const { id } = req.params;
  const { name, namespace, type, command, args, env, url } = req.body;

  try {
    const { providersPath } = getConfigPaths();
    const providers = loadJSONFile(providersPath, {});

    // Check if server exists
    if (!providers[id]) {
      return res.status(404).json({ error: `Server ${id} not found` });
    }

    // If namespace changed, we need to handle the key change
    const newNamespace = namespace || name; // Use namespace if provided, fallback to name
    if (newNamespace !== id) {
      // Remove old entry
      delete providers[id];
    }

    // Create updated provider
    const updatedProvider = {
      namespace: newNamespace,
      type: type,
      providerParameters:
        type === "stdio"
          ? {
              command,
              args: args || [],
              env: env || {},
            }
          : {
              url,
            },
    };

    // Add updated provider
    providers[newNamespace] = updatedProvider;

    // If namespace changed, update workspaces that reference this server
    if (newNamespace !== id) {
      const { workspacesPath } = getConfigPaths();
      const workspaces = loadJSONFile(workspacesPath, {});

      for (const [workspaceName, serverList] of Object.entries(workspaces)) {
        const serverIndex = serverList.indexOf(id);
        if (serverIndex !== -1) {
          serverList[serverIndex] = newNamespace;
        }
      }

      fs.writeFileSync(workspacesPath, JSON.stringify(workspaces, null, 2));
    }

    // Save providers
    fs.writeFileSync(providersPath, JSON.stringify(providers, null, 2));

    res.json({
      success: true,
      message: `Server ${newNamespace} updated successfully`,
    });
  } catch (error) {
    console.error(`Error updating server ${id}:`, error.message);
    res.status(500).json({ error: `Failed to update server ${id}` });
  }
});

// Workspace actions
app.post("/api/workspaces/:id/start", (req, res) => {
  const { id } = req.params;
  // TODO: Implement actual workspace starting logic
  // This would involve starting all servers in the workspace
  res.json({
    success: true,
    message: `Workspace ${id} start requested (not implemented yet)`,
  });
});

app.post("/api/workspaces/:id/stop", (req, res) => {
  const { id } = req.params;
  // TODO: Implement actual workspace stopping logic
  // This would involve stopping all servers in the workspace
  res.json({
    success: true,
    message: `Workspace ${id} stop requested (not implemented yet)`,
  });
});

app.delete("/api/workspaces/:id", (req, res) => {
  const { id } = req.params;
  try {
    if (removeWorkspace) {
      removeWorkspace(id);
      res.json({
        success: true,
        message: `Workspace ${id} deleted successfully`,
      });
    } else {
      // Fallback to direct file manipulation
      const { workspacesPath } = getConfigPaths();
      const workspaces = loadJSONFile(workspacesPath, {});
      delete workspaces[id];
      fs.writeFileSync(workspacesPath, JSON.stringify(workspaces, null, 2));
      res.json({
        success: true,
        message: `Workspace ${id} deleted successfully`,
      });
    }
  } catch (error) {
    console.error(`Error deleting workspace ${id}:`, error.message);
    res.status(500).json({ error: `Failed to delete workspace ${id}` });
  }
});

// Add new workspace
app.post("/api/workspaces", (req, res) => {
  const { name, servers } = req.body;

  try {
    if (addWorkspace) {
      addWorkspace(name, servers);
    } else {
      // Fallback to direct file manipulation
      const { workspacesPath } = getConfigPaths();
      const workspaces = loadJSONFile(workspacesPath, {});
      workspaces[name] = servers;
      fs.writeFileSync(workspacesPath, JSON.stringify(workspaces, null, 2));
    }

    res.json({
      success: true,
      message: `Workspace ${name} created successfully`,
    });
  } catch (error) {
    console.error(`Error creating workspace ${name}:`, error.message);
    res.status(500).json({ error: `Failed to create workspace ${name}` });
  }
});

// Update workspace
app.put("/api/workspaces/:id", (req, res) => {
  const { id } = req.params;
  const { name, servers } = req.body;

  try {
    const { workspacesPath } = getConfigPaths();
    const workspaces = loadJSONFile(workspacesPath, {});

    // Check if workspace exists
    if (!workspaces[id]) {
      return res.status(404).json({ error: `Workspace ${id} not found` });
    }

    // If name changed, we need to handle the key change
    const newName = name || id; // Use name if provided, fallback to id
    if (newName !== id) {
      // Remove old entry
      delete workspaces[id];
    }

    // Add updated workspace
    workspaces[newName] = servers;

    // Save workspaces
    fs.writeFileSync(workspacesPath, JSON.stringify(workspaces, null, 2));

    res.json({
      success: true,
      message: `Workspace ${newName} updated successfully`,
    });
  } catch (error) {
    console.error(`Error updating workspace ${id}:`, error.message);
    res.status(500).json({ error: `Failed to update workspace ${id}` });
  }
});

// Get log files list
app.get("/api/log-files", (req, res) => {
  try {
    const { logDir } = getConfigPaths();
    const logFiles = [];

    if (!fs.existsSync(logDir)) {
      return res.json([]);
    }

    // Get all workspace directories
    const workspaceDirs = fs.readdirSync(logDir).filter((dir) => {
      const dirPath = path.join(logDir, dir);
      return fs.statSync(dirPath).isDirectory();
    });

    // Get log files from each workspace
    for (const workspaceDir of workspaceDirs) {
      const workspacePath = path.join(logDir, workspaceDir);
      const files = fs
        .readdirSync(workspacePath)
        .filter((file) => file.endsWith(".log"));

      for (const file of files) {
        const filePath = path.join(workspacePath, file);
        const stats = fs.statSync(filePath);

        logFiles.push({
          name: `${workspaceDir}/${file}`,
          size: stats.size,
          modified: stats.mtime.toISOString(),
          path: filePath,
        });
      }
    }

    res.json(logFiles);
  } catch (error) {
    console.error("Error getting log files:", error.message);
    res.status(500).json({ error: "Failed to get log files" });
  }
});

// Download log file
app.get("/api/log-files/:workspace/:filename", (req, res) => {
  const { workspace, filename } = req.params;

  try {
    const { logDir } = getConfigPaths();
    const filePath = path.join(logDir, workspace, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Log file not found" });
    }

    res.download(filePath);
  } catch (error) {
    console.error("Error downloading log file:", error.message);
    res.status(500).json({ error: "Failed to download log file" });
  }
});

// Get raw JSON content for editing
app.get("/api/config/providers", (req, res) => {
  try {
    const providers = getRealProviders();
    res.json(providers);
  } catch (error) {
    console.error("Error getting providers config:", error.message);
    res.status(500).json({ error: "Failed to get providers config" });
  }
});

app.get("/api/config/workspaces", (req, res) => {
  try {
    const workspaces = getRealWorkspaces();
    res.json(workspaces);
  } catch (error) {
    console.error("Error getting workspaces config:", error.message);
    res.status(500).json({ error: "Failed to get workspaces config" });
  }
});

// Update JSON config files
app.put("/api/config/providers", (req, res) => {
  try {
    const { providersPath } = getConfigPaths();
    const newConfig = req.body;

    // Validate that it's a valid object
    if (typeof newConfig !== "object" || newConfig === null) {
      return res.status(400).json({ error: "Invalid JSON: must be an object" });
    }

    // Write to file
    fs.writeFileSync(providersPath, JSON.stringify(newConfig, null, 2));

    res.json({
      success: true,
      message: "Providers config updated successfully",
    });
  } catch (error) {
    console.error("Error updating providers config:", error.message);
    res.status(500).json({ error: "Failed to update providers config" });
  }
});

app.put("/api/config/workspaces", (req, res) => {
  try {
    const { workspacesPath } = getConfigPaths();
    const newConfig = req.body;

    // Validate that it's a valid object
    if (typeof newConfig !== "object" || newConfig === null) {
      return res.status(400).json({ error: "Invalid JSON: must be an object" });
    }

    // Write to file
    fs.writeFileSync(workspacesPath, JSON.stringify(newConfig, null, 2));

    res.json({
      success: true,
      message: "Workspaces config updated successfully",
    });
  } catch (error) {
    console.error("Error updating workspaces config:", error.message);
    res.status(500).json({ error: "Failed to update workspaces config" });
  }
});

// Catch all handler: send back React's index.html file for SPA routing
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

// Initialize and start server
async function startServer() {
  // Initialize YAMCP modules
  await initializeYAMCP();

  // Try to start server with error handling
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log("🔒 API access restricted to web interface only");
  });

  // Handle port in use error
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`\n❌ Port ${PORT} is already in use!`);
      console.error(`\n💡 Suggestions:`);
      console.error(`   1. Stop any other yamcp-ui instances running`);
      console.error(
        `   2. Try a different port by setting PORT environment variable:`
      );
      console.error(`      PORT=8766 npx yamcp-ui`);
      console.error(`      PORT=3000 npx yamcp-ui`);
      console.error(`      PORT=4000 npx yamcp-ui`);
      console.error(`\n   3. Check what's using port ${PORT}:`);
      console.error(`      lsof -ti:${PORT}`);
      console.error(`\n   4. Kill the process using the port:`);
      console.error(`      kill $(lsof -ti:${PORT})`);
      console.error(
        `\n🔍 Common causes: Another yamcp-ui instance, development server, or other web application\n`
      );
      process.exit(1);
    } else {
      console.error("Failed to start server:", error);
      process.exit(1);
    }
  });

  return server;
}

// Start the server
startServer().then(server => {
  const connections = new Set();
  server.on('connection', (connection) => {
    connections.add(connection);
    connection.on('close', () => {
      connections.delete(connection);
    });
  });

  const gracefulShutdown = (signal) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    
    server.close(() => {
      console.log('Server closed.');
      process.exit(0);
    });

    // Force close connections
    for (const connection of connections) {
        connection.destroy();
    }
    
    // If it doesn't exit in 5 seconds, force it.
    setTimeout(() => {
        console.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 5000).unref();
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}).catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
