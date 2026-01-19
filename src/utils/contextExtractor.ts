/**
 * Context Extractor
 *
 * Extracts meaningful context from window titles and URLs.
 * Used by the session aggregation service to build rich session data.
 */

export interface ExtractedContext {
  type: "file" | "url" | "command" | "document" | "project" | "other";
  value: string;
  details?: string;
}

// Common IDE patterns for extracting file paths
const IDE_PATTERNS: { appName: RegExp; extractor: (title: string) => string | null }[] = [
  // VS Code: "filename.ts - folder - Visual Studio Code"
  {
    appName: /Visual Studio Code|Code|VSCode/i,
    extractor: (title) => {
      const match = title.match(/^(.+?)\s+-\s+(.+?)\s+-\s+Visual Studio Code$/i);
      if (match) {
        const file = match[1].trim();
        const folder = match[2].trim();
        // Skip welcome/settings pages
        if (file === "Welcome" || file === "Settings") return null;
        return `${folder}/${file}`;
      }
      // Simpler pattern: "filename.ts - Visual Studio Code"
      const simple = title.match(/^(.+?)\s+-\s+Visual Studio Code$/i);
      if (simple) {
        const file = simple[1].trim();
        if (file === "Welcome" || file === "Settings") return null;
        return file;
      }
      return null;
    },
  },
  // Cursor: Similar to VS Code
  {
    appName: /Cursor/i,
    extractor: (title) => {
      const match = title.match(/^(.+?)\s+-\s+(.+?)\s+-\s+Cursor$/i);
      if (match) {
        return `${match[2].trim()}/${match[1].trim()}`;
      }
      const simple = title.match(/^(.+?)\s+-\s+Cursor$/i);
      if (simple) return simple[1].trim();
      return null;
    },
  },
  // Xcode: "filename.swift — ProjectName"
  {
    appName: /Xcode/i,
    extractor: (title) => {
      const match = title.match(/^(.+?)\s+[—–-]\s+(.+?)$/);
      if (match) {
        return `${match[2].trim()}/${match[1].trim()}`;
      }
      return null;
    },
  },
  // IntelliJ/WebStorm/PyCharm: "filename – project"
  {
    appName: /IntelliJ|WebStorm|PyCharm|PhpStorm|Rider|GoLand|CLion|RubyMine/i,
    extractor: (title) => {
      const match = title.match(/^(.+?)\s+[–-]\s+(.+?)(?:\s+\[.+\])?$/);
      if (match) {
        return `${match[2].trim()}/${match[1].trim()}`;
      }
      return null;
    },
  },
  // Sublime Text: "filename • folder"
  {
    appName: /Sublime Text/i,
    extractor: (title) => {
      const match = title.match(/^(.+?)\s+[•-]\s+(.+?)$/);
      if (match) {
        return `${match[2].trim()}/${match[1].trim()}`;
      }
      return title.replace(/\s*\(.*\)$/, ""); // Remove trailing annotations
    },
  },
  // Neovim/Vim in terminal
  {
    appName: /nvim|vim/i,
    extractor: (title) => {
      // Often shows the file path directly
      const match = title.match(/(?:nvim|vim)\s+(.+)/i);
      if (match) return match[1].trim();
      return null;
    },
  },
];

// Terminal patterns for extracting commands
const TERMINAL_PATTERNS: { appName: RegExp; extractor: (title: string) => string | null }[] = [
  // iTerm2, Terminal.app, Ghostty, Alacritty, etc.
  {
    appName: /iTerm|Terminal|Ghostty|Alacritty|Hyper|Warp|Kitty/i,
    extractor: (title) => {
      // Common patterns: "user@host: ~/path" or "~/path — bash" or "npm run dev"
      // Skip generic titles
      if (/^(bash|zsh|fish|Terminal|iTerm)$/i.test(title.trim())) {
        return null;
      }

      // Extract path if present
      const pathMatch = title.match(/[~\/][^\s:]+/);
      if (pathMatch) {
        return pathMatch[0];
      }

      // Extract command if recognizable
      const cmdMatch = title.match(
        /\b(npm|yarn|bun|pnpm|cargo|go|python|node|make|docker|git|kubectl|ssh)\s+.*/i
      );
      if (cmdMatch) {
        return cmdMatch[0].substring(0, 50); // Limit length
      }

      return null;
    },
  },
];

// Browser URL extraction
function extractDomainAndPath(url: string): { domain: string; path: string } | null {
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return { domain, path };
  } catch {
    return null;
  }
}

// Extract meaningful context from browser title and URL
function extractBrowserContext(title: string, url?: string | null): ExtractedContext | null {
  if (!url) return null;

  const parsed = extractDomainAndPath(url);
  if (!parsed) return null;

  // Clean up title - remove common suffixes
  let cleanTitle = title
    .replace(/\s*[-–—]\s*(Firefox|Chrome|Safari|Edge|Brave|Arc).*$/i, "")
    .replace(/\s*\|.*$/, "")
    .trim();

  // Special handling for known sites
  if (parsed.domain.includes("github.com")) {
    // GitHub: extract repo and action
    const repoMatch = parsed.path.match(/^\/([^\/]+\/[^\/]+)/);
    if (repoMatch) {
      return {
        type: "url",
        value: `github.com${repoMatch[0]}`,
        details: cleanTitle,
      };
    }
  }

  if (parsed.domain.includes("stackoverflow.com") || parsed.domain.includes("stackexchange.com")) {
    return {
      type: "url",
      value: parsed.domain,
      details: cleanTitle.substring(0, 80),
    };
  }

  // For other URLs, include domain and simplified path
  const simplePath =
    parsed.path.length > 50 ? parsed.path.substring(0, 47) + "..." : parsed.path;

  return {
    type: "url",
    value: parsed.domain + simplePath,
    details: cleanTitle.length > 50 ? cleanTitle.substring(0, 47) + "..." : cleanTitle,
  };
}

// Design app patterns
const DESIGN_APP_PATTERNS: { appName: RegExp; extractor: (title: string) => string | null }[] = [
  // Figma: "Filename – Figma"
  {
    appName: /Figma/i,
    extractor: (title) => {
      const match = title.match(/^(.+?)\s+[–-]\s+Figma$/i);
      if (match) return match[1].trim();
      return null;
    },
  },
  // Sketch: "Filename.sketch"
  {
    appName: /Sketch/i,
    extractor: (title) => {
      const match = title.match(/^(.+?)(?:\.sketch)?$/i);
      if (match) return match[1].trim();
      return null;
    },
  },
  // Adobe apps
  {
    appName: /Photoshop|Illustrator|InDesign|XD|Premiere|After Effects/i,
    extractor: (title) => {
      // Often: "filename @ 100% (Layer 1, RGB/8)"
      const match = title.match(/^(.+?)(?:\s+@|\s+\*|$)/);
      if (match) {
        const filename = match[1].trim();
        if (filename && !filename.startsWith("Adobe")) {
          return filename;
        }
      }
      return null;
    },
  },
];

// Communication app patterns
const COMMUNICATION_PATTERNS: { appName: RegExp; extractor: (title: string) => string | null }[] = [
  // Slack: "#channel - Workspace" or "DM with Person - Workspace"
  {
    appName: /Slack/i,
    extractor: (title) => {
      const channelMatch = title.match(/^(#.+?)\s+-/);
      if (channelMatch) return channelMatch[1];
      const dmMatch = title.match(/^(.+?)\s+-\s+.+?\s+-\s+Slack$/);
      if (dmMatch) return `DM: ${dmMatch[1]}`;
      return null;
    },
  },
  // Discord: "Server - #channel" or "Username"
  {
    appName: /Discord/i,
    extractor: (title) => {
      const match = title.match(/^(.+?)\s+-\s+(#.+?)$/);
      if (match) return `${match[1]}/${match[2]}`;
      return title.includes("Discord") ? null : title;
    },
  },
  // Microsoft Teams
  {
    appName: /Teams/i,
    extractor: (title) => {
      const match = title.match(/^(.+?)\s+\|/);
      if (match) return match[1].trim();
      return null;
    },
  },
];

/**
 * Extract meaningful context from an event's window title and URL
 */
export function extractContext(
  appName: string,
  windowTitle: string,
  url?: string | null,
  documentPath?: string | null
): ExtractedContext | null {
  // Skip empty or generic titles
  if (!windowTitle || windowTitle.trim().length === 0) {
    return null;
  }

  // If document path is provided, use it directly
  if (documentPath && documentPath.trim()) {
    return {
      type: "file",
      value: documentPath,
    };
  }

  // Check IDE patterns
  for (const pattern of IDE_PATTERNS) {
    if (pattern.appName.test(appName)) {
      const extracted = pattern.extractor(windowTitle);
      if (extracted) {
        return { type: "file", value: extracted };
      }
    }
  }

  // Check terminal patterns
  for (const pattern of TERMINAL_PATTERNS) {
    if (pattern.appName.test(appName)) {
      const extracted = pattern.extractor(windowTitle);
      if (extracted) {
        return { type: "command", value: extracted };
      }
    }
  }

  // Check design app patterns
  for (const pattern of DESIGN_APP_PATTERNS) {
    if (pattern.appName.test(appName)) {
      const extracted = pattern.extractor(windowTitle);
      if (extracted) {
        return { type: "document", value: extracted };
      }
    }
  }

  // Check communication patterns
  for (const pattern of COMMUNICATION_PATTERNS) {
    if (pattern.appName.test(appName)) {
      const extracted = pattern.extractor(windowTitle);
      if (extracted) {
        return { type: "other", value: extracted };
      }
    }
  }

  // For browsers, use URL-based extraction
  if (/Firefox|Chrome|Safari|Edge|Brave|Arc/i.test(appName)) {
    return extractBrowserContext(windowTitle, url);
  }

  // Generic fallback: use window title if it's not too generic
  const genericTitles = new Set([
    "untitled",
    "new document",
    "new file",
    "document",
    "window",
    "",
  ]);

  const normalizedTitle = windowTitle.toLowerCase().trim();
  if (!genericTitles.has(normalizedTitle) && windowTitle.length < 100) {
    return {
      type: "other",
      value: windowTitle.substring(0, 80),
    };
  }

  return null;
}

/**
 * Extract domain from URL
 */
export function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  const parsed = extractDomainAndPath(url);
  return parsed?.domain ?? null;
}

/**
 * Check if two URLs are related (same domain or related services)
 */
export function areUrlsRelated(url1: string | null, url2: string | null): boolean {
  if (!url1 || !url2) return false;

  const domain1 = extractDomain(url1);
  const domain2 = extractDomain(url2);

  if (!domain1 || !domain2) return false;

  // Same domain
  if (domain1 === domain2) return true;

  // Related domain groups (e.g., GitHub ecosystem)
  const relatedGroups = [
    ["github.com", "githubusercontent.com", "github.io", "gist.github.com"],
    ["google.com", "googleapis.com", "googleusercontent.com"],
    ["stackoverflow.com", "stackexchange.com", "askubuntu.com", "serverfault.com"],
    ["amazon.com", "aws.amazon.com", "console.aws.amazon.com"],
    ["microsoft.com", "azure.com", "live.com", "office.com"],
  ];

  for (const group of relatedGroups) {
    const d1InGroup = group.some((g) => domain1.includes(g) || g.includes(domain1));
    const d2InGroup = group.some((g) => domain2.includes(g) || g.includes(domain2));
    if (d1InGroup && d2InGroup) return true;
  }

  return false;
}

/**
 * Deduplicate and clean a list of contexts
 */
export function deduplicateContexts(contexts: ExtractedContext[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const ctx of contexts) {
    const normalized = ctx.value.toLowerCase().trim();
    if (!seen.has(normalized) && ctx.value.length > 0) {
      seen.add(normalized);
      result.push(ctx.value);
    }
  }

  return result;
}
