const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execP = util.promisify(exec);

const { safePath } = require('./fsutil');
const jobs = require('./background-jobs');
const { deployToolExecute } = require('./deploy-helper');

const READ_MAX = 400 * 1024;
const LIST_MAX = 250;

function getToolDefinitions() {
  return [
    {
      type: 'function',
      function: {
        name: 'fs_read_file',
        description: 'Read text from a file under the workspace. Returns truncated content if very long.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path from workspace root' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'fs_write_file',
        description: 'Create or overwrite a file. Parent directories are created.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'fs_delete',
        description: 'Delete a file or empty directory (use recursive for non-empty dirs).',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            recursive: { type: 'boolean', description: 'If true, delete directory recursively' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'fs_mkdir',
        description: 'Create a directory (and parents).',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'fs_list_dir',
        description: 'List files and subdirectories in a path (non-recursive by default).',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path; use "." for workspace root' },
            recursive: { type: 'boolean' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'fs_rename',
        description: 'Rename or move a file/directory within the workspace.',
        parameters: {
          type: 'object',
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
          },
          required: ['from', 'to'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'fs_multi_edit',
        description: 'Apply multiple search/replace edits to files in one step.',
        parameters: {
          type: 'object',
          properties: {
            edits: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  path: { type: 'string' },
                  old_string: { type: 'string' },
                  new_string: { type: 'string' },
                },
                required: ['path', 'old_string', 'new_string'],
              },
            },
          },
          required: ['edits'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_command',
        description:
          'Run a shell command in the workspace directory; waits for completion. Use for npm install, build, etc.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            timeout_ms: { type: 'integer', description: 'Default 120000' },
          },
          required: ['command'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_background_command',
        description:
          'Start a long-running command in the background. Returns job_id; poll with read_background_output.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string' },
          },
          required: ['command'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_background_output',
        description: 'Read stdout/stderr so far for a background job; includes done/exitCode when finished.',
        parameters: {
          type: 'object',
          properties: {
            job_id: { type: 'string' },
          },
          required: ['job_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'kill_background_command',
        description: 'Terminate a background job by job_id.',
        parameters: {
          type: 'object',
          properties: {
            job_id: { type: 'string' },
          },
          required: ['job_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_background_commands',
        description: 'List background jobs for this session.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search the web (DuckDuckGo instant answer + related topics).',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'grep_workspace',
        description: 'Search for a regex pattern in text files under the workspace (limited results).',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string' },
            path: { type: 'string', description: 'Subdirectory or . for whole workspace' },
            max_results: { type: 'integer' },
          },
          required: ['pattern'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'deploy_to_clickdep',
        description:
          'Push the current workspace to ClickDep Web Hosting: creates a normal deploy project on first use, then redeploys the same project when files change. Same dashboard as manual deploys.',
        parameters: {
          type: 'object',
          properties: {
            project_name: {
              type: 'string',
              description: 'DNS-safe name (e.g. my-app). Required for first deploy.',
            },
            redeploy_only: {
              type: 'boolean',
              description: 'If true, only redeploy an already-linked project (fails if none).',
            },
          },
          required: [],
        },
      },
    },
  ];
}

function walkFiles(root, relBase, out, max, depth, maxDepth) {
  if (out.length >= max || depth > maxDepth) return;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const ent of entries) {
    if (out.length >= max) break;
    if (ent.name === '.git' || ent.name === 'node_modules') continue;
    const rel = path.join(relBase, ent.name);
    if (ent.isDirectory()) {
      walkFiles(path.join(root, ent.name), rel, out, max, depth + 1, maxDepth);
    } else {
      out.push(rel.replace(/\\/g, '/'));
    }
  }
}

async function grepWorkspace(workspaceRoot, pattern, sub, maxResults) {
  const max = Math.min(maxResults || 40, 80);
  let re;
  try {
    re = new RegExp(pattern, 'mi');
  } catch (e) {
    return { error: `Invalid regex: ${e.message}` };
  }
  const files = [];
  walkFiles(safePath(workspaceRoot, sub || '.'), '', files, 400, 0, 8);
  const hits = [];
  for (const rel of files) {
    if (hits.length >= max) break;
    const full = safePath(workspaceRoot, rel);
    let content;
    try {
      content = fs.readFileSync(full, 'utf8');
    } catch (e) {
      continue;
    }
    if (content.length > 500 * 1024) continue;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (hits.length >= max) break;
      const line = lines[i];
      if (re.test(line)) {
        hits.push({ file: rel, line: i + 1, text: line.slice(0, 500) });
      }
    }
  }
  return { matches: hits, truncated: hits.length >= max };
}

async function webSearch(query) {
  const u = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const res = await fetch(u);
  const data = await res.json();
  const related = (data.RelatedTopics || [])
    .slice(0, 10)
    .map((x) => (typeof x === 'string' ? x : x.Text))
    .filter(Boolean);
  return {
    abstract: data.AbstractText || '',
    abstract_url: data.AbstractURL || '',
    heading: data.Heading || '',
    related,
  };
}

async function executeTool(name, rawArgs, ctx) {
  const args = typeof rawArgs === 'string' ? JSON.parse(rawArgs || '{}') : rawArgs || {};
  const { sessionId, workspaceRoot } = ctx;

  switch (name) {
    case 'fs_read_file': {
      const fp = safePath(workspaceRoot, args.path);
      if (!fs.existsSync(fp)) return { error: 'File not found' };
      const st = fs.statSync(fp);
      if (!st.isFile()) return { error: 'Not a file' };
      let content = fs.readFileSync(fp, 'utf8');
      const truncated = content.length > READ_MAX;
      if (truncated) content = content.slice(0, READ_MAX) + '\n…[truncated]';
      return { path: args.path, content, truncated };
    }
    case 'fs_write_file': {
      const fp = safePath(workspaceRoot, args.path);
      const content = String(args.content ?? '');
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, content, 'utf8');
      return { ok: true, path: args.path, bytes: Buffer.byteLength(content, 'utf8') };
    }
    case 'fs_delete': {
      const fp = safePath(workspaceRoot, args.path);
      if (!fs.existsSync(fp)) return { error: 'Path not found' };
      const st = fs.statSync(fp);
      if (st.isDirectory()) {
        fs.rmSync(fp, { recursive: !!args.recursive, force: true });
      } else {
        fs.unlinkSync(fp);
      }
      return { ok: true, path: args.path };
    }
    case 'fs_mkdir': {
      const fp = safePath(workspaceRoot, args.path);
      fs.mkdirSync(fp, { recursive: true });
      return { ok: true, path: args.path };
    }
    case 'fs_list_dir': {
      const fp = safePath(workspaceRoot, args.path || '.');
      if (!fs.existsSync(fp)) return { error: 'Path not found' };
      const rec = !!args.recursive;
      if (!rec) {
        const entries = fs.readdirSync(fp, { withFileTypes: true });
        return {
          path: args.path || '.',
          entries: entries.slice(0, LIST_MAX).map((e) => ({
            name: e.name,
            type: e.isDirectory() ? 'dir' : 'file',
          })),
        };
      }
      const files = [];
      walkFiles(fp, '', files, LIST_MAX, 0, 6);
      return { path: args.path || '.', recursive: true, files };
    }
    case 'fs_rename': {
      const from = safePath(workspaceRoot, args.from);
      const to = safePath(workspaceRoot, args.to);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from, to);
      return { ok: true, from: args.from, to: args.to };
    }
    case 'fs_multi_edit': {
      const results = [];
      for (const ed of args.edits || []) {
        const fp = safePath(workspaceRoot, ed.path);
        if (!fs.existsSync(fp)) {
          results.push({ path: ed.path, ok: false, error: 'not found' });
          continue;
        }
        let content = fs.readFileSync(fp, 'utf8');
        if (!content.includes(ed.old_string)) {
          results.push({ path: ed.path, ok: false, error: 'old_string not found' });
          continue;
        }
        content = content.split(ed.old_string).join(ed.new_string);
        fs.writeFileSync(fp, content, 'utf8');
        results.push({ path: ed.path, ok: true });
      }
      return { results };
    }
    case 'run_command': {
      const cwd = workspaceRoot;
      const timeout = Math.min(Math.max(args.timeout_ms || 120000, 5000), 600000);
      try {
        const { stdout, stderr } = await execP(args.command, {
          cwd,
          maxBuffer: 12 * 1024 * 1024,
          timeout,
          env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
          windowsHide: true,
        });
        return { exitCode: 0, stdout: stdout || '', stderr: stderr || '' };
      } catch (e) {
        return {
          exitCode: e.code ?? 1,
          stdout: e.stdout || '',
          stderr: (e.stderr || '') + (e.message ? `\n${e.message}` : ''),
        };
      }
    }
    case 'run_background_command': {
      const id = jobs.runBackgroundCommand(sessionId, args.command, workspaceRoot);
      return { job_id: id, message: 'Poll read_background_output for stdout/stderr.' };
    }
    case 'read_background_output': {
      const o = jobs.readJobOutput(args.job_id);
      if (!o) return { error: 'Unknown job_id' };
      return o;
    }
    case 'kill_background_command': {
      const ok = jobs.killJob(args.job_id);
      return { ok, job_id: args.job_id };
    }
    case 'list_background_commands': {
      return { jobs: jobs.listJobsForSession(sessionId) };
    }
    case 'web_search': {
      return await webSearch(args.query);
    }
    case 'grep_workspace': {
      return await grepWorkspace(workspaceRoot, args.pattern, args.path || '.', args.max_results);
    }
    case 'deploy_to_clickdep': {
      return await deployToolExecute(sessionId, {
        project_name: args.project_name,
        redeploy_only: args.redeploy_only,
      });
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

module.exports = { getToolDefinitions, executeTool };
