(function() {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.components = window._nekoModules.components || {};

  function tokenize(input) {
    const tokens = [];
    const source = String(input || '').trim();
    let current = '';
    let quote = '';
    let escaping = false;

    for (const ch of source) {
      if (escaping) {
        current += ch;
        escaping = false;
        continue;
      }
      if (ch === '\\') {
        escaping = true;
        continue;
      }
      if (quote) {
        if (ch === quote) quote = '';
        else current += ch;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (/\s/.test(ch)) {
        if (current) {
          tokens.push(current);
          current = '';
        }
        continue;
      }
      current += ch;
    }
    if (current) tokens.push(current);
    return tokens;
  }

  function toCommandKey(tokens) {
    if (!tokens.length) return '';
    const head = tokens[0].toLowerCase();
    const second = tokens[1]?.toLowerCase();
    if (['service', 'cache', 'config', 'update'].includes(head) && second) {
      return `${head}:${second}`;
    }
    return head;
  }

  function normalizeResult(result) {
    if (result && typeof result === 'object' && result.ok === true && 'data' in result) return result.data;
    return result;
  }

  function stringify(value) {
    if (typeof value === 'string') return value;
    return JSON.stringify(value ?? {}, null, 2);
  }

  function createCommandRegistry(deps = {}) {
    const {
      addLogLine = () => {},
      clearOutput = () => {},
      ipc = {},
      helpers = {},
    } = deps;

    const commands = new Map();
    const aliases = new Map();

    function register(command) {
      commands.set(command.name, command);
      (command.aliases || []).forEach((alias) => aliases.set(alias, command.name));
      return command;
    }

    function resolve(rawKey) {
      const key = aliases.get(rawKey) || rawKey;
      return commands.get(key) || null;
    }

    function listCommands() {
      return Array.from(commands.values())
        .filter((command) => !command.hidden)
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    function logHelp(topic) {
      if (topic) {
        const command = resolve(topic);
        if (!command) {
          addLogLine('WARN', `Unknown help topic: ${topic}`);
          return;
        }
        addLogLine('INFO', `${command.usage || command.name} - ${command.description}`);
        if (command.aliases?.length) addLogLine('INFO', `aliases: ${command.aliases.join(', ')}`);
        return;
      }

      addLogLine('INFO', 'Available commands:');
      listCommands().forEach((command) => {
        addLogLine('INFO', `${command.usage || command.name} - ${command.description}`);
      });
      addLogLine('INFO', 'Use help <command> for details. Quoted arguments are supported.');
    }

    function requireMethod(methodName) {
      if (typeof ipc[methodName] !== 'function') {
        throw new Error(`IPC method missing: ${methodName}`);
      }
      return ipc[methodName].bind(ipc);
    }

    register({
      name: 'help',
      aliases: ['?'],
      usage: 'help [command]',
      description: 'show command list or one command detail',
      run: async ({ args }) => logHelp(args[0]),
    });

    register({
      name: 'clear',
      aliases: ['cls'],
      description: 'clear console output',
      run: async () => clearOutput(),
    });

    register({
      name: 'version',
      aliases: ['ver'],
      description: 'print application version',
      run: async () => {
        const version = await requireMethod('getVersion')();
        addLogLine('INFO', `Neko Status v${version}`);
      },
    });

    register({
      name: 'status',
      description: 'refresh runtime, service, cache and metrics status cards',
      run: async () => {
        await helpers.refreshConsoleStatus?.();
        addLogLine('INFO', helpers.getStatusSummary?.() || 'status refreshed');
      },
    });

    register({
      name: 'health',
      description: 'run service and environment health checks',
      run: async () => {
        const items = normalizeResult(await requireMethod('runHealthCheck')()) || [];
        items.forEach((item) => addLogLine(item.ok ? 'INFO' : 'WARN', `[health] ${item.name}: ${item.text}`));
      },
    });

    register({
      name: 'metrics',
      aliases: ['metric'],
      description: 'print current CPU and memory metrics',
      run: async () => {
        const metrics = normalizeResult(await requireMethod('getMetrics')());
        helpers.setLastMetricsSnapshot?.(metrics);
        helpers.updateConsoleMetricsStatus?.(metrics);
        addLogLine('INFO', helpers.formatMetrics?.(metrics) || stringify(metrics));
      },
    });

    register({
      name: 'cache',
      usage: 'cache',
      description: 'print local cache size',
      run: async () => {
        const size = normalizeResult(await requireMethod('getCacheSize')());
        helpers.setConsoleStatus?.('Cache', helpers.formatBytes?.(size) || `${size} B`, 'Local cache', Number(size) > 0 ? 'warn' : 'ok');
        addLogLine('INFO', `cache=${helpers.formatBytes?.(size) || size}`);
      },
    });

    register({
      name: 'cache:clear',
      aliases: ['clear-cache'],
      usage: 'cache clear',
      description: 'clear local cache through the main process',
      run: async () => {
        const result = normalizeResult(await requireMethod('clearCache')());
        if (result?.success === false || result?.ok === false) {
          addLogLine('ERROR', `cache clear failed: ${result.error || result.message || 'unknown error'}`);
          return;
        }
        addLogLine('SUCCESS', `cache cleared: ${helpers.formatBytes?.(result?.clearedBytes || 0) || result?.clearedBytes || 0} freed`);
      },
    });

    register({
      name: 'last',
      description: 'print last upload result',
      run: async () => {
        const result = normalizeResult(await requireMethod('getLastResult')());
        addLogLine('INFO', `last=${stringify(result)}`);
      },
    });

    register({
      name: 'config',
      usage: 'config',
      description: 'print current sanitized config snapshot',
      run: async () => {
        const config = normalizeResult(await requireMethod('getAllConfig')());
        addLogLine('INFO', stringify(config));
      },
    });

    register({
      name: 'config:get',
      aliases: ['get'],
      usage: 'config get <key>',
      description: 'print one config value',
      run: async ({ args }) => {
        const key = args[0];
        if (!key) {
          addLogLine('WARN', 'Usage: config get <key>');
          return;
        }
        const value = normalizeResult(await requireMethod('getConfig')(key));
        addLogLine('INFO', `${key}=${stringify(value)}`);
      },
    });

    register({
      name: 'service:start',
      aliases: ['start'],
      usage: 'service start',
      description: 'start reporter service',
      run: async () => {
        const result = normalizeResult(await requireMethod('startService')());
        helpers.applyServiceState?.(result && typeof result.isRunning === 'boolean' ? result.isRunning : true);
        addLogLine('SUCCESS', 'reporter started');
      },
    });

    register({
      name: 'service:stop',
      aliases: ['stop'],
      usage: 'service stop',
      description: 'stop reporter service',
      run: async () => {
        const result = normalizeResult(await requireMethod('stopService')());
        helpers.applyServiceState?.(result && typeof result.isRunning === 'boolean' ? result.isRunning : false);
        addLogLine('INFO', 'reporter stopped');
      },
    });

    register({
      name: 'service:restart',
      aliases: ['restart'],
      usage: 'service restart',
      description: 'restart reporter service',
      run: async () => {
        await requireMethod('restartService')();
        helpers.applyServiceState?.(true);
        addLogLine('SUCCESS', 'reporter restarted');
      },
    });

    register({
      name: 'service:status',
      aliases: ['running'],
      usage: 'service status',
      description: 'print reporter service running state',
      run: async () => {
        const running = normalizeResult(await requireMethod('isRunning')());
        helpers.applyServiceState?.(!!running);
        addLogLine('INFO', `service=${running ? 'running' : 'stopped'}`);
      },
    });

    register({
      name: 'capture',
      aliases: ['screenshot'],
      description: 'capture one screenshot using current screenshot settings',
      run: async () => {
        await helpers.triggerScreenshot?.();
      },
    });

    register({
      name: 'update:check',
      aliases: ['update'],
      usage: 'update check',
      description: 'check for updates',
      run: async () => {
        const result = normalizeResult(await requireMethod('checkUpdate')());
        if (result?.error) {
          addLogLine('ERROR', `update check failed: ${result.error}`);
          return;
        }
        addLogLine(result?.hasUpdate ? 'WARN' : 'INFO', result?.hasUpdate
          ? `update available: v${result.latestVersion || result.version || '?'}`
          : `already latest: v${result?.currentVersion || '?'}`);
      },
    });

    register({
      name: 'update:pending',
      usage: 'update pending',
      description: 'print pending downloaded installer status',
      run: async () => {
        const pending = normalizeResult(await requireMethod('getPendingInstall')());
        addLogLine(pending?.hasPending ? 'WARN' : 'INFO', pending?.hasPending
          ? `pending update: v${pending.version || '?'}`
          : 'no pending installer');
      },
    });

    register({
      name: 'update:integrity',
      usage: 'update integrity',
      description: 'run update system integrity checks',
      run: async () => {
        const results = normalizeResult(await requireMethod('checkIntegrity')()) || [];
        results.forEach((item) => addLogLine(item.ok ? 'INFO' : 'WARN', `[integrity] ${item.name}: ${item.text}`));
      },
    });

    async function execute(input) {
      const tokens = tokenize(input);
      if (!tokens.length) return;

      const key = toCommandKey(tokens);
      const command = resolve(key);
      if (!command) {
        addLogLine('WARN', `Unknown command: ${tokens.join(' ')}. Type help.`);
        return;
      }

      const keyParts = key.split(':').length;
      const args = tokens.slice(keyParts);
      try {
        await command.run({ args, tokens, raw: input, key });
      } catch (error) {
        addLogLine('ERROR', `${command.name} failed: ${error.message}`);
      }
    }

    return {
      execute,
      listCommands,
      tokenize,
      resolve,
      register,
    };
  }

  window._nekoModules.components.DeveloperConsole = {
    createCommandRegistry,
    tokenize,
  };
})();
