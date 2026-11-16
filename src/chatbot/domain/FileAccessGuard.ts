import * as path from 'path';

const EXCLUDED_PATTERNS: RegExp[] = [
  // Secrets & credentials
  /^\.env$/,
  /^\.env\..+$/,
  /\.pem$/,
  /\.key$/,
  /^credentials\.json$/,
  /\.p12$/,
  /\.pfx$/,
  /\.jks$/,
  /id_rsa/,
  /id_ed25519/,

  // Dependency directories
  /^node_modules\//,
  /^vendor\//,
  /^\.venv\//,
  /^__pycache__\//,
  /^\.pip\//,

  // Build output
  /^dist\//,
  /^build\//,
  /^\.next\//,
  /^out\//,
  /^coverage\//,
  /^\.turbo\//,
  /^\.cache\//,

  // Git internals
  /^\.git\//,

  // Binary extensions
  /\.(png|jpg|jpeg|gif|bmp|ico|svg|webp|mp4|mov|avi|mp3|wav|woff2?|ttf|eot|otf|zip|tar|gz|rar|7z|exe|dll|so|dylib|class|o|a|pyc|wasm)$/i,

  // Lock files
  /^package-lock\.json$/,
  /^yarn\.lock$/,
  /^pnpm-lock\.yaml$/,
  /^Gemfile\.lock$/,
  /^poetry\.lock$/,
  /^Cargo\.lock$/,
  /^composer\.lock$/,

  // Spec Rabbit runtime
  /^\.specify\/\.runtime\//,
];

const ALLOWED_SPECIFY_PATHS = [
  /^\.specify\/memory\//,
  /^\.specify\/meetings\//,
  /^\.specify\/chatbot\/knowledge\//,
  /^specs\//,
];

export class FileAccessGuard {
  isAllowed(filePath: string, projectRoot: string): boolean {
    const resolved = path.resolve(projectRoot, filePath);
    if (!resolved.startsWith(path.resolve(projectRoot))) return false;

    const relative = path.relative(projectRoot, resolved);
    if (relative.startsWith('..')) return false;

    for (const pattern of EXCLUDED_PATTERNS) {
      if (pattern.test(relative)) return false;
    }

    return true;
  }

  isExcluded(filePath: string, projectRoot: string): boolean {
    return !this.isAllowed(filePath, projectRoot);
  }

  filterPaths(paths: string[], projectRoot: string): { allowed: string[]; blocked: string[] } {
    const allowed: string[] = [];
    const blocked: string[] = [];
    for (const p of paths) {
      if (this.isAllowed(p, projectRoot)) {
        allowed.push(p);
      } else {
        blocked.push(p);
      }
    }
    return { allowed, blocked };
  }

  getExclusionReason(filePath: string, projectRoot: string): string | null {
    const resolved = path.resolve(projectRoot, filePath);
    if (!resolved.startsWith(path.resolve(projectRoot))) return 'Path traversal outside project root';

    const relative = path.relative(projectRoot, resolved);
    if (relative.startsWith('..')) return 'Path traversal outside project root';

    if (/^\.env/.test(relative) || /\.(pem|key|p12|pfx|jks)$/.test(relative) || /credentials\.json$/.test(relative) || /id_rsa|id_ed25519/.test(relative)) {
      return 'Secret or credential file';
    }
    if (/^(node_modules|vendor|\.venv|__pycache__)\//.test(relative)) return 'Dependency directory';
    if (/^(dist|build|\.next|out|coverage|\.turbo|\.cache)\//.test(relative)) return 'Build output directory';
    if (/^\.git\//.test(relative)) return 'Git internals';
    if (/\.(png|jpg|jpeg|gif|bmp|ico|svg|webp|mp4|mov|avi|mp3|wav|woff2?|ttf|eot|otf|zip|tar|gz|rar|7z|exe|dll|so|dylib|class|o|a|pyc|wasm)$/i.test(relative)) {
      return 'Binary file';
    }
    if (/^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Gemfile\.lock|poetry\.lock|Cargo\.lock|composer\.lock)$/.test(relative)) {
      return 'Lock file';
    }
    if (/^\.specify\/\.runtime\//.test(relative)) return 'Spec Rabbit runtime directory';

    return null;
  }
}
