#!/usr/bin/env node
/** LEDicated Model Context Protocol (MCP) Stdio Server.
 * Exposes timeline and show settings to AI agents in Antigravity.
 * Standard JSON-RPC 2.0 over stdio with zero external dependencies.
 */
import readline from 'node:readline';
import { TOOLS_MANIFEST, createMcpClient, handleToolCall } from './mcp-tools.mjs';

const baseUrl = process.env.LEDICATED_URL || 'http://127.0.0.1:8787';
const client = createMcpClient({ baseUrl });

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function sendResponse(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message, data = null) {
  send({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });
}

async function handleMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  const { id, method, params } = msg;

  try {
    switch (method) {
      case 'initialize': {
        return sendResponse(id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {
              listChanged: false
            }
          },
          serverInfo: {
            name: 'ledicated',
            version: '1.0.0'
          }
        });
      }

      case 'notifications/initialized': {
        // Notification, no response required
        return;
      }

      case 'ping': {
        return sendResponse(id, {});
      }

      case 'tools/list': {
        return sendResponse(id, { tools: TOOLS_MANIFEST });
      }

      case 'tools/call': {
        if (!params || !params.name) {
          return sendError(id, -32602, 'Invalid params: name is required');
        }
        const result = await handleToolCall(params.name, params.arguments || {}, client);
        return sendResponse(id, result);
      }

      default: {
        if (id !== undefined) {
          sendError(id, -32601, `Method not found: ${method}`);
        }
      }
    }
  } catch (error) {
    if (id !== undefined) {
      sendError(id, -32603, `Internal error: ${error.message}`);
    }
  }
}

// Line-based reader with support for Content-Length headers or pure NDJSON
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

let buffer = '';
rl.on('line', line => {
  const trimmed = line.trim();
  if (!trimmed) return;
  if (trimmed.startsWith('Content-Length:')) return; // ignore LSP headers if client sends them
  try {
    const msg = JSON.parse(trimmed);
    handleMessage(msg);
  } catch (err) {
    process.stderr.write(`JSON parse error: ${err.message}\n`);
  }
});

process.stderr.write(`LEDicated MCP Server running for ${baseUrl}\n`);
