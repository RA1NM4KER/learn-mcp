import media from './media.json' with { type: 'json' };
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Real SDK clients and real transports; Moodle responses only are fixtures.
export async function runSdkCompatibility({ origin, token }) {
  const local = new Client({ name: 'Compatibility stdio', version: '1' });
  const remote = new Client({ name: 'Compatibility HTTP', version: '1' });
  const stdio = new StdioClientTransport({ command: process.execPath, args: ['--import', resolve('tests/compatibility/stdio-preload.mjs'), resolve('dist/server.js')], stderr: 'pipe', env: {
    PATH: process.env.PATH ?? '', MOODLE_URL: 'https://stemlearn.sun.ac.za', MOODLE_TOKEN: 'fixture-ta',
    MOODLE_MCP_TOKEN_FILE: '/nonexistent-compatibility-token.json', MOODLE_MCP_DOWNLOAD_DIR: '/tmp/learn-mcp-compatibility-downloads',
  } });
  const http = new StreamableHTTPClientTransport(new URL('/mcp', origin), { requestInit: { headers: { authorization: `Bearer ${token}` } } });
  let stderr = '';
  stdio.stderr?.on('data', chunk => { stderr += chunk; });
  const check = name => console.log(`PASS compatibility: ${name}`);
  const text = result => result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  try {
    await local.connect(stdio); await remote.connect(http);
    assert.deepEqual(local.getServerVersion(), remote.getServerVersion()); check('SDK initializes actual stdio and workerd HTTP servers');
    const a = (await local.listTools()).tools; const b = (await remote.listTools()).tools;
    const normalize = tools => tools.filter(t => t.name !== 'moodle_save_file').map(t => ({ name: t.name, inputSchema: t.inputSchema, annotations: t.annotations })).sort((x,y) => x.name.localeCompare(y.name));
    assert.deepEqual(normalize(a), normalize(b)); assert.ok(a.some(t => t.name === 'moodle_save_file')); assert.ok(!b.some(t => t.name === 'moodle_save_file')); check(`tool names, schemas and annotations match (${b.length} shared; save local only)`);
    assert.deepEqual((await local.listPrompts()).prompts, (await remote.listPrompts()).prompts); check('prompt discovery parity');
    assert.deepEqual(await local.getPrompt({ name: 'summarize-course', arguments: { courseId: '1' } }), await remote.getPrompt({ name: 'summarize-course', arguments: { courseId: '1' } })); check('prompt retrieval parity');
    assert.deepEqual(await local.listResourceTemplates(), await remote.listResourceTemplates()); check('resource template discovery parity');
    for (const [label, client] of [['stdio', local], ['HTTP', remote]]) {
      const call = (name, args = {}) => client.callTool({ name, arguments: args });
      assert.match(text(await call('moodle_list_courses')), /TA course/); check(`${label} course discovery`);
      const files = await call('moodle_list_resources', { courseId: 1 }); const id = text(files).match(/fileId: `([^`]+)`/)?.[1]; assert.ok(id);
      assert.match(text(await call('moodle_download_file', { fileId: id })), /fixture notes/); check(`${label} sealed text-file delivery`);
      const resources = await client.listResources(); assert.ok(resources.resources.some(r => r.mimeType === 'text/plain'));
      const read = await client.readResource({ uri: `moodle://files/${id}` }); assert.equal(read.contents[0].text, 'fixture notes'); check(`${label} resource list/read and URI fidelity`);
      for (const file of media) {
        const listed = await call('moodle_list_resources', { courseId: 1, filenameFilter: file.filename });
        const mediaId = text(listed).match(/fileId: `([^`]+)`/)[1];
        const delivered = await call('moodle_download_file', { fileId: mediaId });
        if (file.mime === 'image/png') {
          const img = delivered.content.find(c => c.type === 'image'); assert.ok(img); assert.equal(img.mimeType, file.mime); assert.equal(img.data, file.base64);
        } else {
          const binary = delivered.content.find(c => c.type === 'resource'); assert.ok(binary); assert.equal(binary.resource.mimeType, file.mime); assert.equal(binary.resource.blob, file.base64);
          assert.match(text(delivered), /Page 1/); assert.match(text(delivered), /Page 2/); assert.match(text(delivered), /Task 2/); assert.match(text(delivered), /not visually verified/);
          const page2 = await call('moodle_read_file', { fileId: mediaId, startPage: 2, maxPages: 1 }); assert.match(text(page2), /Page 2/); assert.ok(!text(page2).includes('Question 1'));
        }
        const resource = await client.readResource({ uri: `moodle://files/${mediaId}` }); assert.equal(resource.contents[0].blob, file.base64); assert.equal(resource.contents[0].mimeType, file.mime);
        check(`${label} ${file.mime} byte/content-block/resource fidelity`);
      }
      const invalid = await call('moodle_download_file', { fileId: 'malformed-fixture' }); assert.equal(invalid.isError, true); check(`${label} invalid handle returns tool error`);
      const badArgs = await call('moodle_get_course', { courseId: false }).then(result => result.isError === true, error => error.code === -32602); assert.ok(badArgs); check(`${label} malformed tool arguments rejected`);
      assert.deepEqual(normalize((await client.listTools()).tools), normalize(b)); check(`${label} repeated discovery remains stable`);
    }
    await remote.close();
    const reconnected = new Client({ name: 'Compatibility reconnect', version: '1' });
    try {
      await reconnected.connect(new StreamableHTTPClientTransport(new URL('/mcp', origin), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
      assert.deepEqual(normalize((await reconnected.listTools()).tools), normalize(b));
      check('fresh HTTP transport reinitialization and schema rediscovery');
    } finally { await reconnected.close(); }
    assert.ok(!stderr.includes('fixture-ta'));  assert.ok(!stderr.includes('/pluginfile.php/')); check('stdio diagnostic output contains no fixture credential/file URL');
  } finally { await Promise.allSettled([local.close(), remote.close()]); }
}
