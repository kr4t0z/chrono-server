# Chrono AI Inference System

## Overview

This document defines the prompt engineering and response schema for Chrono's AI interpretation layer.

---

## Response Schema (TypeScript)

```typescript
interface ChronoInference {
  // Metadata
  period: {
    start: string;  // ISO timestamp
    end: string;    // ISO timestamp
    totalTracked: number;  // seconds
    totalIdle: number;     // seconds
  };

  // Project breakdown
  projects: Array<{
    name: string;           // Inferred or matched project name
    confidence: number;     // 0-1 confidence score
    duration: number;       // seconds
    percentage: number;     // of total tracked time
    evidence: string[];     // What led to this inference (max 3)
    activities: {
      coding: number;       // seconds
      research: number;     // seconds
      design: number;       // seconds
      communication: number; // seconds
      other: number;        // seconds
    };
  }>;

  // Distraction analysis
  distractions: {
    totalDuration: number;  // seconds
    percentage: number;     // of total tracked time
    items: Array<{
      name: string;         // e.g., "Instagram", "Reddit"
      duration: number;     // seconds
      context: string;      // e.g., "During Chrono coding session"
    }>;
  };

  // Focus analysis
  focus: {
    deepWorkSessions: Array<{
      start: string;        // ISO timestamp
      end: string;          // ISO timestamp
      duration: number;     // seconds (must be >= 25min to qualify)
      project: string;      // which project
      quality: 'excellent' | 'good' | 'interrupted';
    }>;
    averageSessionLength: number;  // seconds before context switch
    longestStreak: number;         // seconds
    contextSwitches: number;       // count of project/app changes
  };

  // Skills detected
  skills: Array<{
    name: string;           // e.g., "TypeScript", "UI Design"
    duration: number;       // seconds
    evidence: string[];     // max 2 items
  }>;

  // Key insights (max 5)
  insights: Array<{
    type: 'achievement' | 'pattern' | 'warning' | 'suggestion';
    message: string;        // Max 100 chars
    metric?: string;        // Optional supporting data
  }>;

  // Comparison to baseline (if historical data available)
  comparison?: {
    vsYesterday: {
      productiveTime: number;  // percentage change
      distractions: number;    // percentage change
    };
    vsWeekAverage: {
      productiveTime: number;
      distractions: number;
    };
  };
}
```

---

## System Prompt

```
You are Chrono, a personal intelligence system that interprets computer activity data to understand work patterns, projects, and productivity.

## YOUR ROLE
You analyze raw activity events (app usage, window titles, URLs) and produce structured insights about:
- What PROJECTS the user worked on
- How they split time between ACTIVITIES (coding, research, design, communication)
- DISTRACTION patterns and triggers
- FOCUS quality and deep work sessions
- SKILLS being developed

## CONTEXT: USER'S KNOWN PROJECTS
The user has shared their project directories and descriptions:

{USER_PROJECTS_CONTEXT}

Use this context to accurately attribute activity to specific projects. Match file paths, URLs, and window titles to these known projects.

## RULES

1. **Be concise**: Insights must be under 100 characters each. No essays.

2. **Be specific**: Don't say "you were productive." Say "47min deep work on Chrono dashboard, 0 distractions."

3. **Match projects accurately**:
   - File path contains project folder → that project
   - URL matches project domain → that project
   - Window title mentions project → that project
   - If no match, use "Uncategorized"

4. **Classify activities**:
   - coding: IDEs, terminals with build commands, code file extensions
   - research: Documentation sites, Stack Overflow, tutorial videos
   - design: Figma, Canva, design tool URLs
   - communication: Slack, Discord, email, messaging apps
   - other: Everything else

5. **Detect distractions**:
   - Social media (Instagram, Twitter, Reddit, TikTok) during work hours
   - Entertainment (YouTube non-tutorial, Netflix, games)
   - Only flag if it interrupts a work session

6. **Deep work = 25+ minutes** of focused activity on one project without switching to distractions.

7. **Output valid JSON only**. No markdown, no explanation outside the JSON.

## INPUT FORMAT
You will receive:
- Time period (start/end timestamps)
- Array of activity events with: timestamp, appName, windowTitle, url, duration, isIdle

## OUTPUT FORMAT
Return ONLY a valid JSON object matching the ChronoInference schema. No other text.
```

---

## User Projects Context Template

This is injected into {USER_PROJECTS_CONTEXT}:

```
PROJECT: Chrono
  - Path patterns: ~/apps/personal-projects/chrono, chrono-dashboard, ChronoAgent
  - URLs: localhost:5173, localhost:5175, localhost:3000
  - Description: Personal time tracking + AI intelligence system
  - Tech: TypeScript, Vue, Swift, PostgreSQL

PROJECT: Client-X
  - Path patterns: ~/apps/work/client-x
  - URLs: client-x.com, staging.client-x.com
  - Description: Client project
  - Tech: React, Node.js

PROJECT: Personal Roadmaps
  - Path patterns: ~/apps/personal-projects/personal-roadmaps
  - Description: Personal goal tracking
  - Tech: Markdown, Planning

UNCATEGORIZED:
  - Any activity not matching above projects
```

---

## Example Input

```json
{
  "period": {
    "start": "2026-01-18T21:00:00Z",
    "end": "2026-01-18T22:00:00Z"
  },
  "events": [
    {
      "timestamp": "2026-01-18T21:00:05Z",
      "appName": "Ghostty",
      "windowTitle": "neo-tree filesystem [1] - (~/Apps/personal-projects/chrono) - Nvim",
      "url": null,
      "duration": 5,
      "isIdle": false
    },
    {
      "timestamp": "2026-01-18T21:15:30Z",
      "appName": "Firefox",
      "windowTitle": "Vue.js Documentation",
      "url": "https://vuejs.org/guide/components.html",
      "duration": 5,
      "isIdle": false
    },
    {
      "timestamp": "2026-01-18T21:45:00Z",
      "appName": "Firefox",
      "windowTitle": "Instagram",
      "url": "https://instagram.com",
      "duration": 5,
      "isIdle": false
    }
    // ... more events
  ]
}
```

---

## Example Output

```json
{
  "period": {
    "start": "2026-01-18T21:00:00Z",
    "end": "2026-01-18T22:00:00Z",
    "totalTracked": 3600,
    "totalIdle": 0
  },
  "projects": [
    {
      "name": "Chrono",
      "confidence": 0.95,
      "duration": 2700,
      "percentage": 75,
      "evidence": [
        "Nvim in ~/Apps/personal-projects/chrono",
        "localhost:5175 dashboard",
        "Vue.js docs (project uses Vue)"
      ],
      "activities": {
        "coding": 1800,
        "research": 600,
        "design": 0,
        "communication": 0,
        "other": 300
      }
    }
  ],
  "distractions": {
    "totalDuration": 300,
    "percentage": 8.3,
    "items": [
      {
        "name": "Instagram",
        "duration": 300,
        "context": "5min break during Chrono coding"
      }
    ]
  },
  "focus": {
    "deepWorkSessions": [
      {
        "start": "2026-01-18T21:00:00Z",
        "end": "2026-01-18T21:42:00Z",
        "duration": 2520,
        "project": "Chrono",
        "quality": "excellent"
      }
    ],
    "averageSessionLength": 2520,
    "longestStreak": 2520,
    "contextSwitches": 3
  },
  "skills": [
    {
      "name": "Vue.js",
      "duration": 2700,
      "evidence": ["Vue docs", "chrono-dashboard .vue files"]
    },
    {
      "name": "TypeScript",
      "duration": 1800,
      "evidence": ["Nvim editing .ts files"]
    }
  ],
  "insights": [
    {
      "type": "achievement",
      "message": "42min deep work session with zero interruptions",
      "metric": "Top 10% of your sessions"
    },
    {
      "type": "pattern",
      "message": "Instagram visit after 42min focus - typical break timing",
      "metric": null
    },
    {
      "type": "suggestion",
      "message": "You research Vue often - consider bookmarking key docs",
      "metric": "3rd time this week"
    }
  ]
}
```

---

## API Endpoint Design

```typescript
// POST /api/insights/analyze
// Request body:
{
  date: string;  // ISO date, e.g., "2026-01-18"
  // Optional: specific time range within the day
  startTime?: string;  // "09:00"
  endTime?: string;    // "17:00"
}

// Response: ChronoInference object
```

---

## Implementation Notes

### Option 1: Claude API
```typescript
const response = await anthropic.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 4096,
  system: SYSTEM_PROMPT.replace('{USER_PROJECTS_CONTEXT}', userProjectsContext),
  messages: [
    { role: "user", content: JSON.stringify(eventsPayload) }
  ]
});
```

### Option 2: Local LLM (Ollama)
```typescript
const response = await ollama.chat({
  model: "llama3.1",
  messages: [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(eventsPayload) }
  ],
  format: "json"
});
```

### Option 3: Hybrid (Recommended)
- Use rules-based parsing for obvious matches (file paths → projects)
- Use AI only for ambiguous cases and insight generation
- Cache results aggressively (same day's data rarely changes interpretation)

---

## User Projects Configuration

Store in database or config file:

```typescript
// /api/settings/projects
interface UserProject {
  id: string;
  name: string;
  pathPatterns: string[];      // Glob patterns for file paths
  urlPatterns: string[];       // URL patterns (domains, paths)
  windowTitlePatterns: string[]; // Regex for window titles
  description?: string;
  techStack?: string[];
  isActive: boolean;
}
```

User can configure via dashboard:
- "Add Project" → name + folder path
- Auto-detect from git repos in ~/apps/
- Manual URL/pattern mapping
