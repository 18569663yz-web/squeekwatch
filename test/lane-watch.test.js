import { test } from 'node:test';
import assert from 'node:assert/strict';

import { probeLane } from '../scripts/lane-watch.mjs';

const ENTRY = 'index-8HIxyzWw.js';

function fakeFetch({ html = '', main = '', chunk = '', status = 200 } = {}) {
  return async (url) => {
    const body = url.endsWith('/genesis/code')
      ? html
      : url.includes('index-')
        ? main
        : chunk;
    return {
      ok: status === 200,
      status,
      text: async () => body,
    };
  };
}

const htmlWith = (entry = ENTRY) =>
  `<!doctype html><html><head><script type="module" crossorigin src="/assets/${entry}"></script></head></html>`;
const mainWith = (chunk) => `const r=()=>import("./${chunk}");`;
const closedChunk = `const u=[{id:"clout"},{id:"code",name:"Code",summary:"Not open yet",closed:!0},{id:"capital",closed:!0}];`;
const openChunk = `const u=[{id:"clout"},{id:"code",name:"Code",summary:"Open"},{id:"capital"}];const b="Submit an independent project";`;

test('probeLane reports closed when the code lane marker is present', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = fakeFetch({
    html: htmlWith(),
    main: mainWith('genesis-page-Dlge2HdI.js'),
    chunk: closedChunk,
  });
  try {
    const probe = await probeLane();
    assert.equal(probe.codeLaneClosed, true);
    assert.equal(probe.open, false);
    assert.equal(probe.entry, ENTRY);
    assert.equal(probe.chunk, 'genesis-page-Dlge2HdI.js');
  } finally {
    globalThis.fetch = original;
  }
});

test('probeLane reports open when the marker is gone and submit copy exists', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = fakeFetch({
    html: htmlWith('index-newbuild1.js'),
    main: mainWith('genesis-page-Zzz99999.js'),
    chunk: openChunk,
  });
  try {
    const probe = await probeLane();
    assert.equal(probe.codeLaneClosed, false);
    assert.equal(probe.open, true);
    assert.equal(probe.chunk, 'genesis-page-Zzz99999.js');
  } finally {
    globalThis.fetch = original;
  }
});

test('probeLane fails loudly when the entry bundle is missing', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = fakeFetch({ html: '<html>no scripts</html>' });
  try {
    await assert.rejects(probeLane(), /entry bundle not found/);
  } finally {
    globalThis.fetch = original;
  }
});

test('probeLane fails loudly when the route chunk is not referenced', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = fakeFetch({ html: htmlWith(), main: 'console.log(1)' });
  try {
    await assert.rejects(probeLane(), /genesis route chunk/);
  } finally {
    globalThis.fetch = original;
  }
});
